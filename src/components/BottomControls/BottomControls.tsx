import { useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useCamera } from '../../hooks/useCamera';
import { useCapture } from '../../hooks/useCapture';
import { formatTimeSummary, formatLocationSummary } from '../../lib/format';
import DateTimeWheelPicker from '../common/DateTimeWheelPicker';

export default function BottomControls() {
    const { state, dispatch, deleteAllPhotos, openPreview, showToast } = useApp();
    const { videoRef, cameraOn, cameraStatus, hasMultipleCameras, switchCamera } = useCamera();
    const { capturePhoto, importPhotos, isCapturing } = useCapture();
    const galleryRef = useRef<HTMLDivElement>(null);

    const { photos, settings } = state;

    // Listen for import event
    useEffect(() => {
        const handleImport = async (e: Event) => {
            const files = (e as CustomEvent).detail as FileList;
            await importPhotos(files);
        };

        window.addEventListener('do-import', handleImport);
        return () => window.removeEventListener('do-import', handleImport);
    }, [importPhotos]);

    // Auto-scroll gallery to end when new photo added
    useEffect(() => {
        if (galleryRef.current && photos.length > 0) {
            galleryRef.current.scrollLeft = galleryRef.current.scrollWidth;
        }
    }, [photos.length]);

    const handleCapture = async () => {
        if (!videoRef.current || cameraStatus !== 'ready') return;
        await capturePhoto(videoRef.current);
    };


    const handleDeleteAll = async () => {
        if (photos.length === 0) return;
        if (!confirm(`ลบรูปทั้งหมด ${photos.length} รูป?`)) return;
        await deleteAllPhotos();
        showToast('ลบรูปทั้งหมดแล้ว', 'info');
    };

    const timeSummary = formatTimeSummary(settings.globalTimeMode, settings.globalCustomTime);
    const locationSummary = formatLocationSummary(
        settings.locationEnabled,
        settings.latitude,
        settings.longitude,
        settings.cachedAddress
    );

    const canCapture = cameraOn && cameraStatus === 'ready' && !isCapturing;
    const canSwitchCamera = cameraOn && hasMultipleCameras && cameraStatus === 'ready';

    return (
        <div className="bottom-controls">
            {/* Meta Bar */}
            <div className="meta-bar">
                <div className="meta-row">
                    <span className="meta-label">เวลา</span>
                    <span className="meta-value">{timeSummary}</span>
                    <button
                        className={`toggle meta-toggle ${settings.globalTimeMode === 'now' ? 'on' : ''}`}
                        onClick={() => {
                            dispatch({
                                type: 'SET_SETTINGS',
                                payload: {
                                    globalTimeMode: settings.globalTimeMode === 'now' ? 'custom' : 'now',
                                },
                            });
                        }}
                        title={settings.globalTimeMode === 'now' ? 'ใช้เวลาปัจจุบัน' : 'ใช้เวลากำหนดเอง'}
                    >
                        <span className="toggle-knob">
                            {settings.globalTimeMode === 'now' ? '⏱️' : '📅'}
                        </span>
                    </button>
                </div>

                {settings.globalTimeMode === 'custom' && (
                    <div className="meta-row">
                        <span className="meta-label"></span>
                        <DateTimeWheelPicker
                            value={settings.globalCustomTime}
                            className="meta-time-input"
                            onChange={(globalCustomTime) => dispatch({
                                type: 'SET_SETTINGS',
                                payload: { globalCustomTime },
                            })}
                        />
                    </div>
                )}

                <div className="meta-row">
                    <span className="meta-label">ตำแหน่ง</span>
                    <span className="meta-value">{locationSummary}</span>
                    <span className="meta-pill">{photos.length} รูป</span>
                </div>
            </div>

            {/* Gallery Strip */}
            <div className="gallery-strip" ref={galleryRef}>
                {photos.map((photo, index) => (
                    <div
                        key={photo.id}
                        className="thumbnail"
                        onClick={() => openPreview(photo.id)}
                    >
                        <img src={photo.thumbUrl} alt={`Photo ${index + 1}`} />
                        <span className="thumbnail-badge">{index + 1}</span>


                    </div>
                ))}
            </div>

            {/* Action Buttons */}
            <div className="action-buttons">
                <div className="action-btn-left">
                    <button
                        className="delete-all-btn"
                        onClick={handleDeleteAll}
                        disabled={photos.length === 0}
                    >
                        🗑️ ลบทั้งหมด
                    </button>
                </div>

                <button
                    className={`shutter-btn ${isCapturing ? 'is-capturing' : ''}`}
                    onClick={handleCapture}
                    disabled={!canCapture}
                    title="ถ่ายรูป"
                />

                <div className="action-btn-right">
                    <button
                        className="switch-cam-btn"
                        onClick={switchCamera}
                        disabled={!canSwitchCamera}
                        title="สลับกล้อง"
                    >
                        🔄
                    </button>
                </div>
            </div>
        </div>
    );
}
