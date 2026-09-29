import type { Settings, PresetSize } from '../types';

const SETTINGS_KEY = 'timestamp-settings';

// Available preset sizes (portrait and landscape)
export const PRESET_SIZES: PresetSize[] = [
    // Portrait
    { label: 'Full HD+ (1080×2340)', width: 1080, height: 2340, orientation: 'portrait' },
    { label: 'Full HD (1080×1920)', width: 1080, height: 1920, orientation: 'portrait' },
    { label: 'HD (720×1280)', width: 720, height: 1280, orientation: 'portrait' },
    { label: 'Square (1080×1080)', width: 1080, height: 1080, orientation: 'portrait' },
    // Landscape
    { label: 'Full HD+ (2340×1080)', width: 2340, height: 1080, orientation: 'landscape' },
    { label: 'Full HD (1920×1080)', width: 1920, height: 1080, orientation: 'landscape' },
    { label: 'HD (1280×720)', width: 1280, height: 720, orientation: 'landscape' },
    { label: 'Square (1080×1080)', width: 1080, height: 1080, orientation: 'landscape' },
];

export const DEFAULT_SETTINGS: Settings = {
    globalTimeMode: 'now',
    globalCustomTime: new Date().toISOString(),
    timestampFormat: 'sample-overlay',
    outputMode: 'original',
    presetSize: { w: 1080, h: 2340 },
    presetOrientation: 'portrait',
    fitMode: 'cover',
    overlayPosition: 'TR',
    overlayPadding: 26,
    overlayFontFamily: 'android-ui',
    overlayFontWeight: 400,
    overlayStrokeWidth: 0.4,
    overlayFontHeightScale: 1.05,
    fontMode: 'auto',
    fontAutoScale: 1.1,
    fontFixedPx: 32,
    locationEnabled: true,
    showLatLng: false,
    showAddress: false,
    showSubdistrict: false,
    showDistrict: true,
    showProvince: true,
    showRemark: true,
    defaultRemark: '',
    latitude: null,
    longitude: null,
    cachedAddress: null,
    locationDetails: null,
    timeFrame: { x: 0.08, y: 0, width: 0.92, height: 0.16 },
    locationFrame: { x: 0.5640195355197868, y: 0.06735555013020833, width: 0.4359804644802132, height: 0.42147104899088544 },
    timeTextAlignment: { horizontal: 'right', vertical: 'top' },
    locationTextAlignment: { horizontal: 'right', vertical: 'top' },
    showLog: false,
};

export function loadSettings(): Settings {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

export function resetSettings(): void {
    localStorage.removeItem(SETTINGS_KEY);
}
