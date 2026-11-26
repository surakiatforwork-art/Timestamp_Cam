import { useEffect, useRef, useLayoutEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../../context/AppContext';
import { useCamera } from '../../hooks/useCamera';
import { calculateCoverCrop } from '../../lib/canvas';
import LiveOverlay from './LiveOverlay';

export default function Stage() {
    const { state } = useApp();
    const { videoRef, cameraStatus, facingMode, cameraOn } = useCamera(true);
    const viewfinderRef = useRef<HTMLDivElement>(null);
    const flashRef = useRef<HTMLDivElement>(null);
    const flashAnimation = useRef<Animation | null>(null);
    const flyAnimation = useRef<Animation | null>(null);
    const flyNode = useRef<HTMLImageElement | null>(null);
    const flyFade = useRef<Animation | null>(null);
    const cardArrival = useRef<Animation | null>(null);
    const flyFrame = useRef(0);
    const focusTimer = useRef<ReturnType<typeof setTimeout>>();
    const focusGeneration = useRef(0);
    const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
    const [focusSupported, setFocusSupported] = useState(false);
    const focusBusy = useRef(false);
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);
    const points = useRef(new Map<number, { x: number; y: number }>());
    const gesture = useRef<{ distance: number; zoom: number; pinched: boolean; x: number; y: number; time: number } | null>(null);
    const { settings } = state;
    const showVideo = cameraOn && cameraStatus === 'ready';
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const setCameraZoom = (value: number) => {
        const next = Math.max(1, Math.min(3, value));
        zoomRef.current = next;
        if (videoRef.current) {
            videoRef.current.dataset.captureZoom = String(next);
            videoRef.current.style.setProperty('--camera-zoom', String(next));
        }
        setZoom(Math.round(next * 10) / 10);
    };
    const cycleZoom=()=>{
        const current=zoomRef.current;
        setCameraZoom(current<1.95?2:current<2.95?3:1);
    };
    useLayoutEffect(() => {
        points.current.clear(); gesture.current = null;
        setCameraZoom(1); setFocus(null); focusGeneration.current++; focusBusy.current = false;
        clearTimeout(focusTimer.current);
        const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[]; pointsOfInterest?: unknown }) | undefined;
        const constraints = navigator.mediaDevices?.getSupportedConstraints?.() as (MediaTrackSupportedConstraints & { pointsOfInterest?: boolean }) | undefined;
        setFocusSupported(!!showVideo && !!track && !!(caps?.pointsOfInterest || constraints?.pointsOfInterest) && !!caps?.focusMode?.includes('single-shot'));
    }, [facingMode, cameraStatus, cameraOn]);

    useEffect(() => {
        const stopFly = () => {
            cancelAnimationFrame(flyFrame.current);
            flyAnimation.current?.cancel(); flyFade.current?.cancel(); cardArrival.current?.cancel();
            flyAnimation.current = null; flyFade.current = null; cardArrival.current = null;
            flyNode.current?.remove(); flyNode.current = null;
        };
        const flash = () => {
            flashAnimation.current?.cancel();
            if (!flashRef.current || reduced()) return;
            flashAnimation.current = flashRef.current.animate([{opacity:.48},{opacity:0}], {duration:125, easing:'ease-out'});
        };
        const saved = (event: Event) => {
            stopFly();
            if (reduced()) return;
            const { id, rect } = (event as CustomEvent<{id:string; rect:DOMRect}>).detail;
            // Wait for lazy thumbnail decode and gallery scroll without holding the shutter.
            const started=performance.now();
            const fly=()=>{
                const card=Array.from(document.querySelectorAll<HTMLElement>('.gallery-strip [data-card-id]')).find(el=>el.dataset.cardId===id);
                const img=card?.querySelector('img'), rail=card?.closest('.gallery-strip');
                const dest=card?.getBoundingClientRect(), bounds=rail?.getBoundingClientRect();
                if(!card||!img||!dest||!bounds||!rect.width||!rect.height||!img.complete||!img.naturalWidth||dest.left<bounds.left-1||dest.right>bounds.right+1||!dest.width){
                    if(performance.now()-started<600)flyFrame.current=requestAnimationFrame(fly);
                    return;
                }
                const ghost=new Image();ghost.src=img.src;ghost.className='capture-flight';ghost.alt='';ghost.setAttribute('aria-hidden','true');
                // Use the final thumbnail's aspect ratio throughout: no visible squash or resize phase.
                const w=Math.min(142,rect.width*.48),h=w*dest.height/dest.width;
                const x=rect.left+(rect.width-w)/2,y=rect.top+(rect.height-h)/2;
                Object.assign(ghost.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
                document.body.appendChild(ghost);flyNode.current=ghost;
                const dx=dest.left+dest.width/2-x-w/2,dy=dest.top+dest.height/2-y-h/2;
                const scale=dest.width/w, duration=620;
                // A single continuous motion curve controls position and uniform scale together.
                // No pause at the center, no intermediate trajectory or easing reset.
                const motion=ghost.animate([
                    {transform:'translate3d(0,0,0) scale(1)'},
                    {transform:`translate3d(${dx}px,${dy}px,0) scale(${scale})`}
                ],{duration,easing:'cubic-bezier(.32,.12,.24,1)',fill:'forwards'});
                flyAnimation.current=motion;
                // Only the very end blends into the stationary thumbnail; movement never stops early.
                flyFade.current=ghost.animate([{opacity:1,offset:0},{opacity:1,offset:.8},{opacity:0,offset:1}],{duration,easing:'linear',fill:'forwards'});
                cardArrival.current=card.animate([{opacity:.15,offset:0},{opacity:.15,offset:.8},{opacity:1,offset:1}],{duration,easing:'linear'});
                const finish=()=>{ghost.remove();if(flyNode.current===ghost)flyNode.current=null;};
                void motion.finished.then(finish).catch(finish);
            };
            flyFrame.current=requestAnimationFrame(fly);
        };
        window.addEventListener('timestamp-capture-start',flash);
        window.addEventListener('timestamp-capture-saved',saved);
        return () => { window.removeEventListener('timestamp-capture-start',flash); window.removeEventListener('timestamp-capture-saved',saved); flashAnimation.current?.cancel(); stopFly(); clearTimeout(focusTimer.current); focusGeneration.current++; };
    }, []);
    async function focusAt(x: number, y: number) {
        const video = videoRef.current, frame = viewfinderRef.current;
        const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
        if (!focusSupported || focusBusy.current || !track || !video || !frame || !video.videoWidth || !video.videoHeight) return;
        const rect = (video.parentElement??frame).getBoundingClientRect(), crop = calculateCoverCrop(video.videoWidth,video.videoHeight,rect.width,rect.height);
        if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return;
        const frameRect=frame.getBoundingClientRect();
        const u = Math.max(0,Math.min(1,(x-rect.left)/rect.width)), v = Math.max(0,Math.min(1,(y-rect.top)/rect.height));
        const rawX = ((facingMode === 'user' ? 1-u : u)-.5)*crop.sw/zoomRef.current + video.videoWidth/2;
        const rawY = (v-.5)*crop.sh/zoomRef.current + video.videoHeight/2;
        const generation = ++focusGeneration.current;
        focusBusy.current = true;
        clearTimeout(focusTimer.current);
        setFocus({x:rect.left-frameRect.left+Math.max(25,Math.min(rect.width-25,u*rect.width)),y:rect.top-frameRect.top+Math.max(25,Math.min(rect.height-25,v*rect.height))});
        try {
            await track.applyConstraints({ advanced: [{ focusMode:'single-shot', pointsOfInterest:[{ x:rawX/video.videoWidth,y:rawY/video.videoHeight }] } as MediaTrackConstraintSet] });
        } catch {
            if (generation === focusGeneration.current) { setFocusSupported(false); setFocus(null); }
        } finally {
            if (generation === focusGeneration.current) { focusBusy.current = false; focusTimer.current = setTimeout(() => setFocus(null),850); }
        }
    }
    const distance = () => {
        const [a,b] = [...points.current.values()];
        return a && b ? Math.hypot(a.x-b.x,a.y-b.y) : 0;
    };
    const pointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!showVideo || e.button !== 0 || points.current.size >= 2 || (e.target as HTMLElement).closest('button')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        points.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if (points.current.size === 1) gesture.current = {distance:0,zoom:zoomRef.current,pinched:false,x:e.clientX,y:e.clientY,time:performance.now()};
        if (points.current.size === 2 && gesture.current) {
            gesture.current = {...gesture.current,distance:Math.max(1,distance()),zoom:zoomRef.current,pinched:true};
            setFocus(null);
        }
    };
    const pointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!points.current.has(e.pointerId)) return;
        points.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
        const g = gesture.current;
        if (points.current.size === 2 && g?.pinched) setCameraZoom(g.zoom*distance()/g.distance);
    };
    const pointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!points.current.has(e.pointerId)) return;
        const g = gesture.current;
        points.current.delete(e.pointerId);
        if (!points.current.size) {
            gesture.current = null;
            if (e.type === 'pointerup' && g && !g.pinched && performance.now()-g.time < 400 && Math.hypot(e.clientX-g.x,e.clientY-g.y)<10)
                void focusAt(e.clientX,e.clientY);
        }
    };

    // Listen for import event from Topbar
    useEffect(() => {
        const handleImport = async (e: Event) => {
            const files = (e as CustomEvent).detail as FileList;
            const importEvent = new CustomEvent('do-import', { detail: files });
            window.dispatchEvent(importEvent);
        };

        window.addEventListener('import-files', handleImport);
        return () => window.removeEventListener('import-files', handleImport);
    }, []);

    const getHintText = () => {
        if (!cameraOn) return 'กล้องปิดอยู่ — ยังนำเข้ารูปได้';
        switch (cameraStatus) {
            case 'starting':
                return 'กำลังเปิดกล้อง...';
            case 'denied':
                return 'กรุณาอนุญาตการใช้กล้อง';
            case 'error':
                return 'ไม่สามารถเปิดกล้องได้';
            default:
                return null;
        }
    };

    const hintText = getHintText();
    return (
        <main className="stage">
            <div className="viewfinder-container">
                <div
                    ref={viewfinderRef}
                    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
                    className={`viewfinder ${facingMode === 'user' ? 'front-camera' : ''}`}
                >
                    <div className="camera-source">
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className={showVideo ? 'camera-live' : 'camera-hidden'}
                    />
                    </div>
                    {showVideo && <LiveOverlay videoRef={videoRef} frameRef={viewfinderRef} settings={settings} active={state.activeModal==='none' && !state.importProgress && !state.downloadProgress}/>}

                    {hintText && (
                        <div className="viewfinder-hint">
                            {hintText}
                        </div>
                    )}

                    <div ref={flashRef} className="camera-flash" aria-hidden="true" />
                    {showVideo && focus && <span className="camera-focus-ring" aria-label="กำลังโฟกัส" style={{left:focus.x,top:focus.y}} />}
                    {showVideo && <button className="camera-zoom-indicator" type="button" aria-label={`ซูม ${zoom.toFixed(1)} เท่า · แตะเพื่อเปลี่ยนระดับ`} title="เปลี่ยนระดับซูม" onClick={cycleZoom}>{zoom.toFixed(1)}×</button>}

                </div>
            </div>
        </main>
    );
}
