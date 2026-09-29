package com.example.timestamp;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DeviceFeedback")
public class DeviceFeedbackPlugin extends Plugin {
    @PluginMethod
    public void vibrate(PluginCall call) {
        int duration = Math.max(1, Math.min(200, call.getInt("duration", 35)));
        Vibrator vibrator;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = manager == null ? null : manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        }

        if (vibrator != null && vibrator.hasVibrator()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                vibrator.vibrate(duration);
            }
        }
        call.resolve();
    }
}
