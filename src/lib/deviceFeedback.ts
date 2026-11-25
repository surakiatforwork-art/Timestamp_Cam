import { Capacitor, registerPlugin } from '@capacitor/core';

interface DeviceFeedbackPlugin {
    setShutterEnabled(options: { enabled: boolean }): Promise<void>;
    vibrate(options: { duration: number }): Promise<void>;
}

const DeviceFeedback = registerPlugin<DeviceFeedbackPlugin>('DeviceFeedback');

export function vibrateForCapture(): void {
    if (Capacitor.isNativePlatform()) {
        void DeviceFeedback.vibrate({ duration: 35 }).catch(() => navigator.vibrate?.(35));
        return;
    }
    navigator.vibrate?.(35);
}

export function vibrateForTick(): void {
    if (Capacitor.isNativePlatform()) void DeviceFeedback.vibrate({ duration: 8 }).catch(() => {});
}
export function setHardwareShutter(enabled: boolean): void {
    if (Capacitor.isNativePlatform()) void DeviceFeedback.setShutterEnabled({ enabled }).catch(() => {});
}
