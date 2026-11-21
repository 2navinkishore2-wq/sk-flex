package com.skflexbilling.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app update installer.
 *
 * The JS layer (src/lib/updater.ts) finds the newest APK asset on the GitHub
 * release and hands its URL here. The APK is downloaded into the app cache,
 * then opened through a FileProvider with the system package installer — the
 * user must confirm the install. `versionCode` increases with every release so
 * Android accepts the APK as an in-place update.
 */
@CapacitorPlugin(name = "SkFlexUpdate")
public class UpdatePlugin extends Plugin {

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        String rawName = call.getString("filename", "SK-Flex-Billing-update.apk");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final String filename = sanitizeFilename(rawName);

        call.setKeepAlive(true);
        new Thread(() -> {
            File file = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("Could not create the update folder");
                    return;
                }
                file = new File(dir, filename);
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(60000);
                connection.connect();
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    call.reject("Download failed (HTTP " + status + ")");
                    return;
                }
                try (InputStream in = connection.getInputStream();
                     FileOutputStream out = new FileOutputStream(file)) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = in.read(buffer)) > 0) {
                        out.write(buffer, 0, read);
                    }
                }

                final File apk = file;
                getActivity().runOnUiThread(() -> install(apk, call));
            } catch (Exception e) {
                if (file != null && file.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
                call.reject("Download failed: " + e.getMessage());
            }
        }).start();
    }

    private void install(File apk, PluginCall call) {
        try {
            // Android 8+: the user must allow this app to install packages.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
                JSObject ret = new JSObject();
                ret.put("started", false);
                ret.put("needsPermission", true);
                call.resolve(ret);
                return;
            }

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not open the installer: " + e.getMessage());
        }
    }

    private static String sanitizeFilename(String name) {
        String clean = name.replaceAll("[/\\\\]", "_").trim();
        if (clean.isEmpty()) clean = "SK-Flex-Billing-update.apk";
        return clean.toLowerCase().endsWith(".apk") ? clean : clean + ".apk";
    }
}
