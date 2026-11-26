# High refresh-rate support — Timestamp, GhostShift, Image Keeper

Date: 2026-11-27

## User request
Allow all three Android apps to render their UI smoothly on devices with refresh rates up to 120 Hz, without forcing the camera, ML processing or timer updates to run 120 times per second.

## Findings
- Timestamp v1.5.9: Android Capacitor/WebView app had **no native display-mode preference**. Time-based requestAnimationFrame animations (PremiumWheel, Stage) and browser compositor animations are already refresh-aware; LiveOverlay intentionally only repaints its text approximately every second.
- GhostShift native app: MainActivity already requests a matching-resolution display mode up to 120.5 Hz in onResume(), falling back to the device's display mode if there is no supported higher mode.
- Image Keeper native app: MainActivity already has the same matching-resolution, <= 120.5 Hz preference in onResume(). Both are Android/Compose-native and frame pacing follows system vsync.

## Timestamp implementation
- Added requestUpTo120Hz() to MainActivity.java and call from onResume().
- Pick the highest hardware-supported mode strictly above 60.5 Hz, no more than 120.5 Hz, with **exactly the same physical resolution** as the active mode.
- Set only WindowManager.LayoutParams.preferredDisplayModeId; do **not** change global Android settings, and don't attempt to override battery saver, power throttling or user screen settings.
- For unsupported/60Hz displays, do nothing and leave the operating-system default.
- Do not manually loop at 120 FPS; avoid extra battery use for camera frames and timestamp overlays.
- Bumped Capacitor package and native Android version to **1.5.10** (versionCode **10510**).
- Preserved camera permissions, shutter handling, media storage and update features.

## Verification
- Timestamp `npm run build`: PASS (TypeScript + Vite).
- Timestamp `npx cap copy android`: PASS (web assets synchronized into Capacitor assets).
- Timestamp Android `:app:assembleDebug :app:testDebugUnitTest`: BUILD SUCCESSFUL.
- In-place ADB installation on emulator-5580: 1.5.9 -> 1.5.10, success. App started and its process was observed.
- GhostShift `:app:assembleDebug`: BUILD SUCCESSFUL (existing up-to-120Hz code, no source changes).
- Image Keeper `:app:assembleDebug`: BUILD SUCCESSFUL (existing up-to-120Hz code, no source changes).
- Emulator display reports 1080x2400 with **60.000004 Hz as its only supported mode**. Therefore it can validate the fallback, but cannot measure the apps at 120 FPS.
- **Important:** 120 Hz mode preference is not proof of 120 drawn FPS; 120 FPS must be measured with Android FrameTimeline/Perfetto or frame metrics on a real 120 Hz device. Camera preview and AI frame rates are separate.

## Test APK
`test_apks/Timestamp_v1.5.10_120Hz_DisplayMode_TEST.apk`

## Production consideration
The high-refresh preference may increase power use compared to the default refresh rate on some devices. Android retains final control. Do not claim all users will receive 120 FPS.
