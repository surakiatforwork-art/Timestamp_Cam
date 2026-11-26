import { useEffect, useRef, useState } from 'react';
import { useBackHandler } from '../../lib/backNavigation';
import { CameraIcon, CameraOff, Download, ImagePlus, LoaderCircle, MoreVertical, Settings, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useCamera } from '../../hooks/useCamera';
import { Camera } from '@capacitor/camera';
import { downloadAll } from '../../lib/download';
import { finishDownload } from '../../lib/downloadCleanup';
import { log } from '../../lib/logger';

export default function Topbar() {
    const { state, dispatch, showToast, trashPhotos } = useApp();
    const { cameraOn, toggleCameraOn } = useCamera();
    const [menuOpen,setMenuOpen]=useState(false);
    const [picking,setPicking]=useState(false);
    const pickerLock=useRef(false);
    const moreRef=useRef<HTMLButtonElement>(null);
    const menuRef=useRef<HTMLDivElement>(null);
    const closeMenu=(restoreFocus=false)=>{
        setMenuOpen(false);
        if(restoreFocus)moreRef.current?.focus({preventScroll:true});
    };
    useBackHandler(50,()=>{
        if(!menuOpen)return false;
        closeMenu(true);return true;
    });
    useEffect(()=>{
        if(menuOpen && (state.activeModal!=='none' || state.importProgress || state.downloadProgress))setMenuOpen(false);
    },[menuOpen,state.activeModal,state.importProgress,state.downloadProgress]);
    useEffect(()=>{
        if(menuOpen)menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    },[menuOpen]);
    const handleImport = async () => {
        if(pickerLock.current||state.importProgress||state.downloadProgress||state.activeModal!=='none')return;
        pickerLock.current=true;setPicking(true);setMenuOpen(false);
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
            if (!/cancel/i.test(String((e as Error)?.message??e))) {
                log(`Pick images failed: ${e}`, 'error');
                showToast('เลือกรูปภาพไม่สำเร็จ', 'error');
            }
        } finally {pickerLock.current=false;setPicking(false);}
    };
    useEffect(() => {
        const open = () => { if (!state.importProgress) void handleImport(); };
        window.addEventListener('timestamp-open-import', open);
        return () => window.removeEventListener('timestamp-open-import', open);
    });
    // Removed handleFileChange as we don't use input[type=file] anymore

    const handleDownloadAll = async () => {
        if (state.photos.length === 0 || state.downloadProgress || state.importProgress || pickerLock.current) return;

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

    const openPage=(page:'settings'|'trash')=>{
        closeMenu();dispatch({type:'SET_ACTIVE_MODAL',payload:page});
    };
    const busy=!!state.downloadProgress||!!state.importProgress||picking;
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

            </div>

            <div className="topbar-center" aria-hidden="true" />

            <div className="topbar-right">
                {/* Download All */}
                <button
                    className="icon-btn"
                    onClick={handleDownloadAll}
                    disabled={state.photos.length === 0 || busy}
                    title="ดาวน์โหลดทั้งหมด"
                >
                    {state.downloadProgress ? <LoaderCircle className="ui-icon spinning" aria-hidden="true" /> : <Download className="ui-icon" aria-hidden="true" />}
                </button>

                <button className="icon-btn" onClick={()=>void handleImport()} disabled={busy} title="นำเข้ารูป" aria-label="นำเข้ารูป">
                    {picking||state.importProgress?<LoaderCircle className="ui-icon spinning" aria-hidden="true"/>:<ImagePlus className="ui-icon" aria-hidden="true"/>}
                </button>
                <span className="toolbar-divider" aria-hidden="true" />
                {menuOpen&&<div className="topbar-menu-scrim" aria-hidden="true" onClick={()=>closeMenu(true)}/>}
                <div className="topbar-menu-anchor">
                    <button ref={moreRef} className={`icon-btn ${menuOpen?'topbar-menu-active':''}`} title="เมนูเพิ่มเติม" aria-label="เมนูเพิ่มเติม"
                        aria-expanded={menuOpen} aria-controls={menuOpen?'topbar-more-panel':undefined} disabled={busy} onClick={()=>menuOpen?closeMenu(true):setMenuOpen(true)}>
                        <MoreVertical className="ui-icon" aria-hidden="true"/>
                    </button>
                    {menuOpen&&<div ref={menuRef} id="topbar-more-panel" className="topbar-more-panel" role="group" aria-label="เมนูเพิ่มเติม"
                        onKeyDown={event=>{
                            if(event.key==='ArrowDown'||event.key==='ArrowUp'){
                                event.preventDefault();const buttons=Array.from(event.currentTarget.querySelectorAll('button'));
                                const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
                                buttons[(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
                            }
                        }}>
                        <button title="ตั้งค่า" onClick={()=>openPage('settings')}><Settings className="ui-icon" aria-hidden="true"/> ตั้งค่า</button>
                        <button title="ถังขยะ" onClick={()=>openPage('trash')}><Trash2 className="ui-icon" aria-hidden="true"/> ถังขยะ</button>
                    </div>}
                </div>
            </div>
        </header>
    );
}
