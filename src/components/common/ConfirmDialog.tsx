import { useSyncExternalStore, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert, Trash2, Info } from 'lucide-react';
import { useBackHandler } from '../../lib/backNavigation';

type Options = { title: string; message: string; action?: string; danger?: boolean; kind?: 'trash' | 'warning' };
type Pending = Options & { resolve: (accepted:boolean)=>void };
let current: Pending | null = null;
const listeners = new Set<()=>void>();
const notify = () => listeners.forEach(listener=>listener());
const subscribe = (listener:()=>void) => {listeners.add(listener);return ()=>{listeners.delete(listener);};};
const snapshot = () => current;

export function confirmAction(options:Options):Promise<boolean> {
    if (current) return Promise.resolve(false);
    return new Promise(resolve=>{current={...options,resolve};notify();});
}
export function isConfirmOpen():boolean { return current!==null; }
function finish(accepted:boolean) {
    const pending=current;
    if(!pending) return;
    current=null;
    notify();
    pending.resolve(accepted);
}

export default function ConfirmDialog() {
    const pending=useSyncExternalStore(subscribe,snapshot,snapshot);
    const cancelRef=useRef<HTMLButtonElement>(null);
    const actionRef=useRef<HTMLButtonElement>(null);
    useBackHandler(100,()=>{if(!current)return false;finish(false);return true;});
    useLayoutEffect(()=>{
        if(!pending)return;
        const previous=document.activeElement as HTMLElement|null;
        cancelRef.current?.focus({preventScroll:true});
        return ()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
    },[pending]);
    if(!pending)return null;
    const Icon=pending.kind==='trash'?Trash2:pending.danger||pending.kind==='warning'?TriangleAlert:Info;
    return createPortal(
        <div className="confirm-backdrop" onClick={()=>finish(false)}>
            <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message"
                onClick={e=>e.stopPropagation()} onKeyDown={e=>{
                    if(e.key==='Tab'){e.preventDefault();(document.activeElement===cancelRef.current?actionRef:cancelRef).current?.focus();}
                }}>
                <div className={`confirm-symbol ${pending.danger?'danger':''}`}><Icon aria-hidden="true"/></div>
                <h2 id="confirm-title">{pending.title}</h2>
                <p id="confirm-message">{pending.message}</p>
                <div className="confirm-actions">
                    <button ref={cancelRef} className="btn btn-secondary" onClick={()=>finish(false)}>ยกเลิก</button>
                    <button ref={actionRef} className={`btn ${pending.danger?'btn-danger':'btn-primary'}`} onClick={()=>finish(true)}>{pending.action??'ยืนยัน'}</button>
                </div>
            </div>
        </div>,document.body
    );
}
