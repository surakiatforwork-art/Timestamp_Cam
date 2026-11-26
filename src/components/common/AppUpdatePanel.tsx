import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';

type Release = {installed:string;available:boolean;version?:string;size?:number;notes?:string};
const updater=registerPlugin<{
    check():Promise<Release>;
    download():Promise<void>;
    install():Promise<{permissionRequired:boolean}>;
    addListener(event:'progress',fn:(p:{received:number;total:number})=>void):Promise<PluginListenerHandle>;
}>('AppUpdate');
export default function AppUpdatePanel({onBusy}:{onBusy:(busy:boolean)=>void}){
    const [release,setRelease]=useState<Release|null>(null);
    const [phase,setPhase]=useState<'idle'|'check'|'download'|'ready'|'install'>('idle');
    const [progress,setProgress]=useState(0);
    const [message,setMessage]=useState('');
    const lock=useRef(false);
    const native=Capacitor.getPlatform()==='android';
    async function run(action:'check'|'download'|'install'){
        if(lock.current||!native)return;
        lock.current=true;onBusy(true);setPhase(action);setMessage('');
        let listener:PluginListenerHandle|undefined;
        try{
            if(action==='check'){
                setRelease(null);
                const result=await updater.check();setRelease(result);setPhase('idle');
                if(!result.available)setMessage('คุณใช้เวอร์ชันล่าสุดหรือใหม่กว่าแล้ว');
            }else if(action==='download'){
                setProgress(0);
                listener=await updater.addListener('progress',p=>setProgress(Math.min(100,Math.round(p.received/p.total*100))));
                await updater.download();setProgress(100);setPhase('ready');setMessage('ตรวจสอบไฟล์สำเร็จ พร้อมติดตั้ง');
            }else{
                const result=await updater.install();setPhase('ready');
                setMessage(result.permissionRequired?'อนุญาตให้แอปติดตั้งจากแหล่งนี้ แล้วกลับมากดติดตั้งอีกครั้ง':'ยืนยันการอัปเดตในหน้าติดตั้งของ Android');
            }
        }catch(e){
            setPhase(action==='install'?'ready':'idle');
            setMessage('ไม่สำเร็จ: '+(e instanceof Error?e.message:String(e)));
        }finally{try{await listener?.remove();}finally{lock.current=false;onBusy(false);}}
    }
    const busy=phase==='check'||phase==='download'||phase==='install';
    return <section className="settings-section app-update-panel">
        <h3><RefreshCw className="ui-icon" aria-hidden="true"/> อัปเดตแอป</h3>
        <div className="settings-row"><label>เวอร์ชันที่ติดตั้ง</label><strong>{release?.installed??'1.5.7'}</strong></div>
        <p className="settings-note">ตรวจสอบจาก GitHub Releases เมื่อคุณต้องการเท่านั้น ไม่บังคับอัปเดต</p>
        {!native?<p className="settings-note">รองรับการติดตั้งอัปเดตบน Android</p>:<>
            <button className="btn btn-secondary update-check" disabled={busy} onClick={()=>void run('check')}><RefreshCw className={`ui-icon ${phase==='check'?'spinning':''}`}/> {phase==='check'?'กำลังตรวจสอบ…':'ตรวจสอบเวอร์ชันล่าสุด'}</button>
            {release?.available&&<div className="update-offer">
                <strong>เวอร์ชัน {release.version}</strong><small>{((release.size??0)/1024/1024).toFixed(1)} MB</small>
                {release.notes&&<p className="update-notes">{release.notes}</p>}
                {phase==='download'&&<><progress value={progress} max={100}/><small>{progress}%</small></>}
                <button className="btn btn-primary" disabled={busy} onClick={()=>void run(phase==='ready'?'install':'download')}>
                    {phase==='ready'?<><ShieldCheck className="ui-icon"/> ติดตั้งอัปเดต</>:<><Download className="ui-icon"/> {phase==='download'?'กำลังดาวน์โหลด…':'ดาวน์โหลดอัปเดต'}</>}
                </button>
            </div>}
        </>}
        {message&&<p className="settings-note" role="status">{message}</p>}
    </section>;
}
