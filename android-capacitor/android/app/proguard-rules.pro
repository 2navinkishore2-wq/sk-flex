# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# Capacitor
-keep class com.getcapacitor.** { *; }
-keep class com.skflex.billing.** { *; }

# Keep plugin classes
-keep class com.getcapacitor.community.print.** { *; }
-keep class com.getcapacitor.plugin.filesystem.** { *; }
-keep class com.getcapacitor.plugin.splashscreen.** { *; }
-keep class com.getcapacitor.plugin.statusbar.** { *; }