import Dexie, { type EntityTable } from 'dexie';
import type { PhotoRecord, TrashRecord } from '../types';

// Retained for browser builds and non-destructive migration of existing Android libraries.
const db = new Dexie('timestamp-photos') as Dexie & {
    photos: EntityTable<PhotoRecord, 'id'>;
    trash: EntityTable<TrashRecord, 'id'>;
    metadata: EntityTable<{ key: string; ids: string[] }, 'key'>;
};

db.version(1).stores({
    photos: 'id, createdAtISO',
});

db.version(2).stores({
    photos: 'id, createdAtISO',
    trash: 'id, deletedAtISO',
});
db.version(3).stores({
    photos: 'id, createdAtISO',
    trash: 'id, deletedAtISO',
    metadata: 'key',
});

export { db };

// Helper functions
export async function getAllPhotos(): Promise<PhotoRecord[]> {
    const photos = await db.photos.orderBy('createdAtISO').toArray();
    const saved = await db.metadata.get('photo-order');
    if (!saved) return photos;
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const ordered: PhotoRecord[] = [];
    for (const id of saved.ids) {
        const photo = byId.get(id);
        if (photo) { ordered.push(photo); byId.delete(id); }
    }
    return [...ordered, ...byId.values()];
}

export async function addPhoto(photo: PhotoRecord): Promise<void> {
    await db.photos.add(photo);
}

export async function updatePhoto(id: string, updates: Partial<PhotoRecord>): Promise<void> {
    await db.photos.update(id, updates);
}

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
    return db.photos.get(id);
}

export async function getAllTrash(): Promise<TrashRecord[]> {
    return db.trash.orderBy('deletedAtISO').reverse().toArray();
}

export async function movePhotoToTrash(id: string): Promise<TrashRecord | undefined> {
    return db.transaction('rw', db.photos, db.trash, db.metadata, async () => {
        const photo = await db.photos.get(id);
        if (!photo) return undefined;
        const trashed: TrashRecord = { ...photo, deletedAtISO: new Date().toISOString() };
        await db.trash.put(trashed);
        await db.photos.delete(id);
        const saved = await db.metadata.get('photo-order');
        if (saved) await db.metadata.put({ ...saved, ids: saved.ids.filter((item) => item !== id) });
        return trashed;
    });
}

export async function moveAllPhotosToTrash(): Promise<TrashRecord[]> {
    return db.transaction('rw', db.photos, db.trash, db.metadata, async () => {
        const deletedAtISO = new Date().toISOString();
        const photos = await db.photos.toArray();
        const trashed = photos.map((photo) => ({ ...photo, deletedAtISO }));
        if (trashed.length) await db.trash.bulkPut(trashed);
        await db.photos.clear();
        await db.metadata.put({ key: 'photo-order', ids: [] });
        return trashed;
    });
}

export async function restoreTrashPhotos(ids: string[]): Promise<PhotoRecord[]> {
    return db.transaction('rw', db.photos, db.trash, db.metadata, async () => {
        const current = await getAllPhotos();
        const restored: PhotoRecord[] = [];
        for (const id of ids) {
            const trashed = await db.trash.get(id);
            if (!trashed) continue;
            const { deletedAtISO: _deletedAtISO, ...photo } = trashed;
            await db.photos.put(photo);
            await db.trash.delete(id);
            restored.push(photo);
        }
        await db.metadata.put({ key: 'photo-order', ids: [...current.map((photo) => photo.id), ...restored.map((photo) => photo.id)] });
        return restored;
    });
}

export async function permanentlyDeleteTrashPhotos(ids: string[]): Promise<void> {
    await db.trash.bulkDelete(ids);
}

export async function clearTrash(): Promise<void> {
    await db.trash.clear();
}

export async function reorderPhotos(ids: string[]): Promise<void> {
    await db.transaction('rw', db.photos, db.metadata, async () => {
        const current = await getAllPhotos();
        const available = new Set(current.map((photo) => photo.id));
        if (new Set(ids).size !== ids.length || ids.some((id) => !available.has(id))) throw new Error('Invalid photo order');
        const selected = new Set(ids);
        await db.metadata.put({ key: 'photo-order', ids: [...ids, ...current.filter((photo) => !selected.has(photo.id)).map((photo) => photo.id)] });
    });
}
