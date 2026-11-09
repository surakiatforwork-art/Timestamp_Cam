import { useEffect, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../../context/AppContext';
import type { Photo } from '../../types';
import { downloadAll, downloadOne } from '../../lib/download';

const horizontalOnly: Modifier = ({ transform }) => ({ ...transform, y: 0 });
const dragModifiers = [horizontalOnly];

function GalleryCard({ photo, index, disabled, onPreview, count, pressed, member }: {
    photo: Photo; index: number; disabled: boolean; onPreview: () => void; count?: number; pressed?: boolean; member?: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: photo.id, disabled,
    });
    return (
        <button type="button" ref={setNodeRef} className={`thumbnail sortable-thumbnail ${isDragging ? 'is-dragging' : ''}`}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            {...attributes} {...listeners}
            aria-disabled={undefined}
            aria-label={member ? `เปิดรูปในกลุ่มที่ ${index + 1}` : count ? `เปิดกลุ่ม ${count} รูป` : `เปิดรูปที่ ${index + 1}`}
            aria-pressed={pressed}
            onContextMenu={(event) => event.preventDefault()}
            onClick={onPreview}>
            <img src={photo.thumbUrl} alt={`รูปที่ ${index + 1}`} draggable={false} />
            <span className="thumbnail-badge">{count ? `${count} รูป` : index + 1}</span>
            {pressed !== undefined && !count && <span className="selection-check" aria-hidden="true">{pressed ? '✓' : ''}</span>}
        </button>
    );
}

export default function PhotoGallery() {
    const { state, openPreview, reorderPhotos, showToast, deletePhoto, dispatch } = useApp();
    const [saving, setSaving] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const draggingMembers = useRef(false);
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
    const selectedPhotos = mode === 'split' ? splitSelection
        : blocks.filter((block) => block.length === 1 && selected.includes(block[0].id)).flat();
    const actionsDisabled = saving || activeId !== null || state.downloadProgress !== null;

    async function downloadSelected() {
        if (actionsDisabled || !selectedPhotos.length) return;
        const total = selectedPhotos.length;
        setSaving(true);
        dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: { current: 0, total } });
        try {
            if (total === 1) {
                const photo = selectedPhotos[0];
                await downloadOne(photo, state.settings, 'jpeg', 0.92, photos.indexOf(photo));
            } else {
                const result = await downloadAll(selectedPhotos, state.settings, 'jpeg', 0.92, (current, total) => {
                    dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: { current, total } });
                });
                if (!result.success) throw new Error('Export failed');
            }
            showToast(`ดาวน์โหลด ${total} รูปแล้ว`, 'success');
        } catch {
            showToast('ดาวน์โหลดรูปที่เลือกไม่สำเร็จ', 'error');
        } finally {
            dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: null });
            setSaving(false);
        }
    }

    async function deleteSelected() {
        if (actionsDisabled || !selectedPhotos.length ||
            !window.confirm(`ย้ายรูปที่เลือก ${selectedPhotos.length} รูปไปถังขยะ?`)) return;
        setSaving(true);
        const removed = new Set<string>();
        try {
            for (const photo of selectedPhotos) {
                await deletePhoto(photo.id);
                removed.add(photo.id);
            }
            showToast(`ย้าย ${removed.size} รูปไปถังขยะแล้ว`, 'success');
        } catch {
            showToast('ย้ายรูปไปถังขยะไม่ครบ กรุณาลองอีกครั้ง', 'error');
        } finally {
            if (mode === 'split') {
                const remaining = openGroup?.filter((photo) => !removed.has(photo.id)) ?? [];
                setExpanded(remaining.length > 1 ? remaining[0].id : null);
            }
            leaveSelection();
            setSaving(false);
        }
    }

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

    const finishDrag = async ({ active, over }: DragEndEvent, members?: Photo[]) => {
        setActiveId(null);
        suppressClickUntil.current = Date.now() + 250;
        if (!over || active.id === over.id || saving) return;
        const rowIds = members?.map((photo) => photo.id) ?? ids;
        const from = rowIds.indexOf(String(active.id));
        const to = rowIds.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        const movedMembers = members ? arrayMove(rowIds, from, to) : null;
        const memberIds = new Set(rowIds);
        let memberIndex = 0;
        // Reassign only the group's occupied positions; other gallery photos keep their slots.
        const ordered = movedMembers
            ? photos.map(({ id }) => memberIds.has(id) ? movedMembers[memberIndex++] : id)
            : arrayMove(blocks, from, to).flatMap((block) => block.map((photo) => photo.id));
        if (movedMembers) setExpanded(movedMembers[0]);
        setDraftIds(ordered);
        setSaving(true);
        try { await reorderPhotos(ordered); }
        catch {
            if (members) setExpanded(members[0].id);
            showToast('บันทึกลำดับไม่สำเร็จ กรุณาลองอีกครั้ง', 'error');
        }
        finally { setDraftIds(null); setSaving(false); }
    };

    return (
        <div className="photo-gallery">
            {mode && <div className="gallery-group-actions" aria-label="คำสั่งเลือกภาพ">
                <button type="button" className="btn btn-secondary" disabled={actionsDisabled} onClick={leaveSelection}>ยกเลิก</button>
                {selectedPhotos.length > 0 && <>
                    <button type="button" className="btn btn-secondary" disabled={actionsDisabled}
                        onClick={() => void downloadSelected()}>ดาวน์โหลดที่เลือก</button>
                    <button type="button" className="btn btn-danger" disabled={actionsDisabled}
                        onClick={() => void deleteSelected()}>ลบที่เลือก</button>
                </>}
                {mode === 'group' && groupSelection.length > 1 && <button type="button" className="btn btn-primary" disabled={actionsDisabled}
                    onClick={() => {
                        const next = groups.map((group) => group.filter((id) => !groupSelection.includes(id))).filter((group) => group.length > 1);
                        if (saveGroups([...next, groupSelection])) {
                            setExpanded(null);
                            leaveSelection();
                        }
                    }}>จับกลุ่ม {groupSelection.length} รูป</button>}
                {mode === 'split' && splitSelection.length > 0 && <button type="button" className="btn btn-primary" disabled={actionsDisabled}
                    onClick={() => splitGroup(false)}>แยกออกจากกลุ่ม</button>}
                {mode === 'split' && <button type="button" className="btn btn-secondary" disabled={actionsDisabled}
                    onClick={() => splitGroup(true)}>สลายกลุ่ม</button>}
            </div>}
            {openGroup && openGroup.length > 1 && <DndContext sensors={sensors} collisionDetection={closestCenter}
                autoScroll modifiers={dragModifiers}
                onDragStart={({ active, activatorEvent }) => {
                    draggingMembers.current = true;
                    suppressClickUntil.current = Infinity;
                    setActiveId(String(active.id));
                    if (activatorEvent.type !== 'keydown' && mode !== 'split') {
                        setMode('split');
                        setSelected([]);
                    }
                }}
                onDragCancel={() => { setActiveId(null); suppressClickUntil.current = Date.now() + 250; }}
                onDragEnd={(event) => void finishDrag(event, openGroup)}>
                <div className="gallery-strip" aria-label="รูปในกลุ่ม">
                    <SortableContext items={openGroup.map((photo) => photo.id)} strategy={horizontalListSortingStrategy}>
                        {openGroup.map((photo, index) => <GalleryCard key={photo.id} photo={photo} index={index} member
                            disabled={saving} pressed={mode === 'split' ? selected.includes(photo.id) : undefined}
                            onPreview={() => {
                                if (Date.now() < suppressClickUntil.current) return;
                                if (mode === 'split') toggleSelection(photo.id);
                                else openPreview(photo.id);
                            }} />)}
                    </SortableContext>
                </div>
                <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
                    {activePhoto && draggingMembers.current &&
                        <div className="thumbnail drag-overlay" aria-hidden="true"><img src={activePhoto.thumbUrl} alt="" /></div>}
                </DragOverlay>
            </DndContext>}
            <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll modifiers={dragModifiers}
                onDragStart={({ active, activatorEvent }) => {
                    draggingMembers.current = false;
                    suppressClickUntil.current = Infinity;
                    setActiveId(String(active.id));
                    if (activatorEvent.type !== 'keydown' && mode !== 'group') {
                        setExpanded(null);
                        setSelected([]);
                        setMode('group');
                    }
                }}
                onDragCancel={() => { setActiveId(null); suppressClickUntil.current = Date.now() + 250; }} onDragEnd={(event) => void finishDrag(event)}>
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
                    {activePhoto && !draggingMembers.current && <div className="thumbnail drag-overlay" aria-hidden="true">
                        <img src={activePhoto.thumbUrl} alt="" draggable={false} />
                        <span className="thumbnail-badge">{ids.indexOf(activePhoto.id) + 1}</span>
                    </div>}
                </DragOverlay>
            </DndContext>
        </div>
    );
}
