import AppUpdatePanel from '../common/AppUpdatePanel';
import { useBackHandler } from '../../lib/backNavigation';
import { confirmAction } from '../common/ConfirmDialog';
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, ChevronRight, CircleDot, Check, ClipboardList, Clock, Download, FileText, Frame, LoaderCircle, LocateFixed, Map, MapPin, NotebookPen, RefreshCw, Ruler, Search, Settings, Tag, Trash2, TriangleAlert, X } from 'lucide-react';
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { PRESET_SIZES, resetSettings } from '../../lib/settings';
import { requestLocationPermission, reverseGeocodeDetails, forwardGeocode } from '../../lib/geocoding';
import { getLogs, clearLogs, copyLogs, subscribeToLogs } from '../../lib/logger';
import type { OverlayFontFamily, OverlayTextAlignment, PresetSize, TimestampFormat } from '../../types';
import { useLiveLocation } from '../../lib/liveLocation';
import OverlayFrameEditor from '../common/OverlayFrameEditor';

const ALIGNMENT_OPTIONS: Array<{ horizontal: OverlayTextAlignment['horizontal']; vertical: OverlayTextAlignment['vertical']; icon: typeof ArrowUp; label: string }> = [
    { horizontal: 'left', vertical: 'top', icon: ArrowUpLeft, label: 'ซ้ายบน' },
    { horizontal: 'center', vertical: 'top', icon: ArrowUp, label: 'กลางบน' },
    { horizontal: 'right', vertical: 'top', icon: ArrowUpRight, label: 'ขวาบน' },
    { horizontal: 'left', vertical: 'middle', icon: ArrowLeft, label: 'ซ้ายกลาง' },
    { horizontal: 'center', vertical: 'middle', icon: CircleDot, label: 'กึ่งกลาง' },
    { horizontal: 'right', vertical: 'middle', icon: ArrowRight, label: 'ขวากลาง' },
    { horizontal: 'left', vertical: 'bottom', icon: ArrowDownLeft, label: 'ซ้ายล่าง' },
    { horizontal: 'center', vertical: 'bottom', icon: ArrowDown, label: 'กลางล่าง' },
    { horizontal: 'right', vertical: 'bottom', icon: ArrowDownRight, label: 'ขวาล่าง' },
];

function AlignmentPicker({ value, onChange }: { value: OverlayTextAlignment; onChange: (value: OverlayTextAlignment) => void }) {
    return (
        <div className="alignment-picker" aria-label="จัดวางข้อความในกรอบ">
            {ALIGNMENT_OPTIONS.map((option) => {
                const active = value.horizontal === option.horizontal && value.vertical === option.vertical;
                return (
                    <button
                        type="button"
                        key={`${option.horizontal}-${option.vertical}`}
                        className={active ? 'active' : ''}
                        title={option.label}
                        aria-label={option.label}
                        onClick={() => onChange({ horizontal: option.horizontal, vertical: option.vertical })}
                    >
                        <option.icon className="ui-icon" aria-hidden="true" />
                    </button>
                );
            })}
        </div>
    );
}

type SettingsPage = 'time' | 'location' | 'remark' | 'download' | 'output' | 'overlay' | 'system';
let returnFromMap = false;

export default function SettingsModal() {
    const { state, dispatch, closeModal, deleteAllPhotos, showToast } = useApp();
    const { settings, photos } = state;
    const live=useLiveLocation();
    const latestSettings=useRef(settings);latestSettings.current=settings;

    const [page,setPage]=useState<SettingsPage|null>(()=>returnFromMap?'location':null);
    const bodyRef=useRef<HTMLDivElement>(null);
    const rootScroll=useRef(0);
    useLayoutEffect(()=>{returnFromMap=false;},[]);
    useLayoutEffect(()=>{
        if(bodyRef.current)bodyRef.current.scrollTop=page?0:rootScroll.current;
    },[page]);
    const openPage=(next:SettingsPage)=>{
        rootScroll.current=bodyRef.current?.scrollTop??0;
        setPage(next);
    };
    const [logs, setLogs] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [locStatus, setLocStatus] = useState('');
    const [isLoadingGPS, setIsLoadingGPS] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [deleting,setDeleting]=useState(false);
    const [updateBusy,setUpdateBusy]=useState(false);
    const close=()=>{if(!isLoadingGPS && !isSearching && !deleting && !updateBusy)closeModal();};
    const busy=isLoadingGPS || isSearching || deleting || updateBusy;
    const back=()=>{if(busy)return;if(page)setPage(null);else close();};
    useBackHandler(60,()=>{back();return true;});

    // Subscribe to logs
    useEffect(() => {
        if(page!=='system' || !settings.showLog)return;
        setLogs(getLogs());
        const unsubscribe = subscribeToLogs(setLogs);
        return unsubscribe;
    }, [page,settings.showLog]);

    const needsLocationDetails = settings.showAddress || settings.showSubdistrict || settings.showDistrict || settings.showProvince;

    // Update address details when any selected location field needs them.
    useEffect(() => {
        if (settings.locationEnabled && settings.locationMode==='manual' && needsLocationDetails && settings.latitude !== null && settings.longitude !== null) {
            if (!settings.cachedAddress && !settings.locationDetails) {
                fetchAddress(settings.latitude, settings.longitude);
            }
        }
    }, [settings.locationEnabled, settings.locationMode, needsLocationDetails, settings.latitude, settings.longitude]);

    const fetchAddress = async (lat: number, lng: number) => {
        setLocStatus('กำลังหาที่อยู่...');
        const result = await reverseGeocodeDetails(lat, lng);
        if(latestSettings.current.locationMode!=='manual'||latestSettings.current.latitude!==lat||latestSettings.current.longitude!==lng)return;
        if (result?.displayName || result?.details) {
            dispatch({ type: 'SET_SETTINGS', payload: { cachedAddress: result.displayName, locationDetails: result.details } });
            setLocStatus('');
        } else {
            setLocStatus('ไม่พบที่อยู่');
        }
    };

    const handleGetGPS = async () => {
        if (isLoadingGPS || isSearching) return;
        setIsLoadingGPS(true);
        setLocStatus('กำลังหาตำแหน่ง GPS...');
        try {
            if(!await requestLocationPermission())throw new Error('ไม่ได้รับอนุญาตตำแหน่ง');
            dispatch({type:'SET_SETTINGS',payload:{locationMode:'gps'}});
            window.dispatchEvent(new Event('timestamp-location-refresh'));
            setLocStatus('');showToast('เปิด GPS แบบ Real-time แล้ว','success');
        } catch (e) {
            setLocStatus(`ไม่สามารถหาตำแหน่ง: ${(e as Error).message}`);
            showToast('หาตำแหน่ง GPS ไม่ได้', 'error');
        } finally {
            setIsLoadingGPS(false);
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim() || isSearching || isLoadingGPS) return;
        setIsSearching(true);
        setLocStatus('กำลังค้นหา...');
        try {
            const result = await forwardGeocode(searchQuery);
            if (result) {
                dispatch({
                    type: 'SET_SETTINGS',
                    payload: {
                        locationMode: 'manual',
                        latitude: result.lat,
                        longitude: result.lng,
                        cachedAddress: result.displayName,
                        locationDetails: result.details,
                    },
                });
                setLocStatus('พบตำแหน่ง');
                showToast('พบตำแหน่งแล้ว', 'success');
            } else {
                setLocStatus('ไม่พบผลลัพธ์');
            }
        } catch (e) {
            setLocStatus('ค้นหาไม่สำเร็จ');
        } finally {
            setIsSearching(false);
        }
    };

    const handleOpenMap = () => {
        if(busy)return;
        returnFromMap=true;
        dispatch({ type: 'SET_ACTIVE_MODAL', payload: 'map' });
    };

    const handleResetSettings = async () => {
        if (!await confirmAction({title:'รีเซ็ตการตั้งค่าทั้งหมด?',message:'คืนค่าการตั้งค่าของแอปเป็นค่าเริ่มต้น โดยไม่ลบภาพในคลัง',action:'รีเซ็ต',kind:'warning'})) return;
        resetSettings();
        dispatch({ type: 'RESET_SETTINGS' });
        showToast('รีเซ็ตการตั้งค่าแล้ว', 'info');
    };

    const handleDeleteAllPhotos = async () => {
        if (photos.length === 0) return;
        if (!await confirmAction({title:`ย้ายรูปทั้งหมด ${photos.length} รูป?`,message:'ภาพจะถูกย้ายไปยังถังขยะ สามารถกู้คืนได้',action:'ย้ายไปถังขยะ',kind:'trash'})) return;
        setDeleting(true);
        try {await deleteAllPhotos();showToast('ลบรูปทั้งหมดแล้ว','info');}
        catch {showToast('ย้ายรูปไปถังขยะไม่สำเร็จ','error');}
        finally {setDeleting(false);}
    };

    const handleCopyLogs = async () => {
        await copyLogs();
        showToast('คัดลอก log แล้ว', 'success');
    };

    // Group presets by orientation
    const portraitPresets = PRESET_SIZES.filter((p) => p.orientation === 'portrait');
    const landscapePresets = PRESET_SIZES.filter((p) => p.orientation === 'landscape');

    const currentPreset = PRESET_SIZES.find(
        (p) => p.width === settings.presetSize.w && p.height === settings.presetSize.h
    );

    const handlePresetChange = (preset: PresetSize) => {
        dispatch({
            type: 'SET_SETTINGS',
            payload: {
                presetSize: { w: preset.width, h: preset.height },
                presetOrientation: preset.orientation,
            },
        });
    };

    const categories = [
        {id:'time',title:'เวลาและ Timestamp',icon:Clock,description:'เวลาถ่ายภาพ · รูปแบบวันที่',value:'เวลาปัจจุบัน'},
        {id:'location',title:'ตำแหน่ง',icon:MapPin,description:'GPS · แผนที่ · รายละเอียดที่อยู่',value:settings.locationEnabled?'เปิด':'ปิด'},
        {id:'remark',title:'Remark',icon:NotebookPen,description:'ข้อความบนภาพ · ข้อความเริ่มต้น',value:settings.showRemark?'เปิด':'ปิด'},
        {id:'download',title:'ดาวน์โหลด',icon:Download,description:'จัดการภาพหลังบันทึกไฟล์',value:settings.autoTrashAfterDownload?'ลบอัตโนมัติ':'เก็บภาพไว้'},
        {id:'output',title:'ขนาดและสัดส่วนภาพ',icon:Ruler,description:'Original · Preset · Fit Mode',value:settings.outputMode==='original'?'ขนาดเดิม':settings.presetSize.w+' × '+settings.presetSize.h},
        {id:'overlay',title:'ตัวอักษรและการจัดวาง',icon:Frame,description:'ฟอนต์ · ขอบ · กรอบข้อความ',value:''},
        {id:'system',title:'จัดการแอป',icon:Settings,description:'อัปเดต · Log · จัดการคลังภาพ',value:''},
    ] as const;
    const activeCategory=categories.find(item=>item.id===page);
    const renderCategory=(item:typeof categories[number])=>(
        <button type="button" key={item.id} className="settings-category" onClick={()=>openPage(item.id)} aria-label={item.title}>
            <span className="settings-category-icon"><item.icon aria-hidden="true"/></span>
            <span className="settings-category-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
            {item.value && <span className="settings-category-value">{item.value}</span>}
            <ChevronRight className="settings-chevron" aria-hidden="true"/>
        </button>
    );
    return (
        <div className="modal-backdrop settings-modal settings-redesign" onClick={close}>
            <div className="modal-content" role="dialog" aria-modal="true" aria-label={activeCategory?.title??'ตั้งค่า'} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header settings-header">
                    {page && <button className="icon-btn" aria-label="กลับหมวดการตั้งค่า" disabled={busy} onClick={back}><ArrowLeft className="ui-icon" aria-hidden="true"/></button>}
                    <h2>{!page && <Settings className="ui-icon" aria-hidden="true"/>}{activeCategory?.title??'ตั้งค่า'}</h2>
                    <button className="icon-btn" aria-label="ปิดการตั้งค่า" disabled={busy} onClick={close}><X className="ui-icon" aria-hidden="true" /></button>
                </div>
                <div ref={bodyRef} className="modal-body settings-body">
                    {!page && <div className="settings-home" key="home">
                        <div className="settings-intro"><strong>การตั้งค่าภาพถ่าย</strong><p>เลือกหมวดที่ต้องการปรับ ระบบบันทึกค่าให้อัตโนมัติ</p></div>
                        <div className="settings-list-label">การถ่ายภาพและข้อมูล</div>
                        <div className="settings-category-list">{categories.slice(0,4).map(renderCategory)}</div>
                        <div className="settings-list-label">ลักษณะภาพ</div>
                        <div className="settings-category-list">{categories.slice(4,6).map(renderCategory)}</div>
                        <div className="settings-list-label">ระบบ</div>
                        <div className="settings-category-list">{categories.slice(6).map(renderCategory)}</div>
                        <p className="settings-version">Timestamp Cam · v1.5.9</p>
                    </div>}
                    {page && <div key={page} className="settings-detail">
                    {/* Time Section */}
                    {page==='time' && (
                    <div id="settings-time" className="settings-section">
                        <h3><Clock className="ui-icon" aria-hidden="true" /> เวลา (Global)</h3>
                        <p className="settings-note">รูปใหม่ใช้เวลาปัจจุบัน ณ ตอนถ่ายหรือเริ่มนำเข้าเสมอ สามารถแก้ไขเวลาเฉพาะรูปได้จากการ์ดภาพ</p>
                    </div>
                    )}

                    {/* Format Section */}
                    {page==='time' && (
                    <div id="settings-format" className="settings-section">
                        <h3><FileText className="ui-icon" aria-hidden="true" /> รูปแบบ Timestamp</h3>
                        <div className="settings-row">
                            <label>รูปแบบ</label>
                            <select
                                value={settings.timestampFormat}
                                onChange={(e) => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { timestampFormat: e.target.value as TimestampFormat },
                                    });
                                }}
                            >
                                <option value="thai-verbose">ไทยแบบยาว + GMT+07:00</option>
                                <option value="sample-overlay">แบบภาพตัวอย่าง</option>
                                <option value="iso">YYYY-MM-DD HH:mm:ss</option>
                            </select>
                        </div>
                        <p className="settings-note">แบบภาพตัวอย่างใช้เดือนย่อไทย ค.ศ. และพิกัด DMS เมื่อเปิดตำแหน่ง</p>
                    </div>
                    )}

                    {/* Output Section */}
                    {page==='output' && (
                    <div id="settings-size" className="settings-section">
                        <h3><Ruler className="ui-icon" aria-hidden="true" /> Output & ขนาด</h3>
                        <div className="settings-row">
                            <label>โหมด Output</label>
                            <select
                                value={settings.outputMode}
                                onChange={(e) => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { outputMode: e.target.value as 'original' | 'preset' },
                                    });
                                }}
                            >
                                <option value="original">Original (ขนาดเดิม)</option>
                                <option value="preset">Preset (กำหนดขนาด)</option>
                            </select>
                        </div>

                        {settings.outputMode === 'preset' && (
                            <>
                                <div className="settings-row">
                                    <label>มุมมอง</label>
                                    <select
                                        value={settings.presetOrientation}
                                        onChange={(e) => {
                                            const orientation = e.target.value as 'portrait' | 'landscape';
                                            const presets = orientation === 'portrait' ? portraitPresets : landscapePresets;
                                            if (presets.length > 0) {
                                                handlePresetChange(presets[0]);
                                            }
                                        }}
                                    >
                                        <option value="portrait">แนวตั้ง (Portrait)</option>
                                        <option value="landscape">แนวนอน (Landscape)</option>
                                    </select>
                                </div>

                                <div className="settings-row">
                                    <label>ขนาด Preset</label>
                                    <select
                                        value={currentPreset?.label || ''}
                                        onChange={(e) => {
                                            const preset = PRESET_SIZES.find((p) => p.label === e.target.value);
                                            if (preset) handlePresetChange(preset);
                                        }}
                                    >
                                        {(settings.presetOrientation === 'portrait' ? portraitPresets : landscapePresets).map((p) => (
                                            <option key={p.label} value={p.label}>
                                                {p.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="settings-row">
                                    <label>Fit Mode</label>
                                    <select
                                        value={settings.fitMode}
                                        onChange={(e) => {
                                            dispatch({
                                                type: 'SET_SETTINGS',
                                                payload: { fitMode: e.target.value as 'contain' | 'cover' },
                                            });
                                        }}
                                    >
                                        <option value="cover">Cover (ครอปเต็มเฟรม)</option>
                                        <option value="contain">Contain (มีขอบดำ)</option>
                                    </select>
                                </div>
                            </>
                        )}
                    </div>
                    )}

                    {/* Overlay Section */}
                    {page==='overlay' && (
                    <div id="settings-overlay" className="settings-section">
                        <h3><Tag className="ui-icon" aria-hidden="true" /> Overlay</h3>
                        <div className="settings-row">
                            <label>Padding (px)</label>
                            <input
                                type="number"
                                min="0"
                                max="100"
                                value={settings.overlayPadding}
                                onChange={(e) => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { overlayPadding: parseInt(e.target.value) || 0 },
                                    });
                                }}
                            />
                        </div>

                        <div className="settings-row">
                            <label>ฟอนต์</label>
                            <select
                                value={settings.overlayFontFamily}
                                onChange={(e) => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { overlayFontFamily: e.target.value as OverlayFontFamily },
                                    });
                                }}
                            >
                                <option value="android-ui">Android UI (เหมือนตัวอย่าง)</option>
                                <option value="noto-thai-ui">Noto Sans Thai UI</option>
                                <option value="noto-thai-looped-ui">Noto Sans Thai Looped UI</option>
                                <option value="system-sans">System Sans</option>
                            </select>
                        </div>

                        <div className="settings-row">
                            <label>ความหนาฟอนต์</label>
                            <select
                                value={settings.overlayFontWeight}
                                onChange={(e) => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { overlayFontWeight: parseInt(e.target.value, 10) },
                                    });
                                }}
                            >
                                <option value={400}>Regular</option>
                                <option value={500}>Medium (เหมือนตัวอย่าง)</option>
                                <option value={700}>Bold</option>
                            </select>
                        </div>

                        <div className="settings-row">
                            <label>ความหนาขอบดำ</label>
                            <input
                                type="number"
                                min="0"
                                max="8"
                                step="0.1"
                                value={settings.overlayStrokeWidth}
                                onChange={(e) => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { overlayStrokeWidth: parseFloat(e.target.value) || 0 },
                                    });
                                }}
                            />
                        </div>

                        <div className="settings-row">
                            <label>ความสูงฟอนต์</label>
                            <input
                                type="range"
                                min="0.75"
                                max="1.35"
                                step="0.05"
                                value={settings.overlayFontHeightScale}
                                onChange={(e) => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { overlayFontHeightScale: parseFloat(e.target.value) },
                                    });
                                }}
                                style={{ width: 100 }}
                            />
                            <span>{Math.round(settings.overlayFontHeightScale * 100)}%</span>
                        </div>

                        <div className="settings-row">
                            <label>ขนาดตัวอักษร</label>
                            <select
                                value={settings.fontMode}
                                onChange={(e) => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { fontMode: e.target.value as 'auto' | 'fixed' },
                                    });
                                }}
                            >
                                <option value="auto">Auto (ตาม output)</option>
                                <option value="fixed">Fixed (กำหนดเอง)</option>
                            </select>
                        </div>

                        {settings.fontMode === 'auto' ? (
                            <div className="settings-row">
                                <label>Scale</label>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="2"
                                    step="0.1"
                                    value={settings.fontAutoScale}
                                    onChange={(e) => {
                                        dispatch({
                                            type: 'SET_SETTINGS',
                                            payload: { fontAutoScale: parseFloat(e.target.value) },
                                        });
                                    }}
                                    style={{ width: 100 }}
                                />
                                <span>{Math.round(settings.fontAutoScale * 100)}%</span>
                            </div>
                        ) : (
                            <div className="settings-row">
                                <label>ขนาด (px)</label>
                                <input
                                    type="number"
                                    min="12"
                                    max="72"
                                    value={settings.fontFixedPx}
                                    onChange={(e) => {
                                        dispatch({
                                            type: 'SET_SETTINGS',
                                            payload: { fontFixedPx: parseInt(e.target.value) || 24 },
                                        });
                                    }}
                                />
                            </div>
                        )}

                        <p className="settings-note">ปรับตัวอักษรและขอบดำตามภาพที่ต้องการ</p>
                    </div>
                    )}

                    {page==='overlay' && (
                    <div id="settings-frame" className="settings-section">
                        <h3><Frame className="ui-icon" aria-hidden="true" /> กรอบวางข้อความ</h3>
                        <OverlayFrameEditor
                            timeFrame={settings.timeFrame}
                            locationFrame={settings.locationFrame}
                            aspectRatio={settings.outputMode === 'original'
                                ? 3 / 4
                                : settings.presetSize.w / settings.presetSize.h}
                            onChange={(kind, frame) => dispatch({
                                type: 'SET_SETTINGS',
                                payload: kind === 'time' ? { timeFrame: frame } : { locationFrame: frame },
                            })}
                        />
                        <p className="settings-note">ลากกรอบเพื่อย้ายตำแหน่ง และลากมุมล่างขวาเพื่อปรับขนาด กรอบจะไม่ปรากฏบนรูปที่บันทึก</p>
                        <div className="frame-alignment-row">
                            <span>จัดข้อความเวลา</span>
                            <AlignmentPicker
                                value={settings.timeTextAlignment}
                                onChange={(timeTextAlignment) => dispatch({ type: 'SET_SETTINGS', payload: { timeTextAlignment } })}
                            />
                        </div>
                        <div className="frame-alignment-row">
                            <span>จัดข้อความตำแหน่ง</span>
                            <AlignmentPicker
                                value={settings.locationTextAlignment}
                                onChange={(locationTextAlignment) => dispatch({ type: 'SET_SETTINGS', payload: { locationTextAlignment } })}
                            />
                        </div>
                    </div>
                    )}

                    {page==='remark' && (
                    <div id="settings-remark" className="settings-section">
                        <h3><NotebookPen className="ui-icon" aria-hidden="true" /> Remark</h3>
                        <div className="settings-row">
                            <label>แสดง Remark บนรูป</label>
                            <button role="switch" aria-label="แสดง Remark บนรูป" aria-checked={settings.showRemark}
                                className={`toggle ${settings.showRemark ? 'on' : ''}`}
                                onClick={() => dispatch({ type: 'SET_SETTINGS', payload: { showRemark: !settings.showRemark } })}
                            >
                                <span className="toggle-knob">{settings.showRemark ? <Check className="ui-icon" aria-hidden="true" /> : <X className="ui-icon" aria-hidden="true" />}</span>
                            </button>
                        </div>
                        <label className="settings-field-label" htmlFor="default-remark">Remark เริ่มต้นสำหรับรูปใหม่</label>
                        <textarea
                            id="default-remark"
                            value={settings.defaultRemark}
                            onChange={(event) => dispatch({ type: 'SET_SETTINGS', payload: { defaultRemark: event.target.value } })}
                            placeholder="ปล่อยว่างเพื่อไม่กำหนด Remark เริ่มต้น"
                            rows={3}
                        />
                        <p className="settings-note">แก้ Remark ของแต่ละรูปได้จาก popup ของการ์ดภาพ</p>
                    </div>
                    )}

                    {/* Location Section */}
                    {page==='location' && (
                    <div id="settings-location" className="settings-section">
                        <h3><MapPin className="ui-icon" aria-hidden="true" /> ตำแหน่ง</h3>
                        <div className="settings-row">
                            <label>เปิดใช้งานตำแหน่ง</label>
                            <button role="switch" aria-label="เปิดใช้งานตำแหน่ง" aria-checked={settings.locationEnabled}
                                className={`toggle ${settings.locationEnabled ? 'on' : ''}`}
                                onClick={() => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { locationEnabled: !settings.locationEnabled },
                                    });
                                }}
                            >
                                <span className="toggle-knob">{settings.locationEnabled ? <Check className="ui-icon" aria-hidden="true" /> : <X className="ui-icon" aria-hidden="true" />}</span>
                            </button>
                        </div>

                        {settings.locationEnabled && (
                            <>
                                <div className="settings-subheading">แหล่งตำแหน่ง</div>
                                <div className="settings-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
                                    <button
                                        className={`btn btn-sm ${settings.locationMode==='gps'?'btn-primary':'btn-secondary'}`}
                                        onClick={handleGetGPS}
                                        disabled={busy}
                                    >
                                        {isLoadingGPS ? <LoaderCircle className="ui-icon spinning" aria-hidden="true" /> : <LocateFixed className="ui-icon" aria-hidden="true" />} GPS Real-time
                                    </button>
                                    <button className="btn btn-sm btn-secondary" onClick={handleOpenMap} disabled={busy}>
                                        <Map className="ui-icon" aria-hidden="true" /> เลือกบนแผนที่
                                    </button>
                                </div>

                                {settings.locationMode==='gps' && <p className="settings-note">{live.status==='ready' ? `GPS สด: ${live.lat?.toFixed(6)}, ${live.lng?.toFixed(6)}` : live.status==='waiting' ? 'กำลังหาตำแหน่ง GPS…' : 'GPS ไม่พร้อม กด GPS Real-time เพื่ออนุญาตหรือลองใหม่'}</p>}
                                <div className="settings-row">
                                    <label>Lat</label>
                                    <input
                                        type="number"
                                        step="0.000001"
                                        value={(settings.locationMode==='gps'?live.lat:settings.latitude) ?? ''}
                                        onChange={(e) => {
                                            const val = e.target.value ? parseFloat(e.target.value) : null;
                                            dispatch({
                                                type: 'SET_SETTINGS',
                                                payload: { locationMode:'manual', latitude: val, longitude: settings.locationMode==='gps'?live.lng:settings.longitude, cachedAddress: null, locationDetails: null },
                                            });
                                        }}
                                        placeholder="ละติจูด"
                                    />
                                </div>

                                <div className="settings-row">
                                    <label>Lng</label>
                                    <input
                                        type="number"
                                        step="0.000001"
                                        value={(settings.locationMode==='gps'?live.lng:settings.longitude) ?? ''}
                                        onChange={(e) => {
                                            const val = e.target.value ? parseFloat(e.target.value) : null;
                                            dispatch({
                                                type: 'SET_SETTINGS',
                                                payload: { locationMode:'manual', longitude: val, latitude: settings.locationMode==='gps'?live.lat:settings.latitude, cachedAddress: null, locationDetails: null },
                                            });
                                        }}
                                        placeholder="ลองจิจูด"
                                    />
                                </div>

                                <div className="settings-row">
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="ค้นหาสถานที่..."
                                        style={{ flex: 1 }}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                    />
                                    <button
                                        className="btn btn-sm btn-primary"
                                        onClick={handleSearch}
                                        disabled={busy || !searchQuery.trim()}
                                    >
                                        {isSearching ? <LoaderCircle className="ui-icon spinning" aria-hidden="true" /> : <Search className="ui-icon" aria-hidden="true" />}
                                    </button>
                                </div>

                                {locStatus && <p className="settings-note">{locStatus}</p>}
                                {(settings.locationMode==='gps'?live.address:settings.cachedAddress) && (
                                    <p className="settings-note" style={{ color: 'var(--accent)' }}>
                                        <MapPin className="ui-icon" aria-hidden="true" /> {settings.locationMode==='gps'?live.address:settings.cachedAddress}
                                    </p>
                                )}
                                <div className="settings-subheading">ข้อมูลที่แสดงบนภาพ</div>
                                <div className="settings-row">
                                    <label>แสดง Lat/Lng</label>
                                    <button role="switch" aria-label="แสดง Lat/Lng" aria-checked={settings.showLatLng}
                                        className={`toggle ${settings.showLatLng ? 'on' : ''}`}
                                        onClick={() => {
                                            dispatch({
                                                type: 'SET_SETTINGS',
                                                payload: { showLatLng: !settings.showLatLng },
                                            });
                                        }}
                                    >
                                        <span className="toggle-knob">{settings.showLatLng ? <Check className="ui-icon" aria-hidden="true" /> : <X className="ui-icon" aria-hidden="true" />}</span>
                                    </button>
                                </div>

                                <div className="settings-row">
                                    <label>แสดงที่อยู่</label>
                                    <button role="switch" aria-label="แสดงที่อยู่" aria-checked={settings.showAddress}
                                        className={`toggle ${settings.showAddress ? 'on' : ''}`}
                                        onClick={() => {
                                            dispatch({
                                                type: 'SET_SETTINGS',
                                                payload: { showAddress: !settings.showAddress },
                                            });
                                        }}
                                    >
                                        <span className="toggle-knob">{settings.showAddress ? <Check className="ui-icon" aria-hidden="true" /> : <X className="ui-icon" aria-hidden="true" />}</span>
                                    </button>
                                </div>

                                <div className="settings-row">
                                    <label>แสดงแขวง/ตำบล</label>
                                    <button role="switch" aria-label="แสดงแขวง/ตำบล" aria-checked={settings.showSubdistrict} className={`toggle ${settings.showSubdistrict ? 'on' : ''}`} onClick={() => dispatch({ type: 'SET_SETTINGS', payload: { showSubdistrict: !settings.showSubdistrict } })}>
                                        <span className="toggle-knob">{settings.showSubdistrict ? <Check className="ui-icon" aria-hidden="true" /> : <X className="ui-icon" aria-hidden="true" />}</span>
                                    </button>
                                </div>

                                <div className="settings-row">
                                    <label>แสดงเขต/อำเภอ</label>
                                    <button role="switch" aria-label="แสดงเขต/อำเภอ" aria-checked={settings.showDistrict} className={`toggle ${settings.showDistrict ? 'on' : ''}`} onClick={() => dispatch({ type: 'SET_SETTINGS', payload: { showDistrict: !settings.showDistrict } })}>
                                        <span className="toggle-knob">{settings.showDistrict ? <Check className="ui-icon" aria-hidden="true" /> : <X className="ui-icon" aria-hidden="true" />}</span>
                                    </button>
                                </div>

                                <div className="settings-row">
                                    <label>แสดงจังหวัด</label>
                                    <button role="switch" aria-label="แสดงจังหวัด" aria-checked={settings.showProvince} className={`toggle ${settings.showProvince ? 'on' : ''}`} onClick={() => dispatch({ type: 'SET_SETTINGS', payload: { showProvince: !settings.showProvince } })}>
                                        <span className="toggle-knob">{settings.showProvince ? <Check className="ui-icon" aria-hidden="true" /> : <X className="ui-icon" aria-hidden="true" />}</span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    )}

                    {page==='download' && (
                    <div id="settings-download" className="settings-section">
                        <h3><Download className="ui-icon" aria-hidden="true" /> ดาวน์โหลด</h3>
                        <div className="settings-row">
                            <label htmlFor="auto-trash-download">ลบภาพอัตโนมัติหลังดาวน์โหลด</label>
                            <button id="auto-trash-download" role="switch" aria-checked={settings.autoTrashAfterDownload}
                                aria-label="ลบภาพอัตโนมัติหลังดาวน์โหลด" className={`toggle ${settings.autoTrashAfterDownload ? 'on' : ''}`}
                                onClick={() => dispatch({type:'SET_SETTINGS',payload:{autoTrashAfterDownload:!settings.autoTrashAfterDownload}})}>
                                <span className="toggle-knob">{settings.autoTrashAfterDownload ? <Check className="ui-icon" aria-hidden="true"/> : <X className="ui-icon" aria-hidden="true"/>}</span>
                            </button>
                        </div>
                        <p className="settings-note">ย้ายเฉพาะภาพที่ยืนยันว่าบันทึกไฟล์สำเร็จไปยังถังขยะของแอป กู้คืนได้ตามปกติ</p>
                    </div>
                    )}

                    {page==='system' && <AppUpdatePanel onBusy={setUpdateBusy}/>}
                    {/* Log Section */}
                    {page==='system' && (
                    <div id="settings-log" className="settings-section">
                        <h3><ClipboardList className="ui-icon" aria-hidden="true" /> Log</h3>
                        <div className="settings-row">
                            <label>แสดง Log</label>
                            <button role="switch" aria-label="แสดง Log" aria-checked={settings.showLog}
                                className={`toggle ${settings.showLog ? 'on' : ''}`}
                                onClick={() => {
                                    dispatch({
                                        type: 'SET_SETTINGS',
                                        payload: { showLog: !settings.showLog },
                                    });
                                }}
                            >
                                <span className="toggle-knob">{settings.showLog ? <Check className="ui-icon" aria-hidden="true" /> : <X className="ui-icon" aria-hidden="true" />}</span>
                            </button>
                        </div>

                        {settings.showLog && (
                            <>
                                <div className="settings-row">
                                    <button className="btn btn-sm btn-secondary" onClick={handleCopyLogs}>
                                        <ClipboardList className="ui-icon" aria-hidden="true" /> Copy Log
                                    </button>
                                    <button className="btn btn-sm btn-secondary" onClick={clearLogs}>
                                        <Trash2 className="ui-icon" aria-hidden="true" /> Clear Log
                                    </button>
                                </div>
                                <div className="log-panel">
                                    <pre>{logs.join('\n') || 'No logs yet'}</pre>
                                </div>
                            </>
                        )}
                    </div>
                    )}

                    {/* Danger Zone */}
                    {page==='system' && (
                    <div id="settings-danger" className="settings-section danger-zone">
                        <h3><TriangleAlert className="ui-icon" aria-hidden="true" /> Danger Zone</h3>
                        <div className="settings-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
                            <button className="btn btn-sm btn-outline" onClick={handleResetSettings}>
                                <RefreshCw className="ui-icon" aria-hidden="true" /> Reset Settings
                            </button>
                            <button
                                className="btn btn-sm btn-danger"
                                onClick={handleDeleteAllPhotos}
                                disabled={photos.length === 0 || deleting}
                            >
                                <Trash2 className="ui-icon" aria-hidden="true" /> ลบรูปทั้งหมด ({photos.length})
                            </button>
                        </div>
                    </div>
                    )}
                    </div>}
                </div>
                {page && <div className="settings-saved"><Check className="ui-icon" aria-hidden="true"/> บันทึกการตั้งค่าอัตโนมัติ</div>}
            </div>
        </div>
    );
}
