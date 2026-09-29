import Dexie, { type EntityTable } from 'dexie';
import type { PhotoRecord, TrashRecord } from '../types';

// Define database
const db = new Dexie('timestamp-photos') as Dexie & {
    photos: EntityTable<PhotoRecord, 'id'>;
    trash: EntityTable<TrashRecord, 'id'>;
};

db.version(1).stores({
    photos: 'id, createdAtISO',
});

db.version(2).stores({
    photos: 'id, createdAtISO',
    trash: 'id, deletedAtISO',
});

export { db };

// Helper functions
export async function getAllPhotos(): Promise<PhotoRecord[]> {
    return db.photos.orderBy('createdAtISO').toArray();
}

export async function addPhoto(photo: PhotoRecord): Promise<void> {
    await db.photos.add(photo);
}

export async function updatePhoto(id: string, updates: Partial<PhotoRecord>): Promise<void> {
    await db.photos.update(id, updates);
}

export async function deletePhoto(id: string): Promise<void> {
    await db.photos.delete(id);
}

export async function deleteAllPhotos(): Promise<void> {
    await db.photos.clear();
}

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
    return db.photos.get(id);
}

export async function getAllTrash(): Promise<TrashRecord[]> {
    return db.trash.orderBy('deletedAtISO').reverse().toArray();
}

export async function movePhotoToTrash(id: string): Promise<TrashRecord | undefined> {
    return db.transaction('rw', db.photos, db.trash, async () => {
        const photo = await db.photos.get(id);
        if (!photo) return undefined;
        const trashed: TrashRecord = { ...photo, deletedAtISO: new Date().toISOString() };
        await db.trash.put(trashed);
        await db.photos.delete(id);
        return trashed;
    });
}

export async function moveAllPhotosToTrash(): Promise<TrashRecord[]> {
    return db.transaction('rw', db.photos, db.trash, async () => {
        const deletedAtISO = new Date().toISOString();
        const photos = await db.photos.toArray();
        const trashed = photos.map((photo) => ({ ...photo, deletedAtISO }));
        if (trashed.length) await db.trash.bulkPut(trashed);
        await db.photos.clear();
        return trashed;
    });
}

export async function restoreTrashPhotos(ids: string[]): Promise<PhotoRecord[]> {
    return db.transaction('rw', db.photos, db.trash, async () => {
        const restored: PhotoRecord[] = [];
        for (const id of ids) {
            const trashed = await db.trash.get(id);
            if (!trashed) continue;
            const { deletedAtISO: _deletedAtISO, ...photo } = trashed;
            await db.photos.put(photo);
            await db.trash.delete(id);
            restored.push(photo);
        }
        return restored;
    });
}

export async function permanentlyDeleteTrashPhotos(ids: string[]): Promise<void> {
    await db.trash.bulkDelete(ids);
}

export async function clearTrash(): Promise<void> {
    await db.trash.clear();
}

export async function purgeExpiredTrash(now = Date.now()): Promise<string[]> {
    const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const expired = await db.trash.where('deletedAtISO').below(cutoff).primaryKeys();
    const ids = expired.map(String);
    if (ids.length) await db.trash.bulkDelete(ids);
    return ids;
}
