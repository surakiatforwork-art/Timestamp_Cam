import type { TimestampFormat } from '../types';

// Format date/time according to selected format
export function formatTimestamp(date: Date, format: TimestampFormat): string {
    if (format === 'iso') {
        return formatISO(date);
    }
    if (format === 'sample-overlay') {
        return formatSampleOverlay(date);
    }
    return formatThaiVerbose(date);
}

function formatThaiVerbose(date: Date): string {
    const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

    const day = thaiDays[date.getDay()];
    const d = date.getDate();
    const month = thaiMonths[date.getMonth()];
    const year = date.getFullYear() + 543; // Buddhist year
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');

    return `วัน${day}ที่ ${d} ${month} ${year} ${h}:${m}:${s} GMT+07:00`;
}

function formatISO(date: Date): string {
    const y = date.getFullYear();
    const mo = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${y}-${mo}-${d} ${h}:${m}:${s}`;
}

function formatSampleOverlay(date: Date): string {
    const thaiShortMonths = [
        'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];

    const d = date.getDate();
    const month = thaiShortMonths[date.getMonth()];
    const y = date.getFullYear();
    const h = date.getHours();
    const m = date.getMinutes();
    const s = date.getSeconds();

    return `${d} ${month} ${y} ${h} นาฬิกา ${m} นาที ${s} วินาที GMT+07:00`;
}

export function formatDMS(lat: number, lng: number): string {
    return `${formatDMSPart(lat, 'lat')} ${formatDMSPart(lng, 'lng')}`;
}

function formatDMSPart(value: number, axis: 'lat' | 'lng'): string {
    const direction = axis === 'lat'
        ? value >= 0 ? 'N' : 'S'
        : value >= 0 ? 'E' : 'W';
    const abs = Math.abs(value);
    const degrees = Math.floor(abs);
    const minutesFloat = (abs - degrees) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = (minutesFloat - minutes) * 60;

    return `${degrees}°${minutes}'${seconds.toFixed(3)}"${direction}`;
}

// Generate filename for download
export function generateFilename(index: number, format: 'jpeg' | 'png'): string {
    const now = new Date();
    const y = now.getFullYear();
    const mo = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    return `TS_${y}${mo}${d}_${h}${m}${s}_${(index + 1).toString().padStart(3, '0')}.${ext}`;
}

// Generate UUID
export function generateId(): string {
    return crypto.randomUUID();
}

// datetime-local expects a local wall-clock value, while stored timestamps are UTC ISO strings.
export function toDateTimeLocalValue(iso: string): string {
    const date = new Date(iso);
    const y = date.getFullYear();
    const mo = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${y}-${mo}-${d}T${h}:${m}:${s}`;
}

export function dateTimeLocalValueToISO(value: string): string {
    return new Date(value).toISOString();
}

// Format time summary for display
export function formatTimeSummary(mode: 'now' | 'custom', customTime: string): string {
    if (mode === 'now') {
        return 'ใช้เวลาปัจจุบัน';
    }
    const date = new Date(customTime);
    return formatISO(date);
}

// Format location summary
export function formatLocationSummary(
    enabled: boolean,
    lat: number | null,
    lng: number | null,
    address: string | null
): string {
    if (!enabled) return 'ปิด';
    if (lat === null || lng === null) return 'ยังไม่ได้ระบุ';
    if (address) return address.substring(0, 30) + (address.length > 30 ? '...' : '');
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
