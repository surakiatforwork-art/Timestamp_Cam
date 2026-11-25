import { useBackHandler } from '../../lib/backNavigation';
import { Check, Clock, LocateFixed, MapPin, Search, PencilLine, X, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../context/AppContext';
import type { Photo, PhotoRecord } from '../../types';
import { getCurrentPosition, resolveLocationQuery, reverseGeocodeDetails, type LocationSearchResult } from '../../lib/geocoding';
import DateTimeWheelPicker from '../common/DateTimeWheelPicker';

type TimeChoice = 'keep' | 'now' | 'custom' | 'copy';
type LocationChoice = 'keep' | 'settings' | 'copy' | 'new';
type RemarkChoice = 'keep' | 'replace' | 'copy';

export default function BatchEditModal({ photos, onClose }: { photos: Photo[]; onClose: () => void }) {
    const { state, updatePhotos, showToast } = useApp();
    const [sourceId, setSourceId] = useState(photos[0]?.id ?? '');
    const source = photos.find(p => p.id === sourceId) ?? photos[0];
    const [time, setTime] = useState<TimeChoice>('keep');
    const [customTime, setCustomTime] = useState(photos[0]?.timeValueISO ?? new Date().toISOString());
    const [location, setLocation] = useState<LocationChoice>('keep');
    const [remarkMode, setRemarkMode] = useState<RemarkChoice>('keep');
    const [remark, setRemark] = useState('');
    const [query, setQuery] = useState('');
    const [resolved, setResolved] = useState<LocationSearchResult | null>(null);
    const [locating, setLocating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [error, setError] = useState('');
    const busy = useRef(false);
    const settings = state.settings;
    const locationOf = (photo?: Photo): LocationSearchResult | null => {
        const own = photo?.locationLatitude != null && photo?.locationLongitude != null;
        const lat = own ? photo!.locationLatitude! : settings.latitude;
        const lng = own ? photo!.locationLongitude! : settings.longitude;
        if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {lat,lng, displayName:own ? photo!.locationAddress ?? null : settings.cachedAddress, details:own ? photo!.locationDetails ?? null : settings.locationDetails};
    };
    const destination = location === 'settings' ? locationOf() : location === 'copy' ? locationOf(source) : resolved;
    const fieldCount = Number(time !== 'keep') + Number(location !== 'keep') + Number(remarkMode !== 'keep');
    const canSave = !!photos.length && fieldCount > 0 && (location === 'keep' || !!destination) && !locating && !saving;
    async function findLocation(gps: boolean) {
        if (busy.current || locating || saving) return;
        busy.current = true; setLocating(true); setError(''); setResolved(null);
        try {
            if (gps) {
                const pos = await getCurrentPosition();
                const result = await reverseGeocodeDetails(pos.lat,pos.lng);
                setResolved({...pos, displayName:result?.displayName ?? null, details:result?.details ?? null});
            } else {
                const result = await resolveLocationQuery(query, locationOf(source));
                if (!result) throw new Error('not found');
                setResolved(result);
            }
        } catch { setError(gps ? 'หาตำแหน่ง GPS ไม่สำเร็จ' : 'ไม่พบตำแหน่ง กรุณาตรวจสอบคำค้น'); }
        finally { busy.current = false; setLocating(false); }
    }
    async function save() {
        if (!canSave || busy.current) return;
        const updates: Partial<PhotoRecord> = {};
        if (time !== 'keep') {
            updates.timeMode = time === 'copy' ? source.timeMode : time === 'now' ? 'now' : 'custom';
            updates.timeValueISO = time === 'copy' ? source.timeValueISO : time === 'now' ? new Date().toISOString() : customTime;
        }
        if (location !== 'keep' && destination) {
            updates.locationLatitude = destination.lat; updates.locationLongitude = destination.lng;
            updates.locationAddress = destination.displayName; updates.locationDetails = destination.details;
        }
        if (remarkMode !== 'keep') updates.remark = remarkMode === 'copy' ? source.remark ?? '' : remark.trim();
        busy.current = true; setSaving(true); setError('');
        try {
            await updatePhotos(photos.map(p=>p.id), updates);
            showToast(`แก้ไขข้อมูล ${photos.length} รูปแล้ว`, 'success');
            onClose();
        } catch { setError('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง ข้อมูลเดิมยังคงอยู่'); setConfirm(false); }
        finally { busy.current = false; setSaving(false); }
    }
    const close = () => { if (!busy.current) onClose(); };
    useBackHandler(60,()=>{if(!busy.current){if(confirm)setConfirm(false);else close();}return true;});
    return createPortal(
        <div className="modal-backdrop batch-edit-modal" onClick={close}>
            <div className="modal-content" role="dialog" aria-modal="true" aria-label="แก้ไขหลายภาพ" onClick={e=>e.stopPropagation()}>
                <div className="modal-header"><h2><PencilLine className="ui-icon" aria-hidden="true" /> แก้ไข {photos.length} รูป</h2>
                    <button className="icon-btn" aria-label="ปิดแก้ไขหลายภาพ" disabled={saving || locating} onClick={close}><X className="ui-icon" aria-hidden="true"/></button>
                </div>
                <div className="batch-edit-scroll">
                    <div className="batch-summary">
                        <div className="batch-thumbs" aria-hidden="true">{photos.slice(0,5).map(p=><img key={p.id} src={p.thumbUrl} alt=""/>)}{photos.length>5 && <span>+{photos.length-5}</span>}</div>
                        <p>แก้เฉพาะข้อมูลที่เลือก รูปต้นฉบับและค่าของภาพอื่นจะไม่เปลี่ยน</p>
                    </div>
                    <label className="batch-source">ภาพต้นแบบสำหรับคัดลอก
                        <select aria-label="ภาพต้นแบบ" value={sourceId} disabled={saving || locating || confirm} onChange={e=>setSourceId(e.target.value)}>
                            {photos.map((p,i)=><option key={p.id} value={p.id}>รูปที่ {i+1} · {new Date(p.timeValueISO).toLocaleString('th-TH')}</option>)}
                        </select>
                    </label>
                    <fieldset disabled={saving || locating || confirm} className="batch-fields">
                        <section className="batch-section">
                            <label className="batch-label" htmlFor="batch-time"><Clock className="ui-icon"/> เวลา</label>
                            <select id="batch-time" value={time} onChange={e=>setTime(e.target.value as TimeChoice)}>
                                <option value="keep">คงเวลาเดิม</option><option value="now">ใช้เวลาปัจจุบันพร้อมกัน</option><option value="custom">กำหนดวันและเวลา</option><option value="copy">คัดลอกจากภาพต้นแบบ</option>
                            </select>
                            {time==='custom' && <DateTimeWheelPicker value={customTime} onChange={setCustomTime}/>}
                            {time==='copy' && source && <small>{new Date(source.timeValueISO).toLocaleString('th-TH')}</small>}
                        </section>
                        <section className="batch-section">
                            <label className="batch-label" htmlFor="batch-location"><MapPin className="ui-icon"/> ตำแหน่ง</label>
                            <select id="batch-location" value={location} onChange={e=>{setLocation(e.target.value as LocationChoice);setError('');}}>
                                <option value="keep">คงตำแหน่งเดิม</option><option value="settings">ใช้ตำแหน่งจาก Settings</option><option value="copy">คัดลอกจากภาพต้นแบบ</option><option value="new">เลือก GPS / ค้นหาตำแหน่ง</option>
                            </select>
                            {location==='new' && <div className="batch-location-tools">
                                <button className="btn btn-secondary btn-sm" onClick={()=>void findLocation(true)}><LocateFixed className="ui-icon"/> ใช้ GPS ปัจจุบัน</button>
                                <div className="batch-search"><input aria-label="ค้นหาตำแหน่ง" value={query} onChange={e=>{setQuery(e.target.value);setResolved(null);}} placeholder="ชื่อสถานที่ / ละติจูด, ลองจิจูด"/>
                                <button className="btn btn-secondary btn-sm" disabled={!query.trim()} onClick={()=>void findLocation(false)} aria-label="ค้นหา"><Search className="ui-icon"/></button></div>
                            </div>}
                            {location!=='keep' && <small className="batch-location-result">{locating?'กำลังค้นหาตำแหน่ง…':destination ? `${destination.lat.toFixed(6)}, ${destination.lng.toFixed(6)}${destination.displayName?' · '+destination.displayName:''}` : 'ยังไม่มีตำแหน่งที่ใช้ได้'}</small>}
                        </section>
                        <section className="batch-section">
                            <label className="batch-label" htmlFor="batch-remark"><PencilLine className="ui-icon"/> Remark</label>
                            <select id="batch-remark" value={remarkMode} onChange={e=>setRemarkMode(e.target.value as RemarkChoice)}>
                                <option value="keep">คง Remark เดิม</option><option value="replace">กำหนดข้อความใหม่ / ล้างข้อความ</option><option value="copy">คัดลอกจากภาพต้นแบบ</option>
                            </select>
                            {remarkMode==='replace' && <textarea aria-label="Remark ใหม่" rows={3} value={remark} onChange={e=>setRemark(e.target.value)} placeholder="เว้นว่างเพื่อล้าง Remark ของภาพที่เลือก"/>}
                            {remarkMode==='copy' && <small>{source?.remark || 'ไม่มี Remark (ล้างข้อความ)'}</small>}
                            {!settings.showRemark && remarkMode!=='keep' && <small>Remark จะถูกบันทึก แต่ไม่แสดงบนภาพจนกว่าจะเปิดในการตั้งค่า</small>}
                        </section>
                    </fieldset>
                    {error && <p role="alert" className="batch-error">{error}</p>}
                    {confirm && <div className="batch-confirm" role="status"><strong>ยืนยันแก้ไข {photos.length} รูป?</strong><p>ข้อมูลที่จะเปลี่ยน: {[time!=='keep'?'เวลา':'',location!=='keep'?'ตำแหน่ง':'',remarkMode!=='keep'?'Remark':''].filter(Boolean).join(' · ')}</p></div>}
                </div>
                <div className="modal-footer batch-footer">
                    <button className="btn btn-secondary" disabled={saving || locating} onClick={()=>confirm?setConfirm(false):close()}>{confirm?'ย้อนกลับ':'ยกเลิก'}</button>
                    <button className="btn btn-primary" disabled={!canSave} onClick={()=>confirm?void save():setConfirm(true)}>{saving?<><LoaderCircle className="ui-icon spinning"/> กำลังบันทึก</>:<><Check className="ui-icon"/> {confirm?'ยืนยันบันทึก':'ตรวจสอบการแก้ไข'}</>}</button>
                </div>
            </div>
        </div>,document.body
    );
}
