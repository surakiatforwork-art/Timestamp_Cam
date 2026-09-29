import { Geolocation } from '@capacitor/geolocation';
import { OpenLocationCode } from 'open-location-code';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const openLocationCode = new OpenLocationCode();

export interface LocationSearchResult {
    lat: number;
    lng: number;
    displayName: string | null;
}

interface Coordinate {
    lat: number;
    lng: number;
}

// Request location permission using Capacitor
export async function requestLocationPermission(): Promise<boolean> {
    try {
        const status = await Geolocation.checkPermissions();

        if (status.location === 'granted' || status.coarseLocation === 'granted') {
            return true;
        }

        if (status.location === 'prompt' || status.location === 'prompt-with-rationale') {
            const result = await Geolocation.requestPermissions({ permissions: ['location'] });
            return result.location === 'granted' || result.coarseLocation === 'granted';
        }

        return false;
    } catch (e) {
        console.error('Location permission check failed:', e);
        return false;
    }
}

// Reverse geocode: lat/lng -> address
export async function reverseGeocode(
    lat: number,
    lng: number
): Promise<string | null> {
    try {
        const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=th`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'TimestampApp/1.0',
            },
        });

        if (!res.ok) return null;

        const data = await res.json();
        return data.display_name || null;
    } catch (e) {
        console.error('Reverse geocode failed:', e);
        return null;
    }
}

// Forward geocode: search query -> lat/lng
export async function forwardGeocode(
    query: string
): Promise<{ lat: number; lng: number; displayName: string } | null> {
    try {
        const url = `${NOMINATIM_BASE}/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=1&accept-language=th`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'TimestampApp/1.0',
            },
        });

        if (!res.ok) return null;

        const data = await res.json();
        if (data.length === 0) return null;

        return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon),
            displayName: data[0].display_name,
        };
    } catch (e) {
        console.error('Forward geocode failed:', e);
        return null;
    }
}

export async function resolveLocationQuery(
    query: string,
    reference?: Coordinate | null
): Promise<LocationSearchResult | null> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return null;

    const decimalCoordinates = parseDecimalCoordinates(normalizedQuery);
    if (decimalCoordinates) {
        return withAddress(decimalCoordinates);
    }

    const dmsCoordinates = parseDMSCoordinates(normalizedQuery);
    if (dmsCoordinates) {
        return withAddress(dmsCoordinates);
    }

    const plusCodeResult = await resolvePlusCode(normalizedQuery, reference);
    if (plusCodeResult) {
        return plusCodeResult;
    }

    const geocoded = await forwardGeocode(normalizedQuery);
    return geocoded
        ? { lat: geocoded.lat, lng: geocoded.lng, displayName: geocoded.displayName }
        : null;
}

async function withAddress(coordinate: Coordinate): Promise<LocationSearchResult> {
    const displayName = await reverseGeocode(coordinate.lat, coordinate.lng);
    return { ...coordinate, displayName };
}

function parseDecimalCoordinates(query: string): Coordinate | null {
    const match = query.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)\s*$/);
    if (!match) return null;

    const lat = Number(match[1]);
    const lng = Number(match[2]);
    return isValidCoordinate(lat, lng) ? { lat, lng } : null;
}

function parseDMSCoordinates(query: string): Coordinate | null {
    const pattern = /([+-]?\d+(?:\.\d+)?)\s*(?:°|d|deg)?\s*(?:(\d+(?:\.\d+)?)\s*(?:'|′|m|min)?)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|s|sec)?)?\s*([NSEW])/gi;
    const matches = [...query.matchAll(pattern)];
    if (matches.length < 2) return null;

    let lat: number | null = null;
    let lng: number | null = null;

    for (const match of matches) {
        const value = dmsToDecimal(
            Number(match[1]),
            match[2] ? Number(match[2]) : 0,
            match[3] ? Number(match[3]) : 0,
            match[4].toUpperCase()
        );

        if (/[NS]/i.test(match[4])) {
            lat = value;
        } else {
            lng = value;
        }
    }

    return lat !== null && lng !== null && isValidCoordinate(lat, lng) ? { lat, lng } : null;
}

function dmsToDecimal(degrees: number, minutes: number, seconds: number, direction: string): number {
    const absolute = Math.abs(degrees) + minutes / 60 + seconds / 3600;
    const sign = direction === 'S' || direction === 'W' || degrees < 0 ? -1 : 1;
    return absolute * sign;
}

async function resolvePlusCode(
    query: string,
    reference?: Coordinate | null
): Promise<LocationSearchResult | null> {
    const plusCode = extractPlusCode(query);
    if (!plusCode || !openLocationCode.isValid(plusCode)) return null;

    try {
        if (openLocationCode.isFull(plusCode)) {
            return withAddress(decodePlusCode(plusCode));
        }

        if (!openLocationCode.isShort(plusCode)) return null;

        const placeText = query.replace(plusCode, '').trim();
        let referencePoint = reference ?? null;

        if (!referencePoint && placeText) {
            const geocodedReference = await forwardGeocode(placeText);
            if (geocodedReference) {
                referencePoint = {
                    lat: geocodedReference.lat,
                    lng: geocodedReference.lng,
                };
            }
        }

        if (!referencePoint) {
            const fallback = await forwardGeocode(query);
            return fallback
                ? { lat: fallback.lat, lng: fallback.lng, displayName: fallback.displayName }
                : null;
        }

        const fullCode = openLocationCode.recoverNearest(
            plusCode,
            referencePoint.lat,
            referencePoint.lng
        );
        return withAddress(decodePlusCode(fullCode));
    } catch (e) {
        console.error('Plus code resolve failed:', e);
        return null;
    }
}

function decodePlusCode(code: string): Coordinate {
    const area = openLocationCode.decode(code);
    return {
        lat: area.latitudeCenter,
        lng: area.longitudeCenter,
    };
}

function extractPlusCode(query: string): string | null {
    const match = query.toUpperCase().match(/\b[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,8}\b/);
    return match?.[0] ?? null;
}

function isValidCoordinate(lat: number, lng: number): boolean {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Get current GPS position using Capacitor Geolocation
export async function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
    // Request permission first
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
        throw new Error('Location permission denied');
    }

    try {
        const position = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 15000,
        });

        return {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
        };
    } catch (e) {
        console.error('Get position failed:', e);
        throw e;
    }
}
