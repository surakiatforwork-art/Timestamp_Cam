import { useApp } from '../../context/AppContext';
import { useCamera } from '../../hooks/useCamera';
import { Camera } from '@capacitor/camera';
import { downloadAll } from '../../lib/download';
import { log } from '../../lib/logger';

export default function Topbar() {
    const { state, dispatch, showToast } = useApp();
    const { cameraOn, toggleCameraOn, torchOn, toggleTorch, hasTorch, cameraStatus } = useCamera();
    const handleImport = async () => {
        try {
            const result = await Camera.pickImages({
                quality: 100,
                limit: 20 // Reasonable limit for performance
            });

            if (result.photos.length > 0) {
                showToast('กำลังนำเข้ารูปภาพ...', 'info');
                dispatch({ type: 'SET_IMPORT_PROGRESS', payload: { current: 0, total: result.photos.length } });

                // Convert GalleryPhotos to Files
                const files = await Promise.all(result.photos.map(async (photo) => {
                    const response = await fetch(photo.webPath);
                    const blob = await response.blob();
                    // Generate a filename based on timestamp or format
                    const ext = photo.format || 'jpg';
                    const filename = `imported_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
                    return new File([blob], filename, { type: blob.type });
                }));

                const event = new CustomEvent('import-files', { detail: files });
                window.dispatchEvent(event);
            }
        } catch (e) {
            dispatch({ type: 'SET_IMPORT_PROGRESS', payload: null });
            // Check if user cancelled
            if ((e as any).message !== 'User cancelled photos app') {
                log(`Pick images failed: ${e}`, 'error');
                showToast('เลือกรูปภาพไม่สำเร็จ', 'error');
            }
        }
    };
    // Removed handleFileChange as we don't use input[type=file] anymore

    const handleDownloadAll = async () => {
        if (state.photos.length === 0) return;

        log('Starting download all');
        dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: { current: 0, total: state.photos.length } });

        try {
            const result = await downloadAll(
                state.photos,
                state.settings,
                'jpeg',
                0.92,
                (current, total) => {
                    dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: { current, total } });
                }
            );

            dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: null });

            if (result.success) {
                showToast(`ดาวน์โหลดสำเร็จ (${result.method})`, 'success');
                log(`Download all completed: ${result.method}`);
            }
        } catch (e) {
            dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: null });
            log(`Download all failed: ${e}`, 'error');
            showToast('ดาวน์โหลดไม่สำเร็จ', 'error');
        }
    };

    const handleSettings = () => {
        dispatch({ type: 'SET_ACTIVE_MODAL', payload: 'settings' });
    };

    const isCameraReady = cameraStatus === 'ready';
    const canUseTorch = hasTorch && isCameraReady && cameraOn;

    return (
        <header className="topbar">
            <div className="topbar-left">
                {/* Camera Toggle */}
                <button
                    className={`camera-toggle ${cameraOn ? 'on' : ''}`}
                    onClick={toggleCameraOn}
                    title={cameraOn ? 'ปิดกล้อง' : 'เปิดกล้อง'}
                >
                    <span className="camera-toggle-knob">
                        {cameraOn ? '📷' : '🚫'}
                    </span>
                </button>
            </div>

            <div className="topbar-center" aria-hidden="true" />

            <div className="topbar-right">
                <button
                    className="icon-btn"
                    onClick={() => dispatch({ type: 'SET_ACTIVE_MODAL', payload: 'trash' })}
                    title="ถังขยะ"
                >
                    🗑️
                </button>
                {/* Torch */}
                <button
                    className={`icon-btn ${torchOn ? 'active' : ''}`}
                    onClick={toggleTorch}
                    disabled={!canUseTorch}
                    title="แฟลช"
                >
                    {torchOn ? '🔦' : '💡'}
                </button>

                {/* Import */}
                <button
                    className="icon-btn"
                    onClick={handleImport}
                    disabled={state.importProgress !== null}
                    title={state.importProgress ? `กำลังนำเข้า ${state.importProgress.current}/${state.importProgress.total}` : 'นำเข้ารูป'}
                >
                    {state.importProgress ? '⏳' : '📥'}
                </button>


                {/* Download All */}
                <button
                    className="icon-btn"
                    onClick={handleDownloadAll}
                    disabled={state.photos.length === 0 || state.downloadProgress !== null}
                    title="ดาวน์โหลดทั้งหมด"
                >
                    {state.downloadProgress ? '⏳' : '💾'}
                </button>

                {/* Settings */}
                <button
                    className="icon-btn"
                    onClick={handleSettings}
                    title="ตั้งค่า"
                >
                    ⚙️
                </button>
            </div>
        </header>
    );
}
