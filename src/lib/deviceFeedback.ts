import { Capacitor, registerPlugin } from '@capacitor/core';

interface DeviceFeedbackPlugin {
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
