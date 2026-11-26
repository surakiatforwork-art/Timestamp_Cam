import { useBackHandler } from '../../lib/backNavigation';
import { confirmAction } from '../common/ConfirmDialog';
import { ChevronLeft, ChevronRight, Download, LoaderCircle, LocateFixed, Map, MapPin, Search, Timer, Trash2, X } from 'lucide-react';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { renderPhotoToCanvas } from '../../lib/canvas';
import { downloadOne } from '../../lib/download';
import { finishDownload } from '../../lib/downloadCleanup';
import { log } from '../../lib/logger';
import { getCurrentPosition, resolveLocationQuery, reverseGeocodeDetails } from '../../lib/geocoding';
import type { DownloadFormat, Photo, Settings as AppSettings } from '../../types';
import DateTimeWheelPicker from '../common/DateTimeWheelPicker';

// Keep only the current photo and its two neighbours rendered at preview resolution.
function PreviewSlide({ photo, settings, relative, zoom, pan }: {
    photo: Photo; settings: AppSettings; relative: number; zoom: number; pan: { x: number; y: number };
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setFailed(false);
        void renderPhotoToCanvas(photo, settings, 1200).then(result => {
            if (cancelled || !canvas.current) { result.width = 0; result.height = 0; return; }
            const el = canvas.current;
            el.width = result.width; el.height = result.height;
            el.getContext('2d')?.drawImage(result, 0, 0);
            // The temporary rendering surface is no longer needed.
            result.width = 0; result.height = 0;
            setReady(true);
        }).catch(error => {
            if (!cancelled) { setFailed(true); console.error('Preview render failed:', error); }
        });
        return () => { cancelled = true; };
    }, [photo, settings]);
    return <div className="preview-slide" data-relative={relative} aria-hidden={relative !== 0}
        style={{ left: `${relative * 100}%` }}>
        <canvas ref={canvas} className={relative === 0 ? 'active-preview-canvas' : ''}
            style={{ visibility: ready ? 'visible' : 'hidden', transform: relative === 0 ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` : undefined }} />
        {!ready && !failed && <span className="loading-spinner" aria-hidden="true" />}
        {failed && <span className="preview-load-error">เปิดภาพไม่สำเร็จ</span>}
    </div>;
}

export default function PreviewModal() {
    const { state, dispatch, closeModal, updatePhoto, trashPhotos, showToast } = useApp();
    const trackRef = useRef<HTMLDivElement>(null);
    const offsetRef = useRef(0);
    const motionRef = useRef<Animation | null>(null);
    const navigationPending = useRef(false);
    const [transitioning, setTransitioning] = useState(false);
    // Keep the old frame only for the short removal transition, never an original blob.
    const removal = useRef<{target:string; direction:number; outgoing:HTMLCanvasElement|null}|null>(null);
    const removalAnimations = useRef<Animation[]>([]);
    const removalTimer = useRef<ReturnType<typeof setTimeout>>();
    const removalOverlay = useRef<HTMLCanvasElement|null>(null);
    const [removalTransition,setRemovalTransition] = useState(false);
    function clearRemovalVisuals() {
        clearTimeout(removalTimer.current);
        removalAnimations.current.forEach(a=>a.cancel());
        removalAnimations.current=[];
        const overlay=removalOverlay.current;
        if(overlay){overlay.remove();overlay.width=0;overlay.height=0;removalOverlay.current=null;}
    }
    function releaseSnapshot(frame:HTMLCanvasElement|null) {
        if(frame){frame.remove();frame.width=0;frame.height=0;}
    }
    const setOffset = (x: number) => {
        offsetRef.current = x;
        if (trackRef.current) trackRef.current.style.transform = `translate3d(${x}px,0,0)`;
    };
    const viewportRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    const zoomMotion = useRef<Animation | null>(null);
    const dismissMotion = useRef<Animation | null>(null);
    const backdropMotion = useRef<Animation | null>(null);
    const grip = useRef<{id:number;y:number;time:number;lastY:number;lastTime:number;speed:number}|null>(null);
    const dismissY = useRef(0);
    const closing = useRef(false);
    const [closingView, setClosingView] = useState(false);
    const lastTap = useRef<{x:number;y:number;time:number}|null>(null);
    const tapStart = useRef<{x:number;y:number;time:number}|null>(null);
    const panVelocity = useRef({x:0,y:0,lastX:0,lastY:0,time:0});
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transformRef = useRef({ zoom: 1, x: 0, y: 0 });

    const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>('jpeg');
    const [jpegQuality, setJpegQuality] = useState(0.92);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isDeleting,setIsDeleting]=useState(false);
    const actionLock=useRef(false);
    const [isLoadingGPS, setIsLoadingGPS] = useState(false);
    const [locationQuery, setLocationQuery] = useState('');
    const [isSearchingLocation, setIsSearchingLocation] = useState(false);
    const [remarkDraft, setRemarkDraft] = useState('');
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const pointersRef = useRef(new globalThis.Map<number, { x: number; y: number }>());
    const swipeRef = useRef<{ id: number; x: number; y: number; axis: "x" | "y" | null; lastX: number; lastTime: number; speed: number } | null>(null);
    const gestureRef = useRef({ startX: 0, startY: 0, startPanX: 0, startPanY: 0, startDistance: 0, startZoom: 1, centerX: 0, centerY: 0 });

    const photo = state.photos.find((p) => p.id === state.previewPhotoId);
    const activeIds = new Set(state.photos.map(item => item.id));
    const sequence = (state.previewSequence ?? state.photos.map(item => item.id)).filter(id => activeIds.has(id));
    const position = sequence.indexOf(state.previewPhotoId ?? '');
    const busy = isDownloading || isDeleting || isLoadingGPS || isSearchingLocation || removalTransition;

    useEffect(() => {
        setRemarkDraft(photo?.remark ?? '');
    }, [photo?.id, photo?.remark]);

    useLayoutEffect(() => {
        // Rebase the keyed slides only after React has committed the new active photo.
        motionRef.current?.cancel(); motionRef.current = null;
        navigationPending.current = false;
        setOffset(0); setTransitioning(false);
        zoomMotion.current?.cancel(); zoomMotion.current = null; lastTap.current = null; tapStart.current = null;
        pointersRef.current.clear(); swipeRef.current = null;
        transformRef.current = { zoom: 1, x: 0, y: 0 };
        setZoom(1); setPan({ x: 0, y: 0 }); setLocationQuery('');
        const pending=removal.current;
        if(!pending || pending.target!==photo?.id)return;
        removal.current=null;
        clearRemovalVisuals();
        navigationPending.current=true;
        setTransitioning(true);setRemovalTransition(true);
        const viewport=viewportRef.current;
        const incoming=viewport?.querySelector<HTMLElement>('.preview-slide[data-relative="0"]');
        const finish=()=>{
            clearRemovalVisuals();
            navigationPending.current=false;
            setTransitioning(false);setRemovalTransition(false);
        };
        // Keep a short tap guard even when system animations are disabled.
        if(reducedMotion()||!viewport||!incoming||typeof incoming.animate!=='function'){
            releaseSnapshot(pending.outgoing);
            removalTimer.current=setTimeout(finish,250);
            return;
        }
        const distance=Math.min(96,viewport.clientWidth*.24)*pending.direction;
        const duration=380;
        const easing='cubic-bezier(.2,.7,.25,1)';
        if(pending.outgoing){
            const old=pending.outgoing;
            viewport.appendChild(old);removalOverlay.current=old;
            removalAnimations.current.push(old.animate([
                {transform:'translate3d(0,0,0)',opacity:1},
                {transform:`translate3d(${-distance}px,0,0)`,opacity:0}
            ],{duration,easing,fill:'forwards'}));
        }
        removalAnimations.current.push(incoming.animate([
            {transform:`translate3d(${distance}px,0,0)`,opacity:.25},
            {transform:'translate3d(0,0,0)',opacity:1}
        ],{duration,easing,fill:'both'}));
        // The safety lock survives React's normal slide rebase and a dropped animation frame.
        removalTimer.current=setTimeout(finish,duration+80);
    }, [photo?.id]);
    useEffect(() => () => {
        motionRef.current?.cancel(); motionRef.current = null; navigationPending.current = false;
        zoomMotion.current?.cancel(); dismissMotion.current?.cancel(); backdropMotion.current?.cancel();
        clearRemovalVisuals();
        if(removal.current)releaseSnapshot(removal.current.outgoing);
        removal.current=null;
    }, []);
    useBackHandler(60,()=>{
        if (!photo) {closeModal();return true;}
        if(busy || actionLock.current || navigationPending.current || closing.current)return true;
        if(transformRef.current.zoom>1.001){animateTransform(1,0,0);return true;}
        void requestClose();
        return true;
    });
    if (!photo) return null;

    const hasUnsavedRemark = () => state.settings.showRemark && remarkDraft.trim() !== (photo.remark ?? '').trim();
    function setDismiss(y: number) {
        dismissY.current = Math.max(0,y);
        if (modalRef.current) modalRef.current.style.transform = `translate3d(0,${dismissY.current}px,0)`;
        if (backdropRef.current) backdropRef.current.style.backgroundColor = `rgba(0,0,0,${Math.max(0,.56*(1-dismissY.current/Math.max(1,modalRef.current?.offsetHeight??600)))})`;
    }
    function restoreDismiss() {
        dismissMotion.current?.cancel(); backdropMotion.current?.cancel();
        const modal = modalRef.current, y = dismissY.current;
        const shade = backdropRef.current;
        const color = shade ? getComputedStyle(shade).backgroundColor : '';
        setDismiss(0);
        if (!modal || !y || reducedMotion()) return;
        dismissMotion.current = modal.animate([{transform:`translate3d(0,${y}px,0)`},{transform:'translate3d(0,0,0)'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});
        if(shade)backdropMotion.current=shade.animate([{backgroundColor:color},{backgroundColor:'rgba(0,0,0,.56)'}],{duration:180,easing:'ease-out'});
    }
    function gripStart(e:React.PointerEvent<HTMLDivElement>) {
        if(e.button!==0 || busy || actionLock.current || navigationPending.current || closing.current || pointersRef.current.size || grip.current)return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dismissMotion.current?.cancel();backdropMotion.current?.cancel();
        setDismiss(0);
        const now=performance.now();
        grip.current={id:e.pointerId,y:e.clientY,time:now,lastY:e.clientY,lastTime:now,speed:0};
    }
    function gripMove(e:React.PointerEvent<HTMLDivElement>) {
        const g=grip.current;if(!g || g.id!==e.pointerId)return;
        const now=performance.now();
        g.speed=(e.clientY-g.lastY)/Math.max(1,now-g.lastTime);g.lastY=e.clientY;g.lastTime=now;
        setDismiss(Math.max(0,e.clientY-g.y));
    }
    function gripEnd(e:React.PointerEvent<HTMLDivElement>) {
        const g=grip.current;if(!g || g.id!==e.pointerId)return;
        grip.current=null;
        const dy=e.clientY-g.y;
        if(e.type==='pointerup' && (dy>90 || (dy>28 && g.speed>.55 && performance.now()-g.lastTime<100)))void requestClose();
        else restoreDismiss();
    }
    function revealCard(): HTMLElement | undefined {
        const rail = document.querySelector<HTMLElement>('.gallery-strip');
        if (!rail) return;
        const card = Array.from(rail.querySelectorAll<HTMLElement>('[data-card-id]')).find(el => el.dataset.cardId === photo!.id)
            ?? Array.from(rail.querySelectorAll<HTMLElement>('[data-card-id]')).find(el => {
                try {
                    const groups = JSON.parse(localStorage.getItem('timestamp-photo-groups') ?? '[]') as {id:string;members:string[]}[];
                    return groups.some(g => g.id === el.dataset.cardId && g.members?.includes(photo!.id));
                } catch { return false; }
            });
        if (!card) return;
        const a = card.getBoundingClientRect(), b = rail.getBoundingClientRect();
        if (a.left < b.left || a.right > b.right) rail.scrollLeft += a.left + a.width/2 - b.left - b.width/2;
        return card;
    }
    async function requestClose(_swipe = false) {
        if (closing.current || busy || actionLock.current || navigationPending.current) { restoreDismiss(); return; }
        if (hasUnsavedRemark()) {
            restoreDismiss(); actionLock.current=true;
            const accepted=await confirmAction({title:'Remark ยังไม่ได้บันทึก',message:'ต้องการปิดรูปโดยไม่บันทึกข้อความที่แก้ไขหรือไม่?',action:'ปิดโดยไม่บันทึก',kind:'warning'});
            actionLock.current=false;
            if(!accepted)return;
        }
        closing.current = true;
        revealCard();
        if (reducedMotion() || !modalRef.current) { closeModal(); return; }
        setClosingView(true);
        zoomMotion.current?.cancel();
        const modal = modalRef.current;
        const start=getComputedStyle(modal).transform;
        const shade=backdropRef.current;
        const color=shade?getComputedStyle(shade).backgroundColor:'rgba(0,0,0,.56)';
        dismissMotion.current?.cancel();backdropMotion.current?.cancel();
        const motion=modal.animate([{transform:start==='none'?'translate3d(0,0,0)':start},{transform:`translate3d(0,${modal.offsetHeight+24}px,0)`}],{duration:230,easing:'cubic-bezier(.4,0,.85,.6)',fill:'forwards'});
        if(shade)backdropMotion.current=shade.animate([{backgroundColor:color},{backgroundColor:'rgba(0,0,0,0)'}],{duration:230,easing:'ease-out',fill:'forwards'});
        dismissMotion.current=motion;
        void motion.finished.then(()=>closeModal()).catch(()=>{});
    }

    const handleTimeNow = async () => {
        const now = new Date().toISOString();
        await updatePhoto(photo.id, { timeMode: 'now', timeValueISO: now });
        showToast('ตั้งเวลาปัจจุบันแล้ว', 'success');
    };

    const handleTimeCustom = async (iso: string) => {
        await updatePhoto(photo.id, { timeMode: 'custom', timeValueISO: iso });
    };

    const handleSaveRemark = async () => {
        const remark = remarkDraft.trim();
        if (remark === (photo.remark ?? '')) return;
        await updatePhoto(photo.id, { remark });
        showToast(remark ? 'บันทึก Remark แล้ว' : 'ล้าง Remark แล้ว', 'success');
    };

    const handleLocationNow = async () => {
        if (isLoadingGPS) return;

        setIsLoadingGPS(true);
        try {
            const pos = await getCurrentPosition();
            const shouldResolveDetails = state.settings.showAddress || state.settings.showSubdistrict || state.settings.showDistrict || state.settings.showProvince;
            const resolved = shouldResolveDetails ? await reverseGeocodeDetails(pos.lat, pos.lng) : null;

            await updatePhoto(photo.id, {
                locationLatitude: pos.lat,
                locationLongitude: pos.lng,
                locationAddress: resolved?.displayName ?? null,
                locationDetails: resolved?.details ?? null,
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
                locationDetails: result.details,
            });
            setLocationQuery('');
            showToast('ตั้งตำแหน่งจากการค้นหาแล้ว', 'success');
        } catch (e) {
            showToast('ค้นหาตำแหน่งไม่สำเร็จ', 'error');
        } finally {
            setIsSearchingLocation(false);
        }
    };

    // Snapshot the visible preview, including its current zoom/pan. This is a small
    // transient canvas; no extra decode of the original and no stored duplicate.
    function snapshotPreview():HTMLCanvasElement|null {
        if(reducedMotion())return null;
        const viewport=viewportRef.current, canvas=viewport?.querySelector<HTMLCanvasElement>('.active-preview-canvas');
        if(!viewport||!canvas||!canvas.width||!canvas.height||getComputedStyle(canvas).visibility!=='visible')return null;
        const frame=viewport.getBoundingClientRect(), rect=canvas.getBoundingClientRect();
        if(!frame.width||!frame.height||!rect.width||!rect.height)return null;
        const old=document.createElement('canvas');
        old.width=Math.max(1,Math.round(frame.width));old.height=Math.max(1,Math.round(frame.height));
        const ctx=old.getContext('2d');
        if(!ctx)return null;
        ctx.fillStyle='#000';ctx.fillRect(0,0,old.width,old.height);
        ctx.drawImage(canvas,rect.left-frame.left,rect.top-frame.top,rect.width,rect.height);
        old.className='preview-removal-outgoing';old.setAttribute('aria-hidden','true');
        return old;
    }
    // Prefer the previous photo in the current visual sequence, then the next.
    // If a group is exhausted, continue in the remaining library.
    function afterRemoval(outgoing:HTMLCanvasElement|null) {
        const previous=sequence[position-1], next=sequence[position+1];
        const all=state.photos.map(p=>p.id), index=all.indexOf(photo!.id);
        const target=previous??next??all[index-1]??all[index+1];
        if(!target){releaseSnapshot(outgoing);closeModal();return;}
        const direction=previous||(!next&&all[index-1])?-1:1;
        removal.current={target,direction,outgoing};
        navigationPending.current=true;setTransitioning(true);setRemovalTransition(true);
        if(!previous&&!next)dispatch({type:'SET_PREVIEW_SEQUENCE',payload:all.filter(id=>id!==photo!.id)});
        dispatch({type:'SET_PREVIEW_PHOTO_ID',payload:target});
    }
    const handleDownload = async () => {
        if (busy || actionLock.current || navigationPending.current || closing.current) return;
        actionLock.current=true; setIsDownloading(true);
        let outgoing:HTMLCanvasElement|null=null;
        try {
            if (state.settings.autoTrashAfterDownload && hasUnsavedRemark() &&
                !await confirmAction({title:'Remark ยังไม่ได้บันทึก',message:'ดาวน์โหลดด้วยข้อมูลที่บันทึกไว้และย้ายภาพไปถังขยะหรือไม่?',action:'ดาวน์โหลด',kind:'warning'})) return;
            const index = state.photos.findIndex(p=>p.id===photo.id);
            const saved = await downloadOne(photo,state.settings,downloadFormat,jpegQuality,index);
            if(saved.confirmed&&state.settings.autoTrashAfterDownload)outgoing=snapshotPreview();
            const moved = await finishDownload({success:true,confirmedIds:saved.confirmed?[photo.id]:[]},1,state.settings.autoTrashAfterDownload,trashPhotos,showToast);
            if (moved) {afterRemoval(outgoing);outgoing=null;}
        } catch(e) {
            log(`Download failed: ${e}`,'error'); showToast('ดาวน์โหลดไม่สำเร็จ','error');
        } finally {releaseSnapshot(outgoing);actionLock.current=false;setIsDownloading(false);}
    };
    const handleDelete = async () => {
        if (busy || actionLock.current || navigationPending.current || closing.current) return;
        // Lock before showing the dialog; confirmation is bound to this photo ID.
        const id=photo.id;
        actionLock.current=true; setIsDeleting(true);
        let outgoing:HTMLCanvasElement|null=null;
        try {
            const accepted=await confirmAction({
                title:`ย้ายรูปที่ ${position+1} ไปถังขยะ?`,
                message:'คุณกำลังลบภาพด้วยตนเอง ภาพนี้จะถูกนำออกจากคลัง แต่สามารถกู้คืนได้จากถังขยะ'+(hasUnsavedRemark()?' ข้อความ Remark ที่ยังไม่บันทึกจะไม่ถูกเก็บไว้':''),
                action:'ย้ายไปถังขยะ',kind:'trash',danger:true
            });
            if(!accepted)return;
            outgoing=snapshotPreview();
            if (await trashPhotos([id])) {
                afterRemoval(outgoing);outgoing=null;
                showToast('ย้ายรูปไปยังถังขยะแล้ว','info');
            }
        } catch {showToast('ย้ายรูปไปยังถังขยะไม่สำเร็จ','error');}
        finally {releaseSnapshot(outgoing);actionLock.current=false;setIsDeleting(false);}
    };

    const locationLat = photo.locationLatitude ?? state.settings.latitude;
    const locationLng = photo.locationLongitude ?? state.settings.longitude;
    const locationAddress = photo.locationLatitude != null && photo.locationLongitude != null ? photo.locationAddress ?? null : state.settings.cachedAddress;
    const locationSource = photo.locationLatitude !== undefined ? 'ตำแหน่งเฉพาะรูป' : 'ใช้ค่าจาก Settings';

    const outputW = state.settings.outputMode === 'original' ? photo.width : state.settings.presetSize.w;
    const outputH = state.settings.outputMode === 'original' ? photo.height : state.settings.presetSize.h;
    let lineCount = 2;
    if (state.settings.locationEnabled) {
        if (state.settings.showLatLng && locationLat !== null) lineCount++;
        if (state.settings.showAddress && locationAddress) lineCount++;
    }
    if (state.settings.showRemark && photo.remark?.trim()) lineCount++;
    const previewInfo = `Preview: ${outputW}×${outputH} • Overlay ${lineCount} บรรทัด`;
    const nearby = [-1, 0, 1].flatMap(relative => {
        const item = state.photos.find(candidate => candidate.id === sequence[position + relative]);
        return item ? [{ item, relative }] : [];
    });

    function cancelMotion() {
        if (motionRef.current) { motionRef.current.cancel(); motionRef.current = null; }
    }
    function animateOffset(target: number, duration: number, complete: () => void) {
        cancelMotion();
        const track = trackRef.current;
        if (!track || window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof track.animate !== 'function') {
            setOffset(target); complete(); return;
        }
        const motion = track.animate([
            { transform: `translate3d(${offsetRef.current}px,0,0)` },
            { transform: `translate3d(${target}px,0,0)` }
        ], { duration, easing: 'cubic-bezier(0.22, 0.8, 0.25, 1)', fill: 'forwards' });
        motionRef.current = motion;
        void motion.finished.then(() => {
            if (motionRef.current !== motion) return;
            setOffset(target); motion.cancel(); motionRef.current = null; complete();
        }).catch(() => {});
    }
    const snapBack = () => {
        if (offsetRef.current === 0) return;
        animateOffset(0, 160, () => {});
    };
    const navigatePhoto = async (delta: number, speed = 0) => {
        const id = sequence[position + delta], width = viewportRef.current?.clientWidth ?? 0;
        if (!id || busy || actionLock.current || closing.current || position < 0 || navigationPending.current || !width) { if (!navigationPending.current) snapBack(); return; }
        if (hasUnsavedRemark()) {
            snapBack(); actionLock.current=true;
            const accepted=await confirmAction({title:'Remark ยังไม่ได้บันทึก',message:'ต้องการเปลี่ยนรูปโดยไม่บันทึกข้อความที่แก้ไขหรือไม่?',action:'เปลี่ยนรูป',kind:'warning'});
            actionLock.current=false;
            if(!accepted)return;
        }
        navigationPending.current = true; setTransitioning(true);
        // A quick flick settles sooner; buttons share the same directional transition.
        const distance = Math.abs(-delta * width - offsetRef.current);
        const duration = Math.max(140, Math.min(270, distance / Math.max(.9, Math.abs(speed)) ));
        animateOffset(-delta * width, duration, () => dispatch({ type: 'SET_PREVIEW_PHOTO_ID', payload: id }));
    };

    const boundedTransform = (nextZoom: number, x: number, y: number) => {
        const viewport = viewportRef.current, canvas = viewport?.querySelector<HTMLCanvasElement>('.active-preview-canvas');
        if (!canvas || !viewport) return {zoom:1,x:0,y:0};
        const z = Math.max(1,Math.min(4,nextZoom));
        const maxX = Math.max(0, (canvas.offsetWidth * z - viewport.clientWidth) / 2);
        const maxY = Math.max(0, (canvas.offsetHeight * z - viewport.clientHeight) / 2);
        return { zoom:z, x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
    };
    const transformCSS = (t:{zoom:number;x:number;y:number}) => `translate3d(${t.x}px,${t.y}px,0) scale(${t.zoom})`;
    const applyTransform = (nextZoom: number, x: number, y: number) => {
        const bounded = boundedTransform(nextZoom,x,y);
        transformRef.current = bounded;
        const canvas = viewportRef.current?.querySelector<HTMLCanvasElement>('.active-preview-canvas');
        if (canvas) canvas.style.transform = transformCSS(bounded);
        setZoom(bounded.zoom); setPan({x:bounded.x,y:bounded.y});
    };
    function animateTransform(z:number,x:number,y:number,duration=210) {
        zoomMotion.current?.cancel(); zoomMotion.current = null;
        const canvas = viewportRef.current?.querySelector<HTMLCanvasElement>('.active-preview-canvas');
        const start = {...transformRef.current}, end = boundedTransform(z,x,y);
        applyTransform(end.zoom,end.x,end.y);
        if (!canvas || reducedMotion()) return;
        const motion = canvas.animate([{transform:transformCSS(start)},{transform:transformCSS(end)}],{duration,easing:'cubic-bezier(.18,.75,.25,1)'});
        zoomMotion.current = motion;
        void motion.finished.then(()=>{if(zoomMotion.current===motion)zoomMotion.current=null;}).catch(()=>{});
    }
    function interruptZoom() {
        const canvas = viewportRef.current?.querySelector<HTMLCanvasElement>('.active-preview-canvas');
        if (!canvas || !zoomMotion.current) return;
        const matrix = new DOMMatrixReadOnly(getComputedStyle(canvas).transform);
        zoomMotion.current.cancel(); zoomMotion.current = null;
        applyTransform(matrix.a,matrix.m41,matrix.m42);
    }
    function doubleTap(x:number,y:number) {
        if (busy || navigationPending.current || closing.current) return;
        const viewport = viewportRef.current;
        if (!viewport) return;
        const t = transformRef.current;
        if (t.zoom > 1.01) { animateTransform(1,0,0); return; }
        const b = viewport.getBoundingClientRect(), z = 2.5;
        const dx=x-b.left-b.width/2,dy=y-b.top-b.height/2;
        animateTransform(z,dx-(dx-t.x)*z/t.zoom,dy-(dy-t.y)*z/t.zoom);
    }
    const resetGesture = () => {
        const points = [...pointersRef.current.values()];
        const t = transformRef.current;
        const g = gestureRef.current;
        g.startPanX = t.x; g.startPanY = t.y; g.startZoom = t.zoom;
        if (points.length === 1) { g.startX = points[0].x; g.startY = points[0].y; }
        if (points.length >= 2) {
            g.startDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            g.centerX = (points[0].x + points[1].x) / 2;
            g.centerY = (points[0].y + points[1].y) / 2;
        }
    };
    const updateGesture = () => {
        const points = [...pointersRef.current.values()], g = gestureRef.current;
        if (points.length === 1 && transformRef.current.zoom > 1) {
            applyTransform(g.startZoom, g.startPanX + points[0].x - g.startX, g.startPanY + points[0].y - g.startY);
        } else if (points.length >= 2) {
            const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const z = Math.min(4, Math.max(1, g.startZoom * distance / Math.max(1, g.startDistance)));
            const bounds = viewportRef.current?.getBoundingClientRect();
            if (!bounds) return;
            const cx = bounds.left + bounds.width / 2, cy = bounds.top + bounds.height / 2;
            const ratio = z / g.startZoom;
            applyTransform(z, (points[0].x + points[1].x) / 2 - cx - (g.centerX - cx - g.startPanX) * ratio,
                (points[0].y + points[1].y) / 2 - cy - (g.centerY - cy - g.startPanY) * ratio);
        }
    };
    const startGesture = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || grip.current || busy || actionLock.current || closing.current || navigationPending.current || pointersRef.current.size >= 2) return;
        interruptZoom();
        dismissMotion.current?.cancel(); backdropMotion.current?.cancel(); setDismiss(0);
        if (pointersRef.current.size === 0) {
            tapStart.current = {x:event.clientX,y:event.clientY,time:performance.now()};
            panVelocity.current = {x:0,y:0,lastX:event.clientX,lastY:event.clientY,time:performance.now()};
        } else { tapStart.current = null; lastTap.current = null; }
        // A new touch may interrupt a returning short swipe without a jump.
        if (motionRef.current && trackRef.current) {
            const matrix = new DOMMatrixReadOnly(getComputedStyle(trackRef.current).transform);
            cancelMotion(); setOffset(matrix.m41);
        }
        if (pointersRef.current.size === 0 && transformRef.current.zoom <= 1.001) {
            swipeRef.current = { id: event.pointerId, x: event.clientX - offsetRef.current, y: event.clientY, axis: null, lastX: event.clientX, lastTime: performance.now(), speed: 0 };
        } else {
            swipeRef.current = null; cancelMotion(); setOffset(0);
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        resetGesture();
    };
    const moveGesture = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!pointersRef.current.has(event.pointerId) || navigationPending.current) return;
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const swipe = swipeRef.current;
        if (swipe?.id === event.pointerId && pointersRef.current.size === 1) {
            const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
            if (!swipe.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 8)
                swipe.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'x' : 'y';
            if (swipe.axis === 'y') { setDismiss(Math.max(0,dy)*.85); if (Math.abs(dy)>10) lastTap.current=null; }
            if (swipe.axis === 'x') {
                const now = performance.now(), dt = Math.max(1, now - swipe.lastTime);
                swipe.speed = swipe.speed * .25 + (event.clientX - swipe.lastX) / dt * .75;
                swipe.lastTime = now; swipe.lastX = event.clientX;
                const width = viewportRef.current?.clientWidth ?? 1;
                const atEdge = dx > 0 ? position <= 0 : position >= sequence.length - 1;
                setOffset(atEdge ? Math.sign(dx) * Math.min(38, Math.abs(dx) * .18) : Math.max(-width, Math.min(width, dx)));
            }
            return;
        }
        if (pointersRef.current.size === 1 && transformRef.current.zoom > 1.001) {
            const v=panVelocity.current, now=performance.now(), dt=Math.max(1,now-v.time);
            v.x=v.x*.3+(event.clientX-v.lastX)/dt*.7; v.y=v.y*.3+(event.clientY-v.lastY)/dt*.7;
            v.lastX=event.clientX; v.lastY=event.clientY; v.time=now;
        }
        updateGesture();
    };
    const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!pointersRef.current.has(event.pointerId)) return;
        const swipe = swipeRef.current;
        if (swipe?.id === event.pointerId) {
            swipeRef.current = null;
            const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
            const speed = performance.now() - swipe.lastTime < 100 ? swipe.speed : 0;
            const width = viewportRef.current?.clientWidth ?? 320;
            const threshold = Math.min(82, width * .22);
            const flick = Math.abs(dx) >= 28 && Math.abs(speed) > .55 && Math.sign(speed) === Math.sign(dx);
            if (event.type === 'pointerup' && swipe.axis === 'x' && pointersRef.current.size === 1
                && transformRef.current.zoom <= 1.001 && Math.abs(dx) > Math.abs(dy) * 1.25 && (Math.abs(dx) >= threshold || flick))
                navigatePhoto(dx < 0 ? 1 : -1, speed);
            else if (event.type === 'pointerup' && swipe.axis === 'y' && dy >= Math.min(95,(viewportRef.current?.clientHeight ?? 300)*.32) && dy > Math.abs(dx)*1.35) requestClose(true);
            else { snapBack(); restoreDismiss(); }
        }
        const only = pointersRef.current.size === 1;
        const tap = tapStart.current;
        if (only && event.type === 'pointerup' && tap && performance.now()-tap.time < 280 && Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<10 && !closing.current && !navigationPending.current) {
            const previous=lastTap.current, now=performance.now();
            if(previous && now-previous.time<320 && Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<32) {
                lastTap.current=null; doubleTap(event.clientX,event.clientY);
            } else lastTap.current={x:event.clientX,y:event.clientY,time:now};
        } else if (only) {
            lastTap.current=null;
            const v=panVelocity.current,t=transformRef.current;
            if(event.type==='pointerup' && !swipe && t.zoom>1.001 && performance.now()-v.time<100 && Math.hypot(v.x,v.y)>.15) {
                animateTransform(t.zoom,t.x+Math.max(-180,Math.min(180,v.x*110)),t.y+Math.max(-180,Math.min(180,v.y*110)),240);
            }
        }
        pointersRef.current.delete(event.pointerId);
        if (!pointersRef.current.size) tapStart.current=null;
        else if (pointersRef.current.size === 1) {
            const point = [...pointersRef.current.values()][0];
            panVelocity.current={x:0,y:0,lastX:point.x,lastY:point.y,time:performance.now()};
        }
        resetGesture();
    };

    return (
        <div ref={backdropRef} className={`modal-backdrop preview-modal ${closingView ? "preview-closing" : ""}`} onClick={() => requestClose()}>
            <div ref={modalRef} className="modal-content preview-sheet" role="dialog" aria-modal="true" aria-labelledby="preview-sheet-title" onClick={(e) => e.stopPropagation()}>
                <div className="preview-sheet-grip" aria-hidden="true" onPointerDown={gripStart} onPointerMove={gripMove} onPointerUp={gripEnd} onPointerCancel={gripEnd} onLostPointerCapture={gripEnd}><span/></div>
                <div className="modal-header">
                    <h2 id="preview-sheet-title">รูปที่ {position + 1} / {sequence.length}</h2>
                    <button className="icon-btn" aria-label="ปิดตัวอย่างภาพ" disabled={busy || transitioning} onClick={() => requestClose()}><X className="ui-icon" aria-hidden="true" /></button>
                </div>

                <div className="preview-canvas-container" data-removal-transition={removalTransition ? "active" : undefined} ref={viewportRef}
                    onPointerDown={startGesture}
                    onPointerMove={moveGesture}
                    onPointerUp={endGesture} onPointerCancel={endGesture} onLostPointerCapture={endGesture}
                    >
                    <div className="preview-track" ref={trackRef}>
                        {nearby.map(({ item, relative }) => <PreviewSlide key={item.id} photo={item} settings={state.settings} relative={relative} zoom={zoom} pan={pan} />)}
                    </div>
                </div>

                <div className="preview-navigation">
                    <button type="button" className="preview-step" aria-label="รูปก่อนหน้า" disabled={position <= 0 || busy || transitioning} onClick={() => navigatePhoto(-1)}><ChevronLeft className="ui-icon" aria-hidden="true" /></button>
                    <div className="preview-info">{previewInfo}{sequence.length > 1 && <small>{position + 1} / {sequence.length} · {zoom > 1 ? 'แตะสองครั้งเพื่อคืนขนาด' : 'ปัดซ้าย–ขวา · แตะสองครั้งเพื่อซูม'}</small>}</div>
                    <button type="button" className="preview-step" aria-label="รูปถัดไป" disabled={position < 0 || position >= sequence.length - 1 || busy || transitioning} onClick={() => navigatePhoto(1)}><ChevronRight className="ui-icon" aria-hidden="true" /></button>
                </div>

                <div className="preview-controls" style={{ pointerEvents: transitioning || busy ? 'none' : undefined }}>
                    {/* Time settings for this photo */}
                    <div className="preview-section">
                        <h4>เวลาสำหรับรูปนี้</h4>
                        <div className="preview-time-buttons">
                            <button
                                className={`btn btn-sm ${photo.timeMode === 'now' ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={handleTimeNow}
                            >
                                <Timer className="ui-icon" aria-hidden="true" /> ใช้เวลาปัจจุบัน
                            </button>
                            <DateTimeWheelPicker
                                key={photo.id}
                                value={photo.timeValueISO}
                                onChange={handleTimeCustom}
                            />
                        </div>
                    </div>

                    {state.settings.showRemark && (
                        <div className="preview-section remark-editor">
                            <h4>Remark สำหรับรูปนี้</h4>
                            <textarea
                                value={remarkDraft}
                                onChange={(event) => setRemarkDraft(event.target.value)}
                                placeholder="เพิ่ม Remark สำหรับรูปนี้"
                                rows={3}
                            />
                            <div className="preview-time-buttons">
                                <button className="btn btn-sm btn-secondary" onClick={handleSaveRemark}>
                                    บันทึก Remark
                                </button>
                            </div>
                        </div>
                    )}

                    {state.settings.locationEnabled && (
                        <div className="preview-section">
                            <h4>ตำแหน่งสำหรับรูปนี้</h4>
                            <div className="preview-time-buttons">
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={handleLocationNow}
                                    disabled={isLoadingGPS}
                                >
                                    {isLoadingGPS ? <><LoaderCircle className="ui-icon spinning" aria-hidden="true" /> กำลังหา GPS...</> : <><LocateFixed className="ui-icon" aria-hidden="true" /> ใช้ตำแหน่งปัจจุบัน</>}
                                </button>
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={handleOpenLocationMap}
                                >
                                    <Map className="ui-icon" aria-hidden="true" /> เลือกตำแหน่ง
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
                                    {isSearchingLocation ? <LoaderCircle className="ui-icon spinning" aria-hidden="true" /> : <Search className="ui-icon" aria-hidden="true" />} ค้นหา
                                </button>
                            </div>
                            <p className="settings-note">
                                {locationLat !== null && locationLng !== null
                                    ? `${locationSource}: ${locationLat.toFixed(6)}, ${locationLng.toFixed(6)}`
                                    : 'ยังไม่ได้ระบุตำแหน่ง'}
                            </p>
                            {locationAddress && (
                                <p className="settings-note" style={{ color: 'var(--accent)' }}>
                                    <MapPin className="ui-icon" aria-hidden="true" /> {locationAddress}
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

                <div className="preview-actions" style={{ pointerEvents: transitioning || busy ? 'none' : undefined }}>
                    <button
                        className="btn btn-primary"
                        onClick={handleDownload}
                        disabled={busy || transitioning}
                    >
                        {isDownloading ? <><span className="loading-spinner" /> กำลังดาวน์โหลด...</> : <><Download className="ui-icon" aria-hidden="true" /> ดาวน์โหลด</>}
                    </button>
                    <button className="btn btn-danger" disabled={busy || transitioning} onClick={handleDelete}>
                        <Trash2 className="ui-icon" aria-hidden="true" /> ลบรูปนี้
                    </button>
                </div>
            </div>
        </div>
    );
}
