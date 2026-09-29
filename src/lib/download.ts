import type { Photo, Settings } from '../types';
import { renderPhotoToBlob } from './canvas';
import { generateFilename } from './format';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface MediaStorePlugin {
    saveImage(options: { data: string; displayName: string; mimeType: string }): Promise<{ uri: string }>;
}

const MediaStore = registerPlugin<MediaStorePlugin>('MediaStore');

// Write to native filesystem
async function saveToNative(blob: Blob, filename: string): Promise<string> {
    try {
        const base64 = await blobToBase64(blob);
        const mimeType = blob.type || (filename.endsWith('.png') ? 'image/png' : 'image/jpeg');
        const result = await MediaStore.saveImage({ data: base64, displayName: filename, mimeType });
        return result.uri;
    } catch (e) {
        throw new Error(`Native save failed: ${e}`);
    }
}

// Convert blob to base64
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            // Remove data:image/jpeg;base64, prefix
            resolve(base64.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Download single blob (Web only)
function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Delay helper
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Download one photo
export async function downloadOne(
    photo: Photo,
    settings: Settings,
    format: 'jpeg' | 'png',
    quality: number,
    index: number
): Promise<void> {
    const blob = await renderPhotoToBlob(photo, settings, format, quality);
    const filename = generateFilename(index, format);

    if (Capacitor.isNativePlatform()) {
        await saveToNative(blob, filename);
    } else {
        downloadBlob(blob, filename);
    }
}

// Download all photos with 4-tier fallback
// Tier 1: Capacitor Filesystem (Native)
// Tier 2: File System Access API (Desktop Chrome)
// Tier 3: JSZip
// Tier 4: Sequential downloads
export async function downloadAll(
    photos: Photo[],
    settings: Settings,
    format: 'jpeg' | 'png',
    quality: number,
    onProgress: (current: number, total: number) => void
): Promise<{ method: string; success: boolean }> {
    const total = photos.length;
    if (total === 0) return { method: 'none', success: false };

    // Tier 1: Capacitor Filesystem (Native)
    if (Capacitor.isNativePlatform()) {
        try {
            let nextIndex = 0;
            let completed = 0;
            const worker = async () => {
                while (nextIndex < total) {
                    const index = nextIndex++;
                    const blob = await renderPhotoToBlob(photos[index], settings, format, quality);
                    await saveToNative(blob, generateFilename(index, format));
                    completed++;
                    onProgress(completed, total);
                }
            };
            // Two jobs reduces total wait while keeping large canvas buffers bounded on mobile.
            await Promise.all(Array.from({ length: Math.min(2, total) }, worker));
            return { method: 'native-filesystem', success: true };
        } catch (e) {
            console.error('Native save failed:', e);
            // Fallback to other methods if needed, but native usually expects execution to stop or alert
            // But we can try zip if that fails? No, if native fails, web download also fails usually.
            // Let's try to return false.
            return { method: 'native-filesystem', success: false };
        }
    }

    // Tier 2: File System Access API
    if ('showDirectoryPicker' in window) {
        try {
            const dirHandle = await (window as any).showDirectoryPicker({
                mode: 'readwrite',
            });

            for (let i = 0; i < total; i++) {
                const blob = await renderPhotoToBlob(photos[i], settings, format, quality);
                const filename = generateFilename(i, format);
                const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                onProgress(i + 1, total);
            }

            return { method: 'filesystem', success: true };
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                return { method: 'filesystem', success: false };
            }
            console.log('File System API failed, trying ZIP:', e);
            // Fall through to Tier 3
        }
    }

    // Tier 3: JSZip
    try {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();

        for (let i = 0; i < total; i++) {
            const blob = await renderPhotoToBlob(photos[i], settings, format, quality);
            const filename = generateFilename(i, format);
            zip.file(filename, blob);
            onProgress(i + 1, total);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const now = new Date();
        const y = now.getFullYear();
        const mo = (now.getMonth() + 1).toString().padStart(2, '0');
        const d = now.getDate().toString().padStart(2, '0');
        const zipName = `Timestamp_${y}${mo}${d}.zip`;

        if (Capacitor.isNativePlatform()) {
            await saveToNative(zipBlob, zipName);
        } else {
            downloadBlob(zipBlob, zipName);
        }

        return { method: 'zip', success: true };
    } catch (e) {
        console.log('JSZip failed, trying sequential:', e);
        // Fall through to Tier 4
    }

    // Tier 4: Sequential downloads
    for (let i = 0; i < total; i++) {
        const blob = await renderPhotoToBlob(photos[i], settings, format, quality);
        const filename = generateFilename(i, format);
        downloadBlob(blob, filename);
        await delay(400);
        onProgress(i + 1, total);
    }

    return { method: 'sequential', success: true };
}
