import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';

export default function TrashReminder() {
    const { state, dispatch } = useApp();
    const [dismissed, setDismissed] = useState(false);
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const refresh = () => setNow(Date.now());
        const timer = window.setInterval(refresh, 60 * 1000);
        window.addEventListener('native-app-resume', refresh);
        return () => { window.clearInterval(timer); window.removeEventListener('native-app-resume', refresh); };
    }, []);
    const oldCount = state.trashPhotos.filter((photo) => now - Date.parse(photo.deletedAtISO) > 30 * 86400000).length;
    if (dismissed || state.trashStatus !== 'ready' || !oldCount || state.activeModal !== 'none'
        || state.downloadProgress || state.importProgress) return null;

    return (
        <div className="download-progress-backdrop" role="dialog" aria-modal="true" aria-labelledby="trash-reminder-title">
            <div className="download-progress-dialog">
                <strong id="trash-reminder-title">มีรูปในถังขยะเกิน 30 วัน</strong>
                <p>พบ {oldCount} รูป ภาพยังถูกเก็บไว้จนกว่าคุณจะเลือกลบถาวร</p>
                <div className="trash-reminder-actions">
                    <button className="btn btn-secondary" onClick={() => setDismissed(true)}>ภายหลัง</button>
                    <button className="btn btn-primary" onClick={() => {
                        setDismissed(true);
                        dispatch({ type: 'SET_ACTIVE_MODAL', payload: 'trash' });
                    }}>เปิดถังขยะ</button>
                </div>
            </div>
        </div>
    );
}
