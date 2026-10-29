import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PhotoRecord, TrashRecord } from '../types';
import * as legacy from './legacyDb';

type StoredMetadata = Omit<PhotoRecord, 'baseBlob'> & { deletedAtISO?: string };
interface StorageResult {
    migrated?: boolean;
    activeMigrated?: boolean;
    ids?: string[];
    record?: StoredMetadata;
    image?: string;
    mime?: string;
}
interface PhotoStoragePlugin {
    execute(options: {
        operation: string;
        id?: string;
        ids?: string[];
        record?: StoredMetadata;
        image?: string;
        mime?: string;
        updates?: Partial<StoredMetadata>;
        trash?: boolean;
        deletedAtISO?: string;
    }): Promise<StorageResult>;
}

const storage = registerPlugin<PhotoStoragePlugin>('PhotoStorage');
const isAndroid = Capacitor.getPlatform() === 'android';
let initialization: Promise<void> | undefined;
let trashInitialization: Promise<void> | undefined;
export type LoadProgress = (current: number, total: number, phase?: 'migration' | 'loading') => void;

function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Cannot read image'));
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(blob);
    });
}

async function writePhoto(operation: 'add' | 'import', photo: PhotoRecord | TrashRecord) {
    const { baseBlob, ...record } = photo;
    await storage.execute({ operation, record, image: await toBase64(baseBlob), mime: baseBlob.type || 'image/jpeg' });
}

export function initializePhotoStorage(): Promise<void> {
    if (!initialization) {
        initialization = (async () => {
            if (!isAndroid) {
                await navigator.storage?.persist?.().catch(() => false);
                return;
            }
            const { activeMigrated } = await storage.execute({ operation: 'status' });
            if (activeMigrated) return;
            // Copy one image at a time, keeping IndexedDB intact. Interrupted imports
            // are retried without overwriting or duplicating previously imported IDs.
            for (const table of [legacy.db.photos]) {
                const ids = await table.toCollection().primaryKeys();
                for (const id of ids) {
                    const record = await table.get(id);
                    if (record) await writePhoto('import', record);
                }
            }
            await storage.execute({ operation: 'finishActiveMigration' });
        })().catch((error) => {
            initialization = undefined;
            throw error;
        });
    }
    return initialization;
}

async function initializeTrashStorage(onProgress?: LoadProgress): Promise<void> {
    await initializePhotoStorage();
    if (!isAndroid) return;
    if (!trashInitialization) {
        trashInitialization = (async () => {
            const { migrated } = await storage.execute({ operation: 'status' });
            if (migrated) { legacy.db.close(); return; }
            const ids = await legacy.db.trash.toCollection().primaryKeys();
            onProgress?.(0, ids.length, 'migration');
            for (let index = 0; index < ids.length; index++) {
                const record = await legacy.db.trash.get(ids[index]);
                if (record) await writePhoto('import', record);
                onProgress?.(index + 1, ids.length, 'migration');
            }
            await storage.execute({ operation: 'finishMigration' });
            legacy.db.close();
        })().catch((error) => { trashInitialization = undefined; throw error; });
    }
    await trashInitialization;
}

async function readPhoto(id: string): Promise<PhotoRecord | TrashRecord | undefined> {
    const result = await storage.execute({ operation: 'read', id });
    if (!result.record) return undefined;
    if (!result.image) throw new Error(`Missing image data: ${id}`);
    const binary = atob(result.image);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return { ...result.record, baseBlob: new Blob([bytes], { type: result.mime }) };
}

async function readPhotos(ids: string[], onProgress?: LoadProgress, signal?: AbortSignal): Promise<Array<PhotoRecord | TrashRecord>> {
    const photos: Array<PhotoRecord | TrashRecord> = [];
    onProgress?.(0, ids.length);
    for (const id of ids) {
        signal?.throwIfAborted();
        const photo = await readPhoto(id);
        if (!photo) throw new Error(`Photo disappeared while loading: ${id}`);
        photos.push(photo);
        onProgress?.(photos.length, ids.length);
        // Give capture, gestures and progress rendering a turn between originals.
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return photos;
}

export async function getAllPhotos(signal?: AbortSignal): Promise<PhotoRecord[]> {
    await initializePhotoStorage();
    if (!isAndroid) return legacy.getAllPhotos();
    const { ids = [] } = await storage.execute({ operation: 'list' });
    return readPhotos(ids, undefined, signal);
}

export async function getAllTrash(onProgress?: LoadProgress, signal?: AbortSignal): Promise<TrashRecord[]> {
    await initializeTrashStorage(onProgress);
    signal?.throwIfAborted();
    if (!isAndroid) {
        const ids = await legacy.db.trash.orderBy('deletedAtISO').reverse().primaryKeys();
        const records: TrashRecord[] = [];
        onProgress?.(0, ids.length);
        for (const id of ids) {
            signal?.throwIfAborted();
            const record = await legacy.db.trash.get(id);
            if (!record) throw new Error(`Trash photo not found: ${id}`);
            records.push(record);
            onProgress?.(records.length, ids.length);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return records;
    }
    const { ids = [] } = await storage.execute({ operation: 'list', trash: true });
    return await readPhotos(ids, onProgress, signal) as TrashRecord[];
}

export async function addPhoto(photo: PhotoRecord): Promise<void> {
    await initializePhotoStorage();
    if (!isAndroid) return legacy.addPhoto(photo);
    await writePhoto('add', photo);
}

export async function updatePhoto(id: string, updates: Partial<PhotoRecord>): Promise<void> {
    await initializePhotoStorage();
    if (!isAndroid) return legacy.updatePhoto(id, updates);
    if (updates.baseBlob !== undefined) throw new Error('Replacing original image bytes is not supported');
    await storage.execute({ operation: 'update', id, updates });
}

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
    await initializePhotoStorage();
    if (!isAndroid) return legacy.getPhoto(id);
    const photo = await readPhoto(id);
    return photo && !('deletedAtISO' in photo) ? photo : undefined;
}

export async function movePhotoToTrash(id: string): Promise<TrashRecord | undefined> {
    await initializePhotoStorage();
    if (!isAndroid) return legacy.movePhotoToTrash(id);
    if (!await getPhoto(id)) return undefined;
    await storage.execute({ operation: 'trash', ids: [id], deletedAtISO: new Date().toISOString() });
    return await readPhoto(id) as TrashRecord;
}

export async function moveAllPhotosToTrash(): Promise<TrashRecord[]> {
    await initializePhotoStorage();
    if (!isAndroid) return legacy.moveAllPhotosToTrash();
    const { ids = [] } = await storage.execute({ operation: 'list' });
    await storage.execute({ operation: 'trash', ids, deletedAtISO: new Date().toISOString() });
    return await readPhotos(ids) as TrashRecord[];
}

export async function restoreTrashPhotos(ids: string[]): Promise<PhotoRecord[]> {
    await initializeTrashStorage();
    if (!isAndroid) return legacy.restoreTrashPhotos(ids);
    const { ids: available = [] } = await storage.execute({ operation: 'list', trash: true });
    const selected = ids.filter((id) => available.includes(id));
    await storage.execute({ operation: 'restore', ids: selected });
    return readPhotos(selected);
}

export async function permanentlyDeleteTrashPhotos(ids: string[]): Promise<void> {
    await initializeTrashStorage();
    if (!isAndroid) return legacy.permanentlyDeleteTrashPhotos(ids);
    await storage.execute({ operation: 'deleteTrash', ids });
}

export async function clearTrash(): Promise<void> {
    await initializeTrashStorage();
    if (!isAndroid) return legacy.clearTrash();
    const { ids = [] } = await storage.execute({ operation: 'list', trash: true });
    await storage.execute({ operation: 'deleteTrash', ids });
}

export async function reorderPhotos(ids: string[]): Promise<void> {
    await initializePhotoStorage();
    if (!isAndroid) return legacy.reorderPhotos(ids);
    await storage.execute({ operation: 'reorder', ids });
}
