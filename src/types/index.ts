// Photo record stored in IndexedDB
export interface PhotoRecord {
    id: string;
    baseBlob: Blob;
    width: number;
    height: number;
    createdAtISO: string;
    timeMode: 'now' | 'custom';
    timeValueISO: string;
    sourceName: string;
    fromFrontMirror: boolean;
    locationLatitude?: number | null;
    locationLongitude?: number | null;
    locationAddress?: string | null;
}

// Runtime photo with object URL
export interface Photo extends PhotoRecord {
    thumbUrl: string;
}

// A removed photo is retained locally for a limited time before permanent deletion.
export interface TrashRecord extends PhotoRecord {
    deletedAtISO: string;
}

export interface TrashPhoto extends TrashRecord {
    thumbUrl: string;
}

// Preset size option
export interface PresetSize {
    label: string;
    width: number;
    height: number;
    orientation: 'portrait' | 'landscape';
}

export type OverlayFontFamily =
    | 'android-ui'
    | 'noto-thai-ui'
    | 'noto-thai-looped-ui'
    | 'system-sans';

export type TimestampFormat = 'thai-verbose' | 'iso' | 'sample-overlay';

// App settings stored in localStorage
export interface Settings {
    // Time
    globalTimeMode: 'now' | 'custom';
    globalCustomTime: string;

    // Format
    timestampFormat: TimestampFormat;

    // Output
    outputMode: 'original' | 'preset';
    presetSize: { w: number; h: number };
    presetOrientation: 'portrait' | 'landscape';
    fitMode: 'contain' | 'cover';

    // Overlay
    overlayPosition: 'TR' | 'TC' | 'TL' | 'BR' | 'BC' | 'BL';
    overlayPadding: number;
    overlayFontFamily: OverlayFontFamily;
    overlayFontWeight: number;
    overlayStrokeWidth: number;
    overlayFontHeightScale: number;
    fontMode: 'auto' | 'fixed';
    fontAutoScale: number;
    fontFixedPx: number;

    // Location
    locationEnabled: boolean;
    showLatLng: boolean;
    showAddress: boolean;
    latitude: number | null;
    longitude: number | null;
    cachedAddress: string | null;

    // Log
    showLog: boolean;
}

// Toast message
export interface ToastMessage {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

// Camera status
export type CameraStatus = 'off' | 'starting' | 'ready' | 'error' | 'denied';

// Modal type
export type ModalType = 'none' | 'preview' | 'settings' | 'map' | 'trash';

// Download file type
export type DownloadFormat = 'jpeg' | 'png';
