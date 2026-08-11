package com.skflexbilling.app;

import android.Manifest;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saves a base64-encoded file directly to the device's Downloads folder.
 *
 * This replaces the old flow (write to app cache + open the Android share
 * sheet), which routed downloads through Quick Share instead of actually
 * saving the file. On Android 10+ (API 29+) the write goes through the
 * MediaStore Downloads collection — scoped storage, NO permission required.
 * On older devices it writes to the public Downloads directory and requests
 * the legacy WRITE_EXTERNAL_STORAGE permission only when needed.
 */
@CapacitorPlugin(
    name = "Download",
    permissions = {
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
    }
)
public class DownloadPlugin extends Plugin {

    private static final String STORAGE = "storage";
    private static final String PERMISSION_DENIED = "Storage permission denied";

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String data = call.getString("data");
        String filename = call.getString("filename");
        String mime = call.getString("mime", "application/octet-stream");
        if (data == null || data.isEmpty() || filename == null || filename.isEmpty()) {
            call.reject("data and filename are required");
            return;
        }
        filename = sanitizeFilename(filename);

        // Android 10+ (scoped storage): MediaStore Downloads insert needs no
        // runtime permission — save immediately, never open the share sheet.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(call, data, filename, mime);
            return;
        }

        // Older Android: public Downloads write needs WRITE_EXTERNAL_STORAGE.
        // Request it only when required (i.e. not yet granted).
        if (!hasStoragePermission()) {
            requestPermissionForAlias(STORAGE, call, "storagePermissionCallback");
            return;
        }
        saveLegacy(call, data, filename);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (!hasStoragePermission()) {
            call.reject(PERMISSION_DENIED);
            return;
        }
        String data = call.getString("data");
        String filename = sanitizeFilename(call.getString("filename", ""));
        saveLegacy(call, data, filename);
    }

    private void saveViaMediaStore(PluginCall call, String data, String filename, String mime) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, mime);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/SKFlexBilling");
        Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri item = null;
        try {
            item = getContext().getContentResolver().insert(collection, values);
            if (item == null) {
                call.reject("Could not create the file in Downloads");
                return;
            }
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            try (OutputStream os = getContext().getContentResolver().openOutputStream(item)) {
                if (os == null) throw new IllegalStateException("No output stream for " + item);
                os.write(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("uri", item.toString());
            ret.put("filename", filename);
            call.resolve(ret);
        } catch (Exception e) {
            if (item != null) {
                try {
                    getContext().getContentResolver().delete(item, null, null);
                } catch (Exception ignored) {
                    // best-effort cleanup
                }
            }
            call.reject("Download failed: " + e.getMessage());
        }
    }

    private void saveLegacy(PluginCall call, String data, String filename) {
        try {
            File dir = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "SKFlexBilling"
            );
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Could not create the Downloads folder");
                return;
            }
            File file = new File(dir, filename);
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("path", file.getAbsolutePath());
            ret.put("filename", filename);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Download failed: " + e.getMessage());
        }
    }

    private boolean hasStoragePermission() {
        return getContext().checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    private static String sanitizeFilename(String name) {
        // Strip any path separators so the filename can never escape the
        // Downloads folder (the JS side already runs fileNameSafe()).
        String clean = name.replaceAll("[/\\\\]", "_").trim();
        return clean.isEmpty() ? "download" : clean;
    }
}
