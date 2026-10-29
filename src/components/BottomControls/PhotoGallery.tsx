import { useEffect, useRef, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeftRight, Check, GripVertical } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { Photo } from '../../types';

function GalleryCard({ photo, index, sorting, disabled, onPreview }: {
    photo: Photo; index: number; sorting: boolean; disabled: boolean; onPreview: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: photo.id, disabled: !sorting || disabled,
    });
    return (
        <button type="button" ref={setNodeRef} className={`thumbnail ${sorting ? 'sortable-thumbnail' : ''} ${isDragging ? 'is-dragging' : ''}`}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            {...(sorting ? attributes : {})} {...(sorting ? listeners : {})}
            aria-label={sorting ? `จัดลำดับรูปที่ ${index + 1}` : `เปิดรูปที่ ${index + 1}`}
            onClick={() => { if (!sorting) onPreview(); }}>
            <img src={photo.thumbUrl} alt={`รูปที่ ${index + 1}`} draggable={false} />
            <span className="thumbnail-badge">{index + 1}</span>
            {sorting && <span className="thumbnail-grip"><GripVertical size={16} aria-hidden="true" /></span>}
        </button>
    );
}

export default function PhotoGallery() {
    const { state, openPreview, reorderPhotos, showToast } = useApp();
    const [sorting, setSorting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [draftIds, setDraftIds] = useState<string[] | null>(null);
    const galleryRef = useRef<HTMLDivElement>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
    const photos: Photo[] = [];
    for (const id of draftIds ?? []) {
        const photo = byId.get(id);
        if (photo) { photos.push(photo); byId.delete(id); }
    }
    photos.push(...byId.values());
    const ids = photos.map((photo) => photo.id);

    useEffect(() => {
        if (!sorting && galleryRef.current) galleryRef.current.scrollLeft = galleryRef.current.scrollWidth;
    }, [state.photos.length, sorting]);

    const finishDrag = async ({ active, over }: DragEndEvent) => {
        setDragging(false);
        if (!over || active.id === over.id || saving) return;
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        const ordered = arrayMove(ids, from, to);
        setDraftIds(ordered);
        setSaving(true);
        try { await reorderPhotos(ordered); }
        catch { showToast('บันทึกลำดับไม่สำเร็จ กรุณาลองอีกครั้ง', 'error'); }
        finally { setDraftIds(null); setSaving(false); }
    };

    return (
        <div className="photo-gallery">
            <div className="gallery-toolbar">
                <span>{state.photos.length} รูป</span>
                <button className={`gallery-sort-btn ${sorting ? 'active' : ''}`} type="button"
                    disabled={saving || dragging || (!sorting && photos.length < 2)}
                    aria-pressed={sorting} title={sorting ? 'เสร็จสิ้นการจัดเรียง' : 'จัดเรียงรูป'}
                    onClick={() => setSorting((current) => !current)}>
                    {sorting ? <Check size={16} aria-hidden="true" /> : <ArrowLeftRight size={16} aria-hidden="true" />}
                    {saving ? 'กำลังบันทึก' : sorting ? 'เสร็จสิ้น' : 'จัดเรียง'}
                </button>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll
                onDragStart={() => setDragging(true)} onDragCancel={() => setDragging(false)} onDragEnd={finishDrag}>
                <div className={`gallery-strip ${sorting ? 'sorting' : ''}`} ref={galleryRef}>
                    <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
                        {photos.map((photo, index) => <GalleryCard key={photo.id} photo={photo} index={index}
                            sorting={sorting} disabled={saving} onPreview={() => openPreview(photo.id)} />)}
                    </SortableContext>
                </div>
            </DndContext>
        </div>
    );
}
