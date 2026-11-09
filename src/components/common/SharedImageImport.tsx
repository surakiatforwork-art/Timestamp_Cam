import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEffect, useRef } from 'react';
import { useCapture } from '../../hooks/useCapture';
import { useApp } from '../../context/AppContext';

const shared = registerPlugin<{
    takeNext(): Promise<{ data?: string; mime?: string; failed?: boolean }>;
}>('SharedImages');

export default function SharedImageImport() {
    const { importPhotos } = useCapture();
    const { showToast } = useApp();
    const busy = useRef(false);
    useEffect(() => {
        if (Capacitor.getPlatform() !== 'android') return;
        async function receive() {
            if (busy.current) return;
            busy.current = true;
            try {
                let index = 0;
                let failed = false;
                for (;;) {
                    const item = await shared.takeNext();
                    if (item.failed) { failed = true; continue; }
                    if (!item.data) break;
                    const bytes = Uint8Array.from(atob(item.data), (char) => char.charCodeAt(0));
                    await importPhotos([new File([bytes], `Shared-${++index}`, { type: item.mime })], true);
                }
                if (failed) showToast('อ่านรูปที่ส่งมาบางรูปไม่ได้', 'error');
            } catch {
                showToast('นำเข้ารูปที่ส่งมาไม่สำเร็จ', 'error');
            } finally {
                busy.current = false;
            }
        }
        void receive();
        window.addEventListener('native-shared-images', receive);
        return () => window.removeEventListener('native-shared-images', receive);
    }, [importPhotos, showToast]);
    return null;
}
