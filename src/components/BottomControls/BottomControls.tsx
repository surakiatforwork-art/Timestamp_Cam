import { isConfirmOpen } from '../common/ConfirmDialog';
import { RefreshCw, Flashlight, FlashlightOff } from 'lucide-react';
import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { setHardwareShutter } from '../../lib/deviceFeedback';
import { useApp } from '../../context/AppContext';
import { useCamera } from '../../hooks/useCamera';
import { useCapture } from '../../hooks/useCapture';
import { formatLocationSummary } from '../../lib/format';
import { useLiveLocation,resolveActiveLocation } from '../../lib/liveLocation';
import PhotoGallery from './PhotoGallery';

export default function BottomControls() {
    const { state } = useApp();
    const { videoRef, cameraOn, cameraStatus, hasMultipleCameras, switchCamera, torchOn, hasTorch, toggleTorch } = useCamera();
    const { capturePhoto, importPhotos, isCapturing } = useCapture();

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

    const [pickerOpen, setPickerOpen] = useState(false);
    const [torchBusy,setTorchBusy]=useState(false);
    const torchLock=useRef(false);
    const canUseTorch=cameraOn&&cameraStatus==='ready'&&hasTorch&&!state.importProgress&&!state.downloadProgress&&!torchBusy;
    const handleTorch=async()=>{
        if(!canUseTorch||torchLock.current)return;
        torchLock.current=true;setTorchBusy(true);
        try{await toggleTorch();}finally{torchLock.current=false;setTorchBusy(false);}
    };
    useEffect(() => {
        const open = () => setPickerOpen(true), close = () => setPickerOpen(false);
        window.addEventListener('timestamp-picker-open', open);
        window.addEventListener('timestamp-picker-close', close);
        return () => { window.removeEventListener('timestamp-picker-open', open); window.removeEventListener('timestamp-picker-close', close); };
    }, []);
    const handleCapture = async () => {
        if (!cameraOn || !videoRef.current || cameraStatus !== 'ready' || isCapturing || state.activeModal !== "none" || pickerOpen || document.querySelector('.topbar-more-panel') || isConfirmOpen() || state.importProgress || state.downloadProgress) return;
        await capturePhoto(videoRef.current);
    };


    const live=useLiveLocation();
    const fix=resolveActiveLocation(settings,live);
    const locationSummary=settings.locationEnabled&&settings.locationMode==='gps'&&fix.status!=='ready'
        ? (fix.status==='waiting'?'กำลังหาตำแหน่ง GPS…':'GPS ไม่พร้อม · ตรวจสอบสิทธิ์')
        : formatLocationSummary(settings.locationEnabled,fix.lat,fix.lng,fix.address);

    useEffect(() => {
        const active = cameraOn && cameraStatus === 'ready' && state.activeModal === 'none' && !pickerOpen && !state.importProgress && !state.downloadProgress;
        setHardwareShutter(active);
        return () => setHardwareShutter(false);
    }, [cameraOn, cameraStatus, state.activeModal, pickerOpen, state.importProgress, state.downloadProgress]);
    useLayoutEffect(() => {
        const shutter = () => { void handleCapture(); };
        window.addEventListener('native-hardware-shutter', shutter);
        return () => window.removeEventListener('native-hardware-shutter', shutter);
    });
    const canCapture = cameraOn && cameraStatus === 'ready' && !isCapturing;
    const canSwitchCamera = cameraOn && hasMultipleCameras && cameraStatus === 'ready';

    return (
        <div className="bottom-controls">
            {/* Meta Bar */}
            <div className="meta-bar">
                <div className="meta-row">
                    <span className="meta-label">เวลา</span>
                    <span className="meta-value">เวลาปัจจุบัน</span>
                </div>

                <div className="meta-row">
                    <span className="meta-label">ตำแหน่ง</span>
                    <span className="meta-value">{locationSummary}</span>
                    <span className="meta-pill">{photos.length} รูป</span>
                </div>
            </div>

            {/* Gallery Strip */}
            <PhotoGallery />

            {/* Action Buttons */}
            <div className="action-buttons">
                <div className="action-btn-left">
                    <button className={`capture-side-btn torch-side-btn ${torchOn?'torch-active':''}`} onClick={()=>void handleTorch()}
                        disabled={!canUseTorch} title="แฟลช" aria-label={torchOn?'ปิดแฟลช':'เปิดแฟลช'} aria-pressed={torchOn}>
                        {torchOn?<Flashlight className="ui-icon" aria-hidden="true"/>:<FlashlightOff className="ui-icon" aria-hidden="true"/>}
                        <span>{torchOn?'แฟลชเปิด':'แฟลชปิด'}</span>
                    </button>
                </div>

                <button
                    className={`shutter-btn ${isCapturing ? 'is-capturing' : ''}`}
                    onClick={handleCapture}
                    disabled={!canCapture}
                    title="ถ่ายรูป" aria-label="ถ่ายรูป"
                />

                <div className="action-btn-right">
                    <button
                        className="capture-side-btn"
                        onClick={switchCamera}
                        disabled={!canSwitchCamera}
                        title="สลับกล้อง"
                    >
                        <RefreshCw className="ui-icon" aria-hidden="true" />
                        <span>สลับกล้อง</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
