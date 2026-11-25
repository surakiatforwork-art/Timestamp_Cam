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
): Promise<{ confirmed: boolean }> {
    const blob = await renderPhotoToBlob(photo, settings, format, quality);
    const filename = generateFilename(index, format);

    if (Capacitor.isNativePlatform()) {
        await saveToNative(blob, filename);
        return {confirmed:true};
    } else {
        downloadBlob(blob, filename);
        // Browser anchor downloads cannot confirm that the file reached disk.
        return {confirmed:false};
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
): Promise<{ method: string; success: boolean; confirmedIds: string[] }> {
    const total = photos.length;
    if (total === 0) return { method: 'none', success: false, confirmedIds: [] };

    const confirmedIds: string[] = [];
    const batchTime=new Date();
    // Never return while a worker can still be writing to MediaStore.
    if (Capacitor.isNativePlatform()) {
        let nextIndex = 0, completed = 0;
        const worker = async () => {
            while (nextIndex < total) {
                const index = nextIndex++;
                try {
                    const blob = await renderPhotoToBlob(photos[index], settings, format, quality);
                    await saveToNative(blob, generateFilename(index, format, batchTime));
                    confirmedIds.push(photos[index].id);
                } catch (e) { console.error('Native save failed:',e); }
                finally { onProgress(++completed,total); }
            }
        };
        await Promise.all(Array.from({length:Math.min(2,total)},worker));
        return {method:'native-filesystem',success:confirmedIds.length===total,confirmedIds};
    }

    // Tier 2: File System Access API
    if ('showDirectoryPicker' in window) {
        try {
            const dirHandle = await (window as any).showDirectoryPicker({
                mode: 'readwrite',
            });

            for (let i = 0; i < total; i++) {
                const blob = await renderPhotoToBlob(photos[i], settings, format, quality);
                const filename = generateFilename(i, format,batchTime);
                const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                confirmedIds.push(photos[i].id);
                onProgress(i + 1, total);
            }

            return { method: 'filesystem', success: true, confirmedIds };
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                return { method: 'filesystem', success: false, confirmedIds };
            }
            if (confirmedIds.length) return {method:'filesystem',success:false,confirmedIds};
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
            const filename = generateFilename(i, format,batchTime);
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

        return { method: 'zip', success: true, confirmedIds };
    } catch (e) {
        console.log('JSZip failed, trying sequential:', e);
        // Fall through to Tier 4
    }

    // Tier 4: Sequential downloads
    for (let i = 0; i < total; i++) {
        const blob = await renderPhotoToBlob(photos[i], settings, format, quality);
        const filename = generateFilename(i, format,batchTime);
        downloadBlob(blob, filename);
        await delay(400);
        onProgress(i + 1, total);
    }

    return { method: 'sequential', success: true, confirmedIds };
}
