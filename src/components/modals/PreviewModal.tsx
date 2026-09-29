import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { renderPhotoToCanvas } from '../../lib/canvas';
import { downloadOne } from '../../lib/download';
import { getCurrentPosition, resolveLocationQuery, reverseGeocode } from '../../lib/geocoding';
import { dateTimeLocalValueToISO, toDateTimeLocalValue } from '../../lib/format';
import type { DownloadFormat } from '../../types';

export default function PreviewModal() {
    const { state, dispatch, closeModal, updatePhoto, deletePhoto, showToast } = useApp();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [previewInfo, setPreviewInfo] = useState('');
    const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>('jpeg');
    const [jpegQuality, setJpegQuality] = useState(0.92);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isLoadingGPS, setIsLoadingGPS] = useState(false);
    const [locationQuery, setLocationQuery] = useState('');
    const [isSearchingLocation, setIsSearchingLocation] = useState(false);

    const photo = state.photos.find((p) => p.id === state.previewPhotoId);

    // Render preview
    const renderPreview = useCallback(async () => {
        if (!photo || !canvasRef.current) return;

        try {
            const canvas = await renderPhotoToCanvas(photo, state.settings, 600);
            const ctx = canvasRef.current.getContext('2d')!;

            canvasRef.current.width = canvas.width;
            canvasRef.current.height = canvas.height;
            ctx.drawImage(canvas, 0, 0);

            // Calculate line count
            let lineCount = 2; // Network + Local
            const latitude = photo.locationLatitude ?? state.settings.latitude;
            const address = photo.locationAddress ?? state.settings.cachedAddress;

            if (state.settings.locationEnabled) {
                if (state.settings.showLatLng && latitude !== null) lineCount++;
                if (state.settings.showAddress && address) lineCount++;
            }

            const outputW = state.settings.outputMode === 'original' ? photo.width : state.settings.presetSize.w;
            const outputH = state.settings.outputMode === 'original' ? photo.height : state.settings.presetSize.h;

            setPreviewInfo(`Preview: ${outputW}×${outputH} • Overlay ${lineCount} บรรทัด`);
        } catch (e) {
            console.error('Preview render failed:', e);
        }
    }, [photo, state.settings]);

    useEffect(() => {
        renderPreview();
    }, [renderPreview]);

    if (!photo) return null;

    const handleTimeNow = async () => {
        const now = new Date().toISOString();
        await updatePhoto(photo.id, { timeMode: 'now', timeValueISO: now });
        showToast('ตั้งเวลาปัจจุบันแล้ว', 'success');
    };

    const handleTimeCustom = async (value: string) => {
        const iso = dateTimeLocalValueToISO(value);
        await updatePhoto(photo.id, { timeMode: 'custom', timeValueISO: iso });
    };

    const handleLocationNow = async () => {
        if (isLoadingGPS) return;

        setIsLoadingGPS(true);
        try {
            const pos = await getCurrentPosition();
            const address = state.settings.showAddress
                ? await reverseGeocode(pos.lat, pos.lng)
                : null;

            await updatePhoto(photo.id, {
                locationLatitude: pos.lat,
                locationLongitude: pos.lng,
                locationAddress: address,
            });

            showToast('ตั้งตำแหน่งปัจจุบันให้รูปนี้แล้ว', 'success');
        } catch (e) {
            showToast('หาตำแหน่ง GPS ไม่ได้', 'error');
        } finally {
            setIsLoadingGPS(false);
        }
    };

    const handleOpenLocationMap = () => {
        dispatch({ type: 'SET_ACTIVE_MODAL', payload: 'map' });
    };

    const handleLocationSearch = async () => {
        if (!locationQuery.trim() || isSearchingLocation) return;

        setIsSearchingLocation(true);
        try {
            const reference = locationLat !== null && locationLng !== null
                ? { lat: locationLat, lng: locationLng }
                : null;
            const result = await resolveLocationQuery(locationQuery, reference);

            if (!result) {
                showToast('ไม่พบตำแหน่งที่ค้นหา', 'error');
                return;
            }

            await updatePhoto(photo.id, {
                locationLatitude: result.lat,
                locationLongitude: result.lng,
                locationAddress: result.displayName,
            });
            setLocationQuery('');
            showToast('ตั้งตำแหน่งจากการค้นหาแล้ว', 'success');
        } catch (e) {
            showToast('ค้นหาตำแหน่งไม่สำเร็จ', 'error');
        } finally {
            setIsSearchingLocation(false);
        }
    };

    const handleDownload = async () => {
        if (isDownloading) return;
        setIsDownloading(true);

        try {
            const index = state.photos.findIndex((p) => p.id === photo.id);
            await downloadOne(photo, state.settings, downloadFormat, jpegQuality, index);
            showToast('ดาวน์โหลดแล้ว', 'success');
        } catch (e) {
            showToast('ดาวน์โหลดไม่สำเร็จ', 'error');
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDelete = async () => {
        await deletePhoto(photo.id);
        closeModal();
        showToast('ลบรูปแล้ว', 'info');
    };

    const timeValue = toDateTimeLocalValue(photo.timeValueISO);
    const locationLat = photo.locationLatitude ?? state.settings.latitude;
    const locationLng = photo.locationLongitude ?? state.settings.longitude;
    const locationAddress = photo.locationAddress ?? state.settings.cachedAddress;
    const locationSource = photo.locationLatitude !== undefined ? 'ตำแหน่งเฉพาะรูป' : 'ใช้ค่าจาก Settings';

    return (
        <div className="modal-backdrop preview-modal" onClick={closeModal}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>พรีวิวรูป</h2>
                    <button className="icon-btn" onClick={closeModal}>✕</button>
                </div>

                <div className="preview-canvas-container">
                    <canvas ref={canvasRef} />
                </div>

                <div className="preview-info">{previewInfo}</div>

                <div className="preview-controls">
                    {/* Time settings for this photo */}
                    <div className="preview-section">
                        <h4>เวลาสำหรับรูปนี้</h4>
                        <div className="preview-time-buttons">
                            <button
                                className={`btn btn-sm ${photo.timeMode === 'now' ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={handleTimeNow}
                            >
                                ⏱️ ใช้เวลาปัจจุบัน
                            </button>
                            <input
                                type="datetime-local"
                                value={timeValue}
                                step="1"
                                onChange={(e) => handleTimeCustom(e.target.value)}
                                style={{ flex: 1 }}
                            />
                        </div>
                    </div>

                    {state.settings.locationEnabled && (
                        <div className="preview-section">
                            <h4>ตำแหน่งสำหรับรูปนี้</h4>
                            <div className="preview-time-buttons">
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={handleLocationNow}
                                    disabled={isLoadingGPS}
                                >
                                    {isLoadingGPS ? '⏳ กำลังหา GPS...' : '📡 ใช้ตำแหน่งปัจจุบัน'}
                                </button>
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={handleOpenLocationMap}
                                >
                                    🗺️ เลือกตำแหน่ง
                                </button>
                            </div>
                            <div className="preview-time-buttons" style={{ marginTop: 8 }}>
                                <input
                                    type="text"
                                    value={locationQuery}
                                    onChange={(e) => setLocationQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleLocationSearch()}
                                    placeholder="ค้นหาที่อยู่ / 13.8578990, 100.5380720 / VG5Q+564 ... / 13°51'28.4&quot;N 100°32'17.1&quot;E"
                                    style={{ flex: 1, minWidth: 0 }}
                                />
                                <button
                                    className="btn btn-sm btn-primary"
                                    onClick={handleLocationSearch}
                                    disabled={!locationQuery.trim() || isSearchingLocation}
                                >
                                    {isSearchingLocation ? '⏳' : '🔍'} ค้นหา
                                </button>
                            </div>
                            <p className="settings-note">
                                {locationLat !== null && locationLng !== null
                                    ? `${locationSource}: ${locationLat.toFixed(6)}, ${locationLng.toFixed(6)}`
                                    : 'ยังไม่ได้ระบุตำแหน่ง'}
                            </p>
                            {locationAddress && (
                                <p className="settings-note" style={{ color: 'var(--accent)' }}>
                                    📍 {locationAddress}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Download format */}
                    <div className="preview-section">
                        <h4>รูปแบบไฟล์</h4>
                        <div className="preview-format-row">
                            <select
                                value={downloadFormat}
                                onChange={(e) => setDownloadFormat(e.target.value as DownloadFormat)}
                            >
                                <option value="jpeg">JPEG</option>
                                <option value="png">PNG</option>
                            </select>

                            {downloadFormat === 'jpeg' && (
                                <>
                                    <label>คุณภาพ:</label>
                                    <input
                                        type="range"
                                        min="0.7"
                                        max="1"
                                        step="0.01"
                                        value={jpegQuality}
                                        onChange={(e) => setJpegQuality(parseFloat(e.target.value))}
                                        style={{ width: 100 }}
                                    />
                                    <span>{Math.round(jpegQuality * 100)}%</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="preview-actions">
                    <button
                        className="btn btn-primary"
                        onClick={handleDownload}
                        disabled={isDownloading}
                    >
                        {isDownloading ? '⏳ กำลังดาวน์โหลด...' : '💾 ดาวน์โหลด'}
                    </button>
                    <button className="btn btn-danger" onClick={handleDelete}>
                        🗑️ ลบรูปนี้
                    </button>
                </div>
            </div>
        </div>
    );
}
