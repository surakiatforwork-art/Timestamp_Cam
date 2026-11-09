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
            {pressed !== undefined && !count && <span className="selection-check" aria-hidden="true">{pressed ? '✓' : ''}</span>}
        </button>
    );
}

function GroupMember({ photo, index, checked, onHold, onTap }: {
    photo: Photo; index: number; checked?: boolean; onHold: () => void; onTap: () => void;
}) {
    const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
    const start = useRef({ x: 0, y: 0 });
    const held = useRef(false);
    function cancelHold() {
        if (pending.current !== null) clearTimeout(pending.current);
        pending.current = null;
    }
    useEffect(() => () => {
        if (pending.current !== null) clearTimeout(pending.current);
    }, []);
    return <button type="button" className="thumbnail" aria-label={`เปิดรูปในกลุ่มที่ ${index + 1}`}
        aria-pressed={checked}
        onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            cancelHold();
            held.current = false;
            start.current = { x: event.clientX, y: event.clientY };
            pending.current = setTimeout(() => { held.current = true; onHold(); }, 400);
        }}
        onPointerMove={(event) => {
            if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8) cancelHold();
        }}
        onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                onHold();
            }
        }}
        onClick={() => {
            if (!held.current) onTap();
            held.current = false;
        }}>
        <img src={photo.thumbUrl} alt="" draggable={false} />
        {checked !== undefined && <span className="selection-check" aria-hidden="true">{checked ? '✓' : ''}</span>}
    </button>;
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
    const [mode, setMode] = useState<'group' | 'split' | null>(null);
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
            return true;
        } catch {
            showToast('บันทึกกลุ่มไม่สำเร็จ', 'error');
            return false;
        }
    }

    function leaveSelection() {
        setMode(null);
        setSelected([]);
    }

    function toggleSelection(id: string) {
        setSelected((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
    }

    const groupSelection = blocks.filter((block) => block.length === 1 && selected.includes(block[0].id)).map(([photo]) => photo.id);
    const splitSelection = openGroup?.filter((photo) => selected.includes(photo.id)) ?? [];

    function splitGroup(all: boolean) {
        if (!openGroup || (!all && !splitSelection.length)) return;
        const current = groups.find((group) => group.includes(openGroup[0].id));
        if (!current) return;
        const remaining = all ? [] : openGroup.filter((photo) => !selected.includes(photo.id)).map((photo) => photo.id);
        const next = groups.filter((group) => group !== current);
        if (remaining.length > 1) next.push(remaining);
        if (saveGroups(next)) {
            setExpanded(remaining.length > 1 ? remaining[0] : null);
            leaveSelection();
        }
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
            {mode && <div className="gallery-group-actions" aria-label="คำสั่งเลือกภาพ">
                <button type="button" className="btn btn-secondary" onClick={leaveSelection}>ยกเลิก</button>
                {mode === 'group' && groupSelection.length > 1 && <button type="button" className="btn btn-primary" disabled={saving}
                    onClick={() => {
                        const next = groups.map((group) => group.filter((id) => !groupSelection.includes(id))).filter((group) => group.length > 1);
                        if (saveGroups([...next, groupSelection])) {
                            setExpanded(null);
                            leaveSelection();
                        }
                    }}>จับกลุ่ม {groupSelection.length} รูป</button>}
                {mode === 'split' && splitSelection.length > 0 && <button type="button" className="btn btn-primary"
                    onClick={() => splitGroup(false)}>แยกออกจากกลุ่ม</button>}
                {mode === 'split' && <button type="button" className="btn btn-secondary"
                    onClick={() => splitGroup(true)}>สลายกลุ่ม</button>}
            </div>}
            {openGroup && openGroup.length > 1 && <div className="gallery-strip" aria-label="รูปในกลุ่ม">
                {openGroup.map((photo, index) => <GroupMember key={photo.id} photo={photo} index={index}
                    checked={mode === 'split' ? selected.includes(photo.id) : undefined}
                    onHold={() => {
                        if (mode !== 'split') { setMode('split'); setSelected([]); }
                    }}
                    onTap={() => mode === 'split' ? toggleSelection(photo.id) : openPreview(photo.id)} />)}
            </div>}
            <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll modifiers={dragModifiers}
                onDragStart={({ active, activatorEvent }) => {
                    suppressClickUntil.current = Infinity;
                    setActiveId(String(active.id));
                    if (activatorEvent.type !== 'keydown' && mode !== 'group') {
                        setExpanded(null);
                        setSelected([]);
                        setMode('group');
                    }
                }}
                onDragCancel={() => { setActiveId(null); suppressClickUntil.current = Date.now() + 250; }} onDragEnd={finishDrag}>
                <div className={`gallery-strip ${activeId ? 'is-sorting' : ''}`} ref={galleryRef} aria-busy={saving}>
                    <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
                        {blocks.map(([photo, ...rest], index) => <GalleryCard key={photo.id} photo={photo} index={index}
                            count={rest.length ? rest.length + 1 : undefined}
                            pressed={mode === 'group' && !rest.length ? selected.includes(photo.id) : rest.length ? expanded === photo.id : undefined}
                            disabled={saving} onPreview={() => {
                                if (Date.now() < suppressClickUntil.current) return;
                                if (mode === 'group') {
                                    if (!rest.length) toggleSelection(photo.id);
                                } else if (rest.length) {
                                    leaveSelection();
                                    setExpanded(expanded === photo.id ? null : photo.id);
                                }
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
