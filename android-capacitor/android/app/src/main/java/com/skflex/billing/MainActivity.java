package com.skflex.billing;

import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(com.capacitorjs.plugins.filesystem.FilesystemPlugin.class);
        registerPlugin(com.capacitorjs.plugins.splashscreen.SplashScreenPlugin.class);
        registerPlugin(com.capacitorjs.plugins.statusbar.StatusBarPlugin.class);
        super.onCreate(savedInstanceState);

        // Enable Edge-to-Edge UI (Android 15+)
        enableEdgeToEdge();
    }

    /**
     * Enables edge-to-edge display with a light status bar and transparent navigation bar.
     * The status bar background is the app's red brand color.
     */
    private void enableEdgeToEdge() {
        View decorView = getWindow().getDecorView();

        // Enable edge-to-edge
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Light text on the red status bar
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decorView);
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }

        // Set the status bar color to the SK Flex brand red
        getWindow().setStatusBarColor(android.graphics.Color.parseColor("#D2222A"));
        // Transparent navigation bar for immersive edge-to-edge look
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
    }
}