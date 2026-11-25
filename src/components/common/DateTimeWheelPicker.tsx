import { useBackHandler } from '../../lib/backNavigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import PickerColumn from './PremiumWheel';

interface DateTimeWheelPickerProps {
    value: string;
    onChange: (iso: string) => void;
    className?: string;
}

const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function formatDateTime(iso: string): string {
    const date = new Date(iso);
    const day = date.getDate().toString().padStart(2, '0');
    const month = thaiMonths[date.getMonth()];
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${day} ${month} ${year} ${hours}:${minutes}:${seconds}`;
}

export default function DateTimeWheelPicker({ value, onChange, className = '' }: DateTimeWheelPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [draft, setDraft] = useState(() => new Date(value));
    const draftRef = useRef(draft);
    useBackHandler(90,()=>{if(!isOpen)return false;setIsOpen(false);return true;});
    useEffect(() => {
        if (!isOpen) return;
        window.dispatchEvent(new Event('timestamp-picker-open'));
        return () => { window.dispatchEvent(new Event('timestamp-picker-close')); };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) { draftRef.current = new Date(value); setDraft(draftRef.current); }
    }, [value, isOpen]);

    const setPart = (part: 'date' | 'month' | 'year' | 'hours' | 'minutes' | 'seconds', next: number) => {
        {
            const updated = new Date(draftRef.current);
            if (part === 'date') updated.setDate(Math.min(next, new Date(updated.getFullYear(), updated.getMonth() + 1, 0).getDate()));
            if (part === 'month' || part === 'year') {
                const currentDate = updated.getDate();
                updated.setDate(1);
                if (part === 'month') updated.setMonth(next - 1);
                if (part === 'year') updated.setFullYear(next);
                updated.setDate(Math.min(currentDate, new Date(updated.getFullYear(), updated.getMonth() + 1, 0).getDate()));
            }
            if (part === 'hours') updated.setHours(next);
            if (part === 'minutes') updated.setMinutes(next);
            if (part === 'seconds') updated.setSeconds(next);
            draftRef.current = updated;
            setDraft(updated);
        }
    };

    const years = Array.from({ length: 201 }, (_, index) => 1900 + index);
    const daysInMonth = new Date(draft.getFullYear(), draft.getMonth() + 1, 0).getDate();

    return (
        <>
            <button
                type="button"
                className={`date-time-wheel-trigger ${className}`.trim()}
                onClick={() => setIsOpen(true)}
            >
                {formatDateTime(value)}
            </button>

            {isOpen && createPortal(
                <div className="datetime-picker-backdrop" onClick={(e) => {e.stopPropagation();setIsOpen(false);}}>
                    <div className="datetime-picker" role="dialog" aria-modal="true" aria-label="ตั้งวันที่และเวลา" onClick={(event) => event.stopPropagation()}>
                        <div className="datetime-picker-header">
                            <h3>ตั้งวันที่และเวลา</h3>
                        </div>
                        <div className="wheel-columns">
                            <PickerColumn label="วัน" cyclic values={Array.from({ length: daysInMonth }, (_, i) => i + 1)} selected={draft.getDate()} format={(item) => item.toString().padStart(2, '0')} onChange={(item) => setPart('date', item)} />
                            <PickerColumn label="เดือน" cyclic values={Array.from({ length: 12 }, (_, i) => i + 1)} selected={draft.getMonth() + 1} format={(item) => thaiMonths[item - 1]} onChange={(item) => setPart('month', item)} />
                            <PickerColumn label="ปี" values={years} selected={draft.getFullYear()} format={String} onChange={(item) => setPart('year', item)} />
                            <PickerColumn label="ชั่วโมง" cyclic values={Array.from({ length: 24 }, (_, i) => i)} selected={draft.getHours()} format={(item) => item.toString().padStart(2, '0')} onChange={(item) => setPart('hours', item)} />
                            <PickerColumn label="นาที" cyclic values={Array.from({ length: 60 }, (_, i) => i)} selected={draft.getMinutes()} format={(item) => item.toString().padStart(2, '0')} onChange={(item) => setPart('minutes', item)} />
                            <PickerColumn label="วินาที" cyclic values={Array.from({ length: 60 }, (_, i) => i)} selected={draft.getSeconds()} format={(item) => item.toString().padStart(2, '0')} onChange={(item) => setPart('seconds', item)} />
                        </div>
                        <div className="datetime-picker-actions">
                            <button className="btn btn-secondary" onClick={() => setIsOpen(false)}>ยกเลิก</button>
                            <button className="btn btn-primary" onClick={() => { window.dispatchEvent(new Event('timestamp-wheel-flush')); onChange(draftRef.current.toISOString()); setIsOpen(false); }}>ตั้งค่า</button>
                        </div>
                    </div>
                </div>, document.body
            )}
        </>
    );
}
