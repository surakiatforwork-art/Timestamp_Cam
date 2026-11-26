package com.example.timestamp;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import android.util.Log;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.GeolocationPermissions;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    
    private boolean shutterEnabled = false;
    private boolean backPending = false;
    private final java.util.Set<Integer> heldShutterKeys = new java.util.HashSet<>();
    public void setShutterEnabled(boolean enabled) { shutterEnabled = enabled; }

    @Override
    public boolean dispatchKeyEvent(android.view.KeyEvent event) {
        final int key = event.getKeyCode();
        if (key == android.view.KeyEvent.KEYCODE_VOLUME_DOWN || key == android.view.KeyEvent.KEYCODE_VOLUME_UP) {
            if (event.getAction() == android.view.KeyEvent.ACTION_DOWN && hasWindowFocus()) {
                if (heldShutterKeys.contains(key)) return true;
                if (shutterEnabled && event.getRepeatCount() == 0) {
                    // Either key is a shutter; a simultaneous two-key press is one capture.
                    final boolean firstKey = heldShutterKeys.isEmpty();
                    heldShutterKeys.add(key);
                    if (firstKey) emitWebLifecycleEvent("native-hardware-shutter");
                    return true;
                }
            }
            if (event.getAction() == android.view.KeyEvent.ACTION_UP && heldShutterKeys.remove(key)) {
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) heldShutterKeys.clear();
    }

    private static final int PERMISSION_REQUEST_CODE = 100;
    final java.util.concurrent.ConcurrentLinkedQueue<Uri> sharedImages = new java.util.concurrent.ConcurrentLinkedQueue<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaStorePlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(DeviceFeedbackPlugin.class);
        registerPlugin(PhotoStoragePlugin.class);
        registerPlugin(SharedImagesPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (backPending) return;
                if (getBridge() == null || getBridge().getWebView() == null) { moveTaskToBack(true); return; }
                backPending = true;
                getBridge().getWebView().evaluateJavascript(
                    "typeof window.timestampHandleBack === 'function' ? window.timestampHandleBack() : false",
                    result -> { backPending = false; if ("false".equals(result) && hasWindowFocus()) moveTaskToBack(true); }
                );
            }
        });
        if (savedInstanceState == null) enqueueImages(getIntent());
        
        // Request permissions on startup
        requestRequiredPermissions();
    }
    
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        enqueueImages(intent);
        emitWebLifecycleEvent("native-shared-images");
    }

    @SuppressWarnings("deprecation")
    private void enqueueImages(Intent intent) {
        if (intent == null || intent.getType() == null || !intent.getType().startsWith("image/")) return;
        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> items = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (items != null) for (Uri item : items) enqueueImage(item);
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            enqueueImage(intent.getParcelableExtra(Intent.EXTRA_STREAM));
        }
    }

    private void enqueueImage(Uri uri) {
        if (uri != null && "content".equals(uri.getScheme())) sharedImages.add(uri);
    }

    @Override
    public void onStart() {
        super.onStart();
        // Configure WebView after bridge is ready
        configureWebView();
    }

    @Override
    public void onPause() {
        shutterEnabled = false;
        heldShutterKeys.clear();
        emitWebLifecycleEvent("native-app-pause");
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        // A display-mode request, not a 120 FPS video/camera lock. WebView
        // requestAnimationFrame and CSS transitions follow display vsync.
        requestUpTo120Hz();
        // Wait until the activity and WebView are foregrounded before React reacquires MediaStream.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().postDelayed(
                () -> emitWebLifecycleEvent("native-app-resume"),
                250
            );
        }
    }

    /**
     * Ask Android for the highest compatible 60/90/120 Hz display mode.
     * The system retains final control for battery saver, thermal and user
     * preferences. Never request another resolution or a mode > 120 Hz.
     * Not all camera streams support 120 fps; they remain untouched.
     */
    @SuppressWarnings("deprecation")
    private void requestUpTo120Hz() {
        final Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? getDisplay() : getWindowManager().getDefaultDisplay();
        if (display == null) return;
        final Display.Mode current = display.getMode();
        Display.Mode best = null;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() != current.getPhysicalWidth() ||
                mode.getPhysicalHeight() != current.getPhysicalHeight()) continue;
            final float hz = mode.getRefreshRate();
            if (hz > 120.5f || hz <= 60.5f) continue;
            if (best == null || hz > best.getRefreshRate()) best = mode;
        }
        if (best == null) {
            Log.d("TimestampRefresh", "No high-refresh mode; system default");
            return;
        }
        final WindowManager.LayoutParams params = getWindow().getAttributes();
        if (params.preferredDisplayModeId != best.getModeId()) {
            params.preferredDisplayModeId = best.getModeId();
            getWindow().setAttributes(params);
        }
        Log.d("TimestampRefresh", "Requested " + best.getRefreshRate() + " Hz (mode " +
            best.getModeId() + "), actual timing is Android-controlled");
    }

    private void emitWebLifecycleEvent(String eventName) {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new Event('" + eventName + "'));",
            null
        );
    }
    
    private void requestRequiredPermissions() {
        List<String> permissionsNeeded = new ArrayList<>();
        
        // Camera permission
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) 
                != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.CAMERA);
        }
        
        // Location permissions
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        
        // Storage permissions for Android 12 and below
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) 
                    != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
        }

        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
            }
        }
        
        // Media images permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) 
                    != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.READ_MEDIA_IMAGES);
            }
        }
        
        // Request all needed permissions
        if (!permissionsNeeded.isEmpty()) {
            ActivityCompat.requestPermissions(this, 
                    permissionsNeeded.toArray(new String[0]), 
                    PERMISSION_REQUEST_CODE);
        }
    }
    
    private void configureWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        
        // Enable JavaScript
        settings.setJavaScriptEnabled(true);
        
        // Enable DOM storage
        settings.setDomStorageEnabled(true);
        
        // Enable database
        settings.setDatabaseEnabled(true);
        
        // Enable geolocation
        settings.setGeolocationEnabled(true);
        
        // Allow file access
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        
        // Enable media playback
        settings.setMediaPlaybackRequiresUserGesture(false);
        
        // Mixed content mode
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        
        // Set WebChromeClient for permissions and file chooser
        webView.setWebChromeClient(new WebChromeClient() {
            
            // Handle WebRTC/getUserMedia permission requests (Camera)
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    // Check if camera permission is granted at Android level
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) 
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        // Request permission again
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.CAMERA},
                                PERMISSION_REQUEST_CODE);
                        request.grant(request.getResources());
                    }
                });
            }
            
            // Handle geolocation permission requests
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, 
                    GeolocationPermissions.Callback callback) {
                // Check if location permission is granted
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) 
                        == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.ACCESS_FINE_LOCATION},
                            PERMISSION_REQUEST_CODE);
                    callback.invoke(origin, true, false);
                }
            }
            

        });
    }
    
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, 
            @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        
        if (requestCode == PERMISSION_REQUEST_CODE) {
            // Check if all permissions granted, then reload webview
            boolean allGranted = true;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            
            if (allGranted && getBridge() != null && getBridge().getWebView() != null) {
                // Reload to apply new permissions
                getBridge().getWebView().reload();
            }
        }
    }
}
