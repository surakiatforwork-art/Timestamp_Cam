import { useEffect } from 'react';
import { CameraIcon, CameraOff, Download, Flashlight, FlashlightOff, LoaderCircle, Settings, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useCamera } from '../../hooks/useCamera';
import { Camera } from '@capacitor/camera';
import { downloadAll } from '../../lib/download';
import { finishDownload } from '../../lib/downloadCleanup';
import { log } from '../../lib/logger';

export default function Topbar() {
    const { state, dispatch, showToast, trashPhotos } = useApp();
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
    useEffect(() => {
        const open = () => { if (!state.importProgress) void handleImport(); };
        window.addEventListener('timestamp-open-import', open);
        return () => window.removeEventListener('timestamp-open-import', open);
    });
    // Removed handleFileChange as we don't use input[type=file] anymore

    const handleDownloadAll = async () => {
        if (state.photos.length === 0 || state.downloadProgress || state.importProgress) return;

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

            await finishDownload(result,state.photos.length,state.settings.autoTrashAfterDownload,trashPhotos,showToast);
        } catch (e) {
            log(`Download all failed: ${e}`, 'error');
            showToast('ดาวน์โหลดไม่สำเร็จ', 'error');
        } finally { dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: null }); }
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
                        {cameraOn ? <CameraIcon className="ui-icon" aria-hidden="true" /> : <CameraOff className="ui-icon" aria-hidden="true" />}
                    </span>
                </button>
                {/* Torch */}
                <button
                    className={`icon-btn ${torchOn ? 'active' : ''}`}
                    onClick={toggleTorch}
                    disabled={!canUseTorch}
                    title="แฟลช"
                >
                    {torchOn ? <Flashlight className="ui-icon" aria-hidden="true" /> : <FlashlightOff className="ui-icon" aria-hidden="true" />}
                </button>

            </div>

            <div className="topbar-center" aria-hidden="true" />

            <div className="topbar-right">
                {/* Download All */}
                <button
                    className="icon-btn"
                    onClick={handleDownloadAll}
                    disabled={state.photos.length === 0 || state.downloadProgress !== null}
                    title="ดาวน์โหลดทั้งหมด"
                >
                    {state.downloadProgress ? <LoaderCircle className="ui-icon spinning" aria-hidden="true" /> : <Download className="ui-icon" aria-hidden="true" />}
                </button>

                <span className="toolbar-divider" aria-hidden="true" />
                <button
                    className="icon-btn"
                    onClick={() => dispatch({ type: 'SET_ACTIVE_MODAL', payload: 'trash' })}
                    title="ถังขยะ"
                >
                    <Trash2 className="ui-icon" aria-hidden="true" />
                </button>
                {/* Settings */}
                <button
                    className="icon-btn"
                    onClick={handleSettings}
                    title="ตั้งค่า"
                >
                    <Settings className="ui-icon" aria-hidden="true" />
                </button>
            </div>
        </header>
    );
}
