import { memo, useLayoutEffect, useRef, type RefObject } from 'react';
import { calculateCaptureCrop, drawOverlayLayer, ensureOverlayFontReady, getLiveOutputGeometry, getPhotoOverlay, overlayFontSize } from '../../lib/canvas';
import type { Settings } from '../../types';
import { resolveActiveLocation,subscribeLiveLocation } from '../../lib/liveLocation';

type Props={videoRef:RefObject<HTMLVideoElement>;frameRef:RefObject<HTMLDivElement>;settings:Settings;active:boolean};

// The camera owns its video surface. This component only paints transparent text.
// No animation loop, video copies, React clock state, or GPS polling.
export default memo(function LiveOverlay({videoRef,frameRef,settings,active}:Props) {
    const outputRef=useRef<HTMLDivElement>(null);
    const timeRef=useRef<HTMLCanvasElement>(null);
    const locationRef=useRef<HTMLCanvasElement>(null);
    useLayoutEffect(()=>{
        const video=videoRef.current,frame=frameRef.current,output=outputRef.current;
        const source=video?.parentElement,time=timeRef.current,location=locationRef.current;
        if(!video||!frame||!output||!source||!time||!location)return;
        const timeCtx=time.getContext('2d'),locationCtx=location.getContext('2d');
        if(!timeCtx||!locationCtx)return;
        let stopped=false, fontsReady=false, raf=0, timer:ReturnType<typeof setTimeout>|undefined;
        let dimensionsKey='',lastTimeKey='',lastLocationKey='';
        const visible=()=>active&&!document.hidden;
        const layout=(element:HTMLElement,rect:{x:number;y:number;w:number;h:number})=>{
            element.style.left=rect.x+'px';element.style.top=rect.y+'px';
            element.style.width=rect.w+'px';element.style.height=rect.h+'px';
        };
        const clearTimer=()=>{clearTimeout(timer);timer=undefined;};
        const draw=()=>{
            raf=0;clearTimer();
            if(stopped)return;
            const rect=frame.getBoundingClientRect(),fw=rect.width,fh=rect.height;
            if(!fw||!fh)return;
            const geometry=getLiveOutputGeometry(fw,fh,settings);
            layout(output,geometry.output);layout(source,geometry.source);
            if(!visible()||!fontsReady||!video.videoWidth||!video.videoHeight)return;
            const crop=calculateCaptureCrop(video.videoWidth,video.videoHeight,fw,fh,Number(video.dataset.captureZoom??1));
            const ow=settings.outputMode==='original'?crop.outW:settings.presetSize.w;
            const oh=settings.outputMode==='original'?crop.outH:settings.presetSize.h;
            // Cap density and surface dimensions on low-end devices.
            const density=Math.min(window.devicePixelRatio||1,2,900/Math.max(geometry.output.w,geometry.output.h));
            const scale=Math.min(geometry.output.w*density/ow,geometry.output.h*density/oh);
            const cw=Math.max(1,Math.round(ow*scale)),ch=Math.max(1,Math.round(oh*scale));
            const key=[ow,oh,cw,ch,scale].join(':');
            if(dimensionsKey!==key){
                dimensionsKey=key;lastTimeKey='';lastLocationKey='';
                for(const canvas of [time,location]){
                    if(canvas.width!==cw)canvas.width=cw;
                    if(canvas.height!==ch)canvas.height=ch;
                }
                output.dataset.outputWidth=String(ow);output.dataset.outputHeight=String(oh);
            }
            const timestamp=new Date().toISOString();
            const fix=resolveActiveLocation(settings);
            const groups=getPhotoOverlay({timeValueISO:timestamp,remark:settings.defaultRemark,locationLatitude:fix.lat,locationLongitude:fix.lng,locationAddress:fix.address,locationDetails:fix.details},settings);
            const tk=JSON.stringify(groups.timeLines),lk=JSON.stringify(groups.locationLines);
            if(tk!==lastTimeKey){
                timeCtx.clearRect(0,0,cw,ch);
                drawOverlayLayer(timeCtx,cw,ch,ow,oh,scale,settings,groups.timeLines,'time');
                lastTimeKey=tk;
            }
            if(lk!==lastLocationKey){
                locationCtx.clearRect(0,0,cw,ch);
                drawOverlayLayer(locationCtx,cw,ch,ow,oh,scale,settings,groups.locationLines,'location');
                lastLocationKey=lk;
            }
            // Align updates to wall-clock seconds rather than accumulating interval drift.
            timer=setTimeout(draw,1000-Date.now()%1000+8);
        };
        const schedule=()=>{
            if(stopped)return;
            if(!raf)raf=requestAnimationFrame(draw);
        };
        const visibility=()=>{
            clearTimer();
            if(!document.hidden)schedule();
            else if(raf){cancelAnimationFrame(raf);raf=0;}
        };
        const unsubscribe=subscribeLiveLocation(schedule);
        const resize=new ResizeObserver(schedule);resize.observe(frame);
        video.addEventListener('loadedmetadata',schedule);
        video.addEventListener('resize',schedule);
        video.addEventListener('timestamp-zoom-change',schedule);
        document.addEventListener('visibilitychange',visibility);
        window.addEventListener('native-app-resume',schedule);
        // Geometry must update immediately; text waits for the same bundled font as export.
        draw();
        void ensureOverlayFontReady(overlayFontSize(settings.presetSize.w,settings.presetSize.h,settings,1),
            settings.overlayFontFamily,settings.overlayFontWeight).then(()=>{
            if(!stopped){fontsReady=true;schedule();}
        });
        return ()=>{
            stopped=true;unsubscribe();clearTimer();cancelAnimationFrame(raf);resize.disconnect();
            video.removeEventListener('loadedmetadata',schedule);video.removeEventListener('resize',schedule);
            video.removeEventListener('timestamp-zoom-change',schedule);
            document.removeEventListener('visibilitychange',visibility);
            window.removeEventListener('native-app-resume',schedule);
            source.style.left='';source.style.top='';source.style.width='';source.style.height='';
        };
    },[videoRef,frameRef,settings,active]);
    return <div ref={outputRef} className={`live-overlay-output ${settings.outputMode==='preset'?'preset-'+settings.fitMode:''}`} aria-hidden="true">
        <canvas ref={timeRef} className="live-overlay-time" width={1} height={1}/>
        <canvas ref={locationRef} className="live-overlay-location" width={1} height={1}/>
    </div>;
});
