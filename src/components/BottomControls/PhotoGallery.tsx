import { useEffect, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../../context/AppContext';
import type { Photo } from '../../types';

const horizontalOnly: Modifier = ({ transform }) => ({ ...transform, y: 0 });
const dragModifiers = [horizontalOnly];

function GalleryCard({ photo, index, disabled, onPreview }: {
    photo: Photo; index: number; disabled: boolean; onPreview: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: photo.id, disabled,
    });
    return (
        <button type="button" ref={setNodeRef} className={`thumbnail sortable-thumbnail ${isDragging ? 'is-dragging' : ''}`}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            {...attributes} {...listeners}
            aria-disabled={undefined}
            aria-label={`เปิดรูปที่ ${index + 1}`}
            onContextMenu={(event) => event.preventDefault()}
            onClick={onPreview}>
            <img src={photo.thumbUrl} alt={`รูปที่ ${index + 1}`} draggable={false} />
            <span className="thumbnail-badge">{index + 1}</span>
        </button>
    );
}

export default function PhotoGallery() {
    const { state, openPreview, reorderPhotos, showToast } = useApp();
    const [saving, setSaving] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [draftIds, setDraftIds] = useState<string[] | null>(null);
    const galleryRef = useRef<HTMLDivElement>(null);
    const suppressClickUntil = useRef(0);
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
        // TouchSensor lets quick swipes scroll natively before activation, then
        // prevents scrolling only after the long press has actually started a drag.
        useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
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
    const activePhoto = photos.find((photo) => photo.id === activeId);

    useEffect(() => {
        if (galleryRef.current) galleryRef.current.scrollLeft = galleryRef.current.scrollWidth;
    }, [state.photos.length]);

    const finishDrag = async ({ active, over }: DragEndEvent) => {
        setActiveId(null);
        suppressClickUntil.current = Date.now() + 250;
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
            <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll modifiers={dragModifiers}
                onDragStart={({ active }) => { suppressClickUntil.current = Infinity; setActiveId(String(active.id)); }}
                onDragCancel={() => { setActiveId(null); suppressClickUntil.current = Date.now() + 250; }} onDragEnd={finishDrag}>
                <div className={`gallery-strip ${activeId ? 'is-sorting' : ''}`} ref={galleryRef} aria-busy={saving}>
                    <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
                        {photos.map((photo, index) => <GalleryCard key={photo.id} photo={photo} index={index}
                            disabled={saving || photos.length < 2} onPreview={() => {
                                if (Date.now() >= suppressClickUntil.current) openPreview(photo.id);
                            }} />)}
                    </SortableContext>
                </div>
                <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
                    {activePhoto && <div className="thumbnail drag-overlay" aria-hidden="true">
                        <img src={activePhoto.thumbUrl} alt="" draggable={false} />
                        <span className="thumbnail-badge">{ids.indexOf(activePhoto.id) + 1}</span>
                    </div>}
                </DragOverlay>
            </DndContext>
        </div>
    );
}
