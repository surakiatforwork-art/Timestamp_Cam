import { useEffect, useRef, useState } from 'react';

interface PickerColumnProps {
    label: string;
    values: number[];
    selected: number;
    format: (value: number) => string;
    onChange: (value: number) => void;
    cyclic?: boolean;
}

const ITEM_HEIGHT = 42;
const CYCLE_COPIES = 7;

function PickerColumn({ label, values, selected, format, onChange, cyclic = false }: PickerColumnProps) {
    const ref = useRef<HTMLDivElement>(null);
    const scrollTimer = useRef<number | null>(null);
    const hasPositioned = useRef(false);
    const items = cyclic ? Array.from({ length: CYCLE_COPIES }, () => values).flat() : values;
    const middleOffset = cyclic ? values.length * Math.floor(CYCLE_COPIES / 2) : 0;

    useEffect(() => {
        const index = Math.max(0, values.indexOf(selected));
        const element = ref.current;
        if (!element) return;
        const activeIndex = Math.round(element.scrollTop / ITEM_HEIGHT);
        const activeValue = cyclic ? values[((activeIndex % values.length) + values.length) % values.length] : values[activeIndex];
        if (!hasPositioned.current || activeValue !== selected) {
            element.scrollTop = (middleOffset + index) * ITEM_HEIGHT;
            hasPositioned.current = true;
        }
    }, [selected, values, cyclic, middleOffset]);

    const selectFromScroll = () => {
        if (!ref.current) return;
        const rawIndex = Math.round(ref.current.scrollTop / ITEM_HEIGHT);
        const index = cyclic
            ? ((rawIndex % values.length) + values.length) % values.length
            : Math.max(0, Math.min(values.length - 1, rawIndex));
        const nextValue = values[index];
        if (nextValue !== selected) onChange(nextValue);

        // Re-center the same item after the momentum has finished. The visual value
        // remains unchanged, but there are always more items above and below it.
        if (cyclic) {
            ref.current.scrollTop = (middleOffset + index) * ITEM_HEIGHT;
        }
    };

    return (
        <div className="wheel-column">
            <span>{label}</span>
            <div
                className="wheel-scroll"
                ref={ref}
                onScroll={() => {
                    if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
                    scrollTimer.current = window.setTimeout(selectFromScroll, 70);
                }}
            >
                <div className="wheel-spacer" />
                {items.map((value, index) => (
                    <button
                        type="button"
                        className={value === selected ? 'selected' : ''}
                        key={`${index}-${value}`}
                        onClick={() => onChange(value)}
                    >
                        {format(value)}
                    </button>
                ))}
                <div className="wheel-spacer" />
            </div>
        </div>
    );
}

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

    useEffect(() => {
        if (!isOpen) setDraft(new Date(value));
    }, [value, isOpen]);

    const setPart = (part: 'date' | 'month' | 'year' | 'hours' | 'minutes' | 'seconds', next: number) => {
        setDraft((current) => {
            const updated = new Date(current);
            if (part === 'date') updated.setDate(next);
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
            return updated;
        });
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

            {isOpen && (
                <div className="datetime-picker-backdrop" onClick={() => setIsOpen(false)}>
                    <div className="datetime-picker" onClick={(event) => event.stopPropagation()}>
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
                            <button className="btn btn-primary" onClick={() => { onChange(draft.toISOString()); setIsOpen(false); }}>ตั้งค่า</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
