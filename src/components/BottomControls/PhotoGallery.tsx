import { useEffect, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../../context/AppContext';
import type { Photo } from '../../types';

const horizontalOnly: Modifier = ({ transform }) => ({ ...transform, y: 0 });
const dragModifiers = [horizontalOnly];

function GalleryCard({ photo, index, disabled, onPreview, count, pressed }: {
    photo: Photo; index: number; disabled: boolean; onPreview: () => void; count?: number; pressed?: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: photo.id, disabled,
    });
    return (
        <button type="button" ref={setNodeRef} className={`thumbnail sortable-thumbnail ${isDragging ? 'is-dragging' : ''}`}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            {...attributes} {...listeners}
            aria-disabled={undefined}
            aria-label={count ? `เปิดกลุ่ม ${count} รูป` : `เปิดรูปที่ ${index + 1}`}
            aria-pressed={pressed}
            onContextMenu={(event) => event.preventDefault()}
            onClick={onPreview}>
            <img src={photo.thumbUrl} alt={`รูปที่ ${index + 1}`} draggable={false} />
            <span className="thumbnail-badge">{count ? `${count} รูป` : index + 1}</span>
        </button>
    );
}

export default function PhotoGallery() {
    const { state, openPreview, reorderPhotos, showToast } = useApp();
    const [saving, setSaving] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [draftIds, setDraftIds] = useState<string[] | null>(null);
    const [groups, setGroups] = useState<string[][]>(() => {
        try { return JSON.parse(localStorage.getItem('timestamp-photo-groups') ?? '[]'); }
        catch { return []; }
    });
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [expanded, setExpanded] = useState<string | null>(null);
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
    const blocks = photos.flatMap((photo) => {
        const group = groups.find((members) => members.includes(photo.id));
        const members = group ? photos.filter((candidate) => group.includes(candidate.id)) : [photo];
        return members[0]?.id === photo.id ? [members] : [];
    });
    const ids = blocks.map(([photo]) => photo.id);
    const activePhoto = photos.find((photo) => photo.id === activeId);
    const openGroup = blocks.find(([photo]) => photo.id === expanded);

    function saveGroups(next: string[][]) {
        try {
            localStorage.setItem('timestamp-photo-groups', JSON.stringify(next));
            setGroups(next);
        } catch { showToast('บันทึกกลุ่มไม่สำเร็จ', 'error'); }
    }

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
        const ordered = arrayMove(blocks, from, to).flatMap((block) => block.map((photo) => photo.id));
        setDraftIds(ordered);
        setSaving(true);
        try { await reorderPhotos(ordered); }
        catch { showToast('บันทึกลำดับไม่สำเร็จ กรุณาลองอีกครั้ง', 'error'); }
        finally { setDraftIds(null); setSaving(false); }
    };

    return (
        <div className="photo-gallery">
            <div className="gallery-group-actions">
                <button type="button" className="btn btn-secondary" disabled={saving || photos.length < 2}
                    onClick={() => { setSelecting(!selecting); setSelected([]); setExpanded(null); }}>
                    {selecting ? 'ยกเลิก' : 'จัดกลุ่มรูป'}
                </button>
                {selecting && <button type="button" className="btn btn-primary" disabled={selected.length < 2}
                    onClick={() => {
                        saveGroups([...groups, selected]);
                        setSelecting(false);
                        setExpanded(photos.find((photo) => selected.includes(photo.id))?.id ?? null);
                        setSelected([]);
                    }}>รวม {selected.length} รูป</button>}
                {openGroup && openGroup.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => {
                    saveGroups(groups.filter((group) => !group.includes(openGroup[0].id)));
                    setExpanded(null);
                }}>แยกกลุ่ม</button>}
            </div>
            {openGroup && openGroup.length > 1 && <div className="gallery-strip" aria-label="รูปในกลุ่ม">
                {openGroup.map((photo, index) => <button type="button" className="thumbnail" key={photo.id}
                    aria-label={`เปิดรูปในกลุ่มที่ ${index + 1}`} onClick={() => openPreview(photo.id)}>
                    <img src={photo.thumbUrl} alt="" />
                </button>)}
            </div>}
            <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll modifiers={dragModifiers}
                onDragStart={({ active }) => { suppressClickUntil.current = Infinity; setActiveId(String(active.id)); }}
                onDragCancel={() => { setActiveId(null); suppressClickUntil.current = Date.now() + 250; }} onDragEnd={finishDrag}>
                <div className={`gallery-strip ${activeId ? 'is-sorting' : ''}`} ref={galleryRef} aria-busy={saving}>
                    <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
                        {blocks.map(([photo, ...rest], index) => <GalleryCard key={photo.id} photo={photo} index={index}
                            count={rest.length ? rest.length + 1 : undefined}
                            pressed={selecting ? selected.includes(photo.id) : rest.length ? expanded === photo.id : undefined}
                            disabled={selecting || saving || blocks.length < 2} onPreview={() => {
                                if (Date.now() < suppressClickUntil.current) return;
                                if (selecting) {
                                    if (!groups.some((group) => group.includes(photo.id))) {
                                        setSelected((prev) => prev.includes(photo.id) ? prev.filter((id) => id !== photo.id) : [...prev, photo.id]);
                                    }
                                } else if (rest.length) setExpanded(expanded === photo.id ? null : photo.id);
                                else openPreview(photo.id);
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
