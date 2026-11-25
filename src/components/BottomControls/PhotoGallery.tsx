import { useBackHandler } from '../../lib/backNavigation';
import { confirmAction } from '../common/ConfirmDialog';
import { Check, ChevronsLeft, ChevronsRight, Layers, ListChecks, Trash2, Download, X, Ungroup, Group, CheckCheck, MoreVertical, Undo2, ChevronLeft, PencilLine } from 'lucide-react';
import { vibrateForTick } from '../../lib/deviceFeedback';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type Modifier, type CollisionDetection } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../../context/AppContext';
import BatchEditModal from '../modals/BatchEditModal';
import type { Photo } from '../../types';
import { downloadAll, downloadOne } from '../../lib/download';
import { finishDownload } from '../../lib/downloadCleanup';

const horizontalOnly: Modifier = ({ transform }) => ({ ...transform, y: 0 });
const dragModifiers = [horizontalOnly];

type PhotoGroup = { id: string; members: string[] };
const GROUP_KEY = 'timestamp-photo-groups';
const newGroupId = () => 'group:' + crypto.randomUUID();
function loadGroups(): PhotoGroup[] {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(GROUP_KEY) ?? '[]');
        if (!Array.isArray(raw)) return [];
        const used = new Set<string>(), keys = new Set<string>();
        return raw.flatMap(entry => {
            const legacy = Array.isArray(entry);
            const list: unknown = legacy ? entry : entry?.members;
            if (!Array.isArray(list)) return [];
            const members = [...new Set(list.filter((id): id is string => typeof id === 'string' && !used.has(id)))];
            if (members.length < 2) return [];
            let id = !legacy && typeof entry?.id === 'string' && entry.id.startsWith('group:') ? entry.id : newGroupId();
            if (keys.has(id)) id = newGroupId();
            keys.add(id); members.forEach(member => used.add(member));
            return [{ id, members }];
        });
    } catch { return []; }
}
type GroupUndo = { groups: PhotoGroup[]; expanded: string | null; label: string };
type CardSnapshot = { rect: DOMRect; clone: HTMLElement };
function GalleryCard({ cardId, photo, index, disabled, onPreview, count, pressed, member, expanded, children }: {
    cardId?: string; photo: Photo; index: number; disabled: boolean; onPreview: () => void; count?: number; pressed?: boolean; member?: boolean; expanded?: boolean; children?: ReactNode;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: cardId ?? photo.id, disabled,
    });
    const cardStyle = { transform: CSS.Transform.toString(transform), transition };
    const button = (
        <button type="button" ref={children ? undefined : setNodeRef} data-card-id={cardId ?? photo.id} className={`thumbnail sortable-thumbnail ${count ? 'group-thumbnail' : ''} ${isDragging && !children ? 'is-dragging' : ''} ${expanded ? 'group-toggle' : ''}`}
            style={children ? undefined : cardStyle}
            {...attributes} {...listeners}
            aria-disabled={undefined}
            aria-label={expanded ? `ปิดกลุ่ม ${count} รูป` : member ? `เปิดรูปในกลุ่มที่ ${index + 1}` : count ? `เปิดกลุ่ม ${count} รูป` : `เปิดรูปที่ ${index + 1}`}
            aria-pressed={pressed}
            aria-expanded={count && pressed === undefined ? !!expanded : undefined}
            onContextMenu={(event) => event.preventDefault()}
            onClick={onPreview}>
            {expanded ? <span className="group-toggle-content"><Layers className="ui-icon" aria-hidden="true" /><b>{count}</b><ChevronLeft className="ui-icon group-collapse-arrow" aria-hidden="true" /></span> : <img src={photo.thumbUrl || undefined} loading="lazy" decoding="async" alt={`รูปที่ ${index + 1}`} draggable={false} />}
            {!expanded && <span className="thumbnail-badge">{count ? <><Layers className="ui-icon" aria-hidden="true" /> {count} รูป</> : index + 1}</span>}
            {pressed !== undefined && <span className="selection-check" aria-hidden="true">{pressed ? <Check className="ui-icon selection-mark" aria-hidden="true" /> : ''}</span>}
        </button>
    );
    if (!children) return button;
    return <div ref={setNodeRef} className={`inline-group ${isDragging ? 'inline-group-dragging' : ''}`} style={cardStyle}>
        {button}{children}
    </div>;
}

export default function PhotoGallery() {
    const { state, openPreview, reorderPhotos, showToast, deleteAllPhotos, trashPhotos, dispatch } = useApp();
    const [batchPhotos, setBatchPhotos] = useState<Photo[] | null>(null);
    const [saving, setSaving] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const draggingMembers = useRef(false);
    const [draftIds, setDraftIds] = useState<string[] | null>(null);
    const [groups, setGroups] = useState<PhotoGroup[]>(loadGroups);
    const [undo, setUndo] = useState<GroupUndo | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const dragIntent = useRef({ keyboard: false, moved: false });
    const snapshots = useRef<Map<string, CardSnapshot> | null>(null);
    const animationTarget = useRef<{ into?: string; from?: string }>({});
    const revealGroup = useRef<string | null>(null);
    const effects = useRef<Animation[]>([]);
    const ghosts = useRef<HTMLElement[]>([]);
    const [mode, setMode] = useState<'group' | 'split' | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [expanded, setExpanded] = useState<string | null>(null);
    useEffect(() => { if (state.activeModal !== 'batch' && batchPhotos) setBatchPhotos(null); }, [state.activeModal, batchPhotos]);
    const previousCount = useRef(state.photos.length);
    const galleryRef = useRef<HTMLDivElement>(null);
    const jump = (ref: React.RefObject<HTMLDivElement>, right: boolean) => {
        const el = ref.current; if (el) el.scrollTo({ left: right ? el.scrollWidth - el.clientWidth : 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    const suppressClickUntil = useRef(0);
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { delay: 350, tolerance: 10 } }),
        // TouchSensor lets quick swipes scroll natively before activation, then
        // prevents scrolling only after the long press has actually started a drag.
        useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 10 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
    const photos: Photo[] = [];
    for (const id of draftIds ?? []) {
        const photo = byId.get(id);
        if (photo) { photos.push(photo); byId.delete(id); }
    }
    photos.push(...byId.values());
    const membership = new Map(groups.flatMap(group => group.members.map(id => [id, group] as const)));
    const activeMembers = new Map<string, Photo[]>();
    for (const photo of photos) {
        const group = membership.get(photo.id);
        if (group) activeMembers.set(group.id, [...(activeMembers.get(group.id) ?? []), photo]);
    }
    const blocks = photos.flatMap(photo => {
        const group = membership.get(photo.id);
        const members = group ? activeMembers.get(group.id) ?? [photo] : [photo];
        return members[0]?.id === photo.id ? [members] : [];
    });
    const blockId = (block: Photo[]) => block.length > 1 ? membership.get(block[0].id)!.id : block[0].id;
    const ids = blocks.map(blockId);
    const activePhoto = draggingMembers.current ? photos.find(photo => photo.id === activeId) : blocks.find(block => blockId(block) === activeId)?.[0];
    const openGroup = expanded ? activeMembers.get(expanded) : undefined;
    useEffect(() => {
        if (expanded && (!openGroup || openGroup.length<2)) {setExpanded(null); if(mode==='split') leaveSelection();}
        if (mode && selected.some(id=>!state.photos.some(p=>p.id===id))) setSelected(prev=>prev.filter(id=>state.photos.some(p=>p.id===id)));
    },[state.photos, expanded, mode, selected]);
    useBackHandler(20,()=>{
        if(state.activeModal!=='none')return false;
        if(saving || activeId!==null)return true;
        if(menuOpen){setMenuOpen(false);return true;}
        if(mode){leaveSelection();return true;}
        if(expanded){collapseGroup();return true;}
        return false;
    });
    const memberIds = new Set(openGroup?.map(photo => photo.id) ?? []);
    const collision: CollisionDetection = args => {
        const isMember = !!expanded && memberIds.has(String(args.active.id)) && openGroup!.length > 1;
        const allowed = isMember ? memberIds : new Set(ids);
        return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(item => allowed.has(String(item.id))) });
    };

    // Persist migrated IDs without deleting any originals or modifying photo order.
    useEffect(() => {
        try { localStorage.setItem(GROUP_KEY, JSON.stringify(groups)); } catch { /* Keep the in-memory state usable. */ }
    }, []);
    useEffect(() => {
        if (!undo) return;
        const timer = window.setTimeout(() => setUndo(null), 6500);
        return () => window.clearTimeout(timer);
    }, [undo]);
    useEffect(() => {
        if (!menuOpen) return;
        const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
        document.addEventListener('pointerdown', dismiss);
        return () => { document.removeEventListener('pointerdown', dismiss); };
    }, [menuOpen]);
    function cleanEffects() {
        effects.current.forEach(animation => animation.cancel()); effects.current = [];
        ghosts.current.forEach(node => node.remove()); ghosts.current = [];
    }
    useEffect(() => cleanEffects, []);
    function snapshot(target: { into?: string; from?: string }) {
        cleanEffects();
        const row = galleryRef.current;
        if (!row) return;
        const bounds = row.getBoundingClientRect();
        snapshots.current = new Map(Array.from(row.querySelectorAll<HTMLElement>('[data-card-id]'))
            .filter(node => { const b = node.getBoundingClientRect(); return b.right > bounds.left && b.left < bounds.right; })
            .map(node => [node.dataset.cardId!, { rect: node.getBoundingClientRect(), clone: node.cloneNode(true) as HTMLElement }]));
        animationTarget.current = target;
    }
    useLayoutEffect(() => {
        const previous = snapshots.current;
        snapshots.current = null;
        if (!previous || !galleryRef.current) return;
        const row = galleryRef.current;
        const reveal = revealGroup.current;
        revealGroup.current = null;
        if (reveal) {
            const anchor = Array.from(row.querySelectorAll<HTMLElement>('[data-card-id]')).find(node => node.dataset.cardId === reveal);
            const old = previous.get(reveal)?.rect;
            if (anchor && old) row.scrollLeft += anchor.getBoundingClientRect().left - old.left;
            const firstMember = anchor?.parentElement?.querySelector<HTMLElement>('.group-members .thumbnail');
            if (anchor && firstMember) {
                const viewport = row.getBoundingClientRect(), first = firstMember.getBoundingClientRect();
                if (first.right > viewport.right - 4) row.scrollLeft += first.right - viewport.right + 4;
            }
        }
        const current = new Map(Array.from(row.querySelectorAll<HTMLElement>('[data-card-id]')).map(node => [node.dataset.cardId!, node]));
        const { into, from } = animationTarget.current;
        animationTarget.current = {};
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const source = from ? previous.get(from)?.rect : undefined;
        const dest = into ? current.get(into)?.getBoundingClientRect() : undefined;
        const options = { duration: 210, easing: 'cubic-bezier(.2,.8,.2,1)' };
        for (const [id, node] of current) {
            if (!previous.has(id) && node.closest('.group-members') && source) {
                effects.current.push(node.animate([{ opacity: .25 }, { opacity: 1 }], options));
                continue;
            }
            const old = previous.get(id)?.rect ?? source;
            if (!old) continue;
            const box = node.getBoundingClientRect(), dx = old.left - box.left, dy = old.top - box.top;
            if (Math.abs(dx) + Math.abs(dy) < 2) continue;
            effects.current.push(node.animate([{ translate: `${dx}px ${dy}px`, opacity: previous.has(id) ? 1 : .4 }, { translate: '0px 0px', opacity: 1 }], options));
        }
        if (dest) for (const [id, item] of previous) {
            if (current.has(id)) continue;
            const ghost = item.clone;
            ghost.removeAttribute('data-card-id'); ghost.removeAttribute('id'); ghost.setAttribute('aria-hidden', 'true'); ghost.setAttribute('tabindex', '-1');
            ghost.classList.add('group-motion-ghost'); ghost.classList.remove('thumbnail', 'group-thumbnail', 'sortable-thumbnail'); ghost.removeAttribute('aria-label');
            Object.assign(ghost.style, { position:'fixed', left:`${item.rect.left}px`, top:`${item.rect.top}px`, width:`${item.rect.width}px`, height:`${item.rect.height}px`, pointerEvents:'none', zIndex:'90', margin:'0', transform:'none', transition:'none' });
            document.body.appendChild(ghost); ghosts.current.push(ghost);
            const effect = ghost.animate([{ transform:'translate3d(0,0,0) scale(1)', opacity:1 }, { transform:`translate3d(${dest.left-item.rect.left}px,${dest.top-item.rect.top}px,0) scale(.65)`, opacity:0 }], options);
            effects.current.push(effect); void effect.finished.then(() => ghost.remove()).catch(() => ghost.remove());
        }
    }, [groups, expanded]);
    function saveGroups(next: PhotoGroup[], target: { into?: string; from?: string } = {}) {
        try {
            localStorage.setItem(GROUP_KEY, JSON.stringify(next));
            snapshot(target);
            setGroups(next);
            return true;
        } catch {
            showToast('บันทึกกลุ่มไม่สำเร็จ', 'error');
            return false;
        }
    }
    function changeGroups(next: PhotoGroup[], label: string, target: { into?: string; from?: string }) {
        if (!saveGroups(next, target)) return false;
        setUndo({ groups, expanded, label });
        return true;
    }
    function undoGrouping() {
        if (!undo || actionsDisabled) return;
        if (saveGroups(undo.groups)) { setExpanded(undo.expanded); setUndo(null); leaveSelection(); }
    }

    function toggleGroup(id: string, exitMemberSelection = false) {
        if (actionsDisabled || (mode && !exitMemberSelection)) return;
        const opening = expanded !== id;
        revealGroup.current = opening ? id : null;
        snapshot(opening ? { from: id } : { into: id });
        setExpanded(opening ? id : null);
    }
    function collapseGroup() {
        if (!expanded) return;
        snapshot({ into: expanded }); setExpanded(null);
    }

    function leaveSelection() {
        setMode(null);
        setSelected([]);
        setMenuOpen(false);
    }

    function toggleSelection(ids: string[]) {
        setSelected(previous => ids.every(id => previous.includes(id))
            ? previous.filter(id => !ids.includes(id))
            : [...new Set([...previous, ...ids])]);
    }

    const selectedBlocks = blocks.filter(block => block.every(photo => selected.includes(photo.id)));
    const groupSelection = selectedBlocks.flatMap(block => block.map(photo => photo.id));
    const splitSelection = openGroup?.filter(photo => selected.includes(photo.id)) ?? [];
    const selectedPhotos = mode === 'split' ? splitSelection : selectedBlocks.flat();
    const selectableIds = (mode === 'split' ? openGroup ?? [] : blocks.flat()).map(photo => photo.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.includes(id));
    const canCombine = selectedBlocks.length >= 2;
    const actionsDisabled = saving || activeId !== null || state.downloadProgress !== null || state.importProgress !== null || !!batchPhotos;

    function combineSelection() {
        if (!canCombine || actionsDisabled) return;
        // Use a stable ID for the leftmost existing group; never nest groups.
        const groupId = selectedBlocks.find(block => block.length > 1) ? blockId(selectedBlocks.find(block => block.length > 1)!) : newGroupId();
        const next = groups.map(group => ({ ...group, members: group.members.filter(id => !groupSelection.includes(id)) }))
            .filter(group => group.id !== groupId && group.members.length > 1);
        const merged = { id: groupId, members: groupSelection };
        if (changeGroups([...next, merged], `รวม ${groupSelection.length} รูปแล้ว`, { into: groupId })) {
            setExpanded(null); leaveSelection(); vibrateForTick();
        }
    }

    async function downloadSelected() {
        if (actionsDisabled || !selectedPhotos.length) return;
        const total = selectedPhotos.length;
        setSaving(true);
        dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: { current: 0, total } });
        try {
            let result: {success:boolean; confirmedIds:string[]};
            if (total === 1) {
                const photo = selectedPhotos[0];
                const saved = await downloadOne(photo, state.settings, 'jpeg', 0.92, photos.indexOf(photo));
                result = {success:true,confirmedIds:saved.confirmed?[photo.id]:[]};
            } else {
                result = await downloadAll(selectedPhotos, state.settings, 'jpeg', 0.92, (current, total) => {
                    dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: { current, total } });
                });
            }
            const moved = await finishDownload(result,total,state.settings.autoTrashAfterDownload,trashPhotos,showToast);
            if (moved) {
                const removed = new Set(result.confirmedIds);
                setSelected(prev=>prev.filter(id=>!removed.has(id)));
                if (openGroup && openGroup.filter(p=>!removed.has(p.id)).length<2) {setExpanded(null);leaveSelection();}
                else if (selectedPhotos.every(p=>removed.has(p.id))) leaveSelection();
                setUndo(null);
            }
        } catch {
            showToast('ดาวน์โหลดรูปที่เลือกไม่สำเร็จ', 'error');
        } finally {
            dispatch({ type: 'SET_DOWNLOAD_PROGRESS', payload: null });
            setSaving(false);
        }
    }

    async function deleteSelected() {
        if (actionsDisabled || !selectedPhotos.length ||
            !await confirmAction({title:`ย้าย ${selectedPhotos.length} รูปไปถังขยะ?`,message:'ภาพจะถูกนำออกจากคลัง แต่สามารถกู้คืนได้จากถังขยะ',action:'ย้ายไปถังขยะ',kind:'trash'})) return;
        setUndo(null); setMenuOpen(false);
        setSaving(true);
        const removed = new Set<string>();
        try {
            await trashPhotos(selectedPhotos.map(p=>p.id));
            selectedPhotos.forEach(p=>removed.add(p.id));
            showToast(`ย้าย ${removed.size} รูปไปถังขยะแล้ว`, 'success');
        } catch {
            showToast('ย้ายรูปไปถังขยะไม่ครบ กรุณาลองอีกครั้ง', 'error');
        } finally {
            if (mode === 'split') {
                const remaining = openGroup?.filter((photo) => !removed.has(photo.id)) ?? [];
                setExpanded(remaining.length > 1 ? expanded : null);
            }
            leaveSelection();
            setSaving(false);
        }
    }

    function splitGroup(all: boolean) {
        if (!openGroup || !expanded || actionsDisabled || (!all && !splitSelection.length)) return;
        const current = groups.find(group => group.id === expanded);
        if (!current) return;
        const remaining = all ? [] : current.members.filter(id => !selected.includes(id));
        const next = groups.filter(group => group.id !== current.id);
        if (remaining.length > 1) next.push({ ...current, members: remaining });
        if (changeGroups(next, all ? 'สลายกลุ่มแล้ว' : 'แยกรูปออกจากกลุ่มแล้ว', { from: current.id })) {
            setExpanded(openGroup.filter(photo => remaining.includes(photo.id)).length > 1 ? current.id : null);
            leaveSelection(); vibrateForTick();
        }
    }

    function beginDrag(id: string, keyboard: boolean, members: boolean) {
        cleanEffects();
        dragIntent.current = { keyboard, moved: false };
        draggingMembers.current = members;
        suppressClickUntil.current = Infinity;
        setActiveId(id); setMenuOpen(false);
        vibrateForTick();
    }
    function trackDrag(event: DragMoveEvent) {
        if (Math.hypot(event.delta.x, event.delta.y) > 10) dragIntent.current.moved = true;
    }
    function cancelDrag() {
        setActiveId(null); suppressClickUntil.current = Date.now() + 250;
    }

    useEffect(() => {
        if (galleryRef.current && state.photos.length > previousCount.current && !activeId && !mode) galleryRef.current.scrollLeft = galleryRef.current.scrollWidth;
        previousCount.current = state.photos.length;
    }, [state.photos.length]);

    const finishDrag = async ({ active, over, delta }: DragEndEvent, members?: Photo[]) => {
        setActiveId(null);
        suppressClickUntil.current = Date.now() + 250;
        if (!dragIntent.current.keyboard && !dragIntent.current.moved && Math.hypot(delta.x, delta.y) <= 10 && !saving) {
            const picked = members?.filter(photo => photo.id === active.id) ?? blocks.find(block => blockId(block) === active.id) ?? [];
            if (picked.length) {
                const nextMode = members ? 'split' : 'group';
                if (!members) collapseGroup();
                if (mode !== nextMode) { setMode(nextMode); setSelected(picked.map(photo => photo.id)); }
                else setSelected(previous => [...new Set([...previous, ...picked.map(photo => photo.id)])]);
            }
            return;
        }
        if (!over || active.id === over.id || saving) return;
        setUndo(null);
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

        setDraftIds(ordered);
        setSaving(true);
        try { await reorderPhotos(ordered); }
        catch {

            showToast('บันทึกลำดับไม่สำเร็จ กรุณาลองอีกครั้ง', 'error');
        }
        finally { setDraftIds(null); setSaving(false); }
    };

    async function clearGallery() {
        if (actionsDisabled || !state.photos.length || !await confirmAction({title:`ย้ายรูปทั้งหมด ${state.photos.length} รูป?`,message:'ภาพทั้งหมดจะอยู่ในถังขยะของแอปและสามารถกู้คืนได้',action:'ย้ายไปถังขยะ',kind:'trash'})) return;
        setUndo(null); setSaving(true);
        try { await deleteAllPhotos(); leaveSelection(); setExpanded(null); showToast('ลบรูปทั้งหมดแล้ว', 'info'); }
        catch { showToast('ลบรูปไม่สำเร็จ', 'error'); }
        finally { setSaving(false); }
    }

    const edge = (ref: React.RefObject<HTMLDivElement>, right: boolean, group = false) => <button type="button"
        className={`gallery-edge ${right ? 'right' : 'left'}`} disabled={!!activeId || saving}
        onClick={() => jump(ref, right)} aria-label={`เลื่อนไป${right ? 'ขวา' : 'ซ้าย'}สุด${group ? 'ของกลุ่ม' : ''}`}
        title={`เลื่อนไป${right ? 'ขวา' : 'ซ้าย'}สุด`}>
        {right ? <ChevronsRight className="ui-icon" aria-hidden="true" /> : <ChevronsLeft className="ui-icon" aria-hidden="true" />}
    </button>;

    return (
        <div className="photo-gallery">
            <div className="gallery-toolbar">
                <span className="gallery-caption"><Layers className="ui-icon" aria-hidden="true" /> {mode ? (mode === 'split' ? 'เลือกในกลุ่ม' : 'เลือกภาพ') : (openGroup && openGroup.length > 1 ? 'กลุ่ม · ' + openGroup.length + ' รูป' : 'คลังภาพ')}{mode && <b>{selectedPhotos.length} รูป</b>}</span>
                {!mode ? <div className="gallery-toolbar-actions">
                    <button className="gallery-tool" disabled={!photos.length || actionsDisabled} onClick={() => { collapseGroup(); setMode('group'); setSelected([]); }}><ListChecks className="ui-icon" aria-hidden="true" /> เลือก</button>
                    {openGroup && openGroup.length > 1 ? <button className="gallery-tool manage-inline-group" disabled={actionsDisabled} onClick={() => { setMode('split'); setSelected([]); }}><ListChecks className="ui-icon" aria-hidden="true" /> จัดการ</button> : <button className="gallery-tool danger" disabled={!photos.length || actionsDisabled} onClick={() => void clearGallery()} title="ลบทั้งหมด"><Trash2 className="ui-icon" aria-hidden="true" /></button>}
                </div> : <div className="gallery-toolbar-actions">
                    <button className="gallery-tool" disabled={actionsDisabled || !selectableIds.length} onClick={() => setSelected(allSelected ? [] : selectableIds)} aria-label={allSelected ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทั้งหมด'}><CheckCheck className="ui-icon" aria-hidden="true" /> {allSelected ? 'ไม่เลือกทั้งหมด' : 'เลือกทั้งหมด'}</button>
                    <button className="gallery-tool" disabled={actionsDisabled} onClick={leaveSelection} aria-label="ยกเลิก"><X className="ui-icon" aria-hidden="true" /></button>
                </div>}
            </div>
            {mode && <div className="gallery-group-actions selection-actions" aria-label="คำสั่งเลือกภาพ">
                {mode === 'group' ? <button type="button" className="btn btn-primary" disabled={actionsDisabled || !canCombine}
                    onClick={combineSelection} aria-label={canCombine ? `จับกลุ่ม ${groupSelection.length} รูป` : 'จับกลุ่ม'}><Group className="ui-icon" aria-hidden="true" /><span>{selectedBlocks.some(block => block.length > 1) ? 'รวมกลุ่ม' : 'จับกลุ่ม'}</span></button>
                    : <button type="button" className="btn btn-primary" disabled={actionsDisabled || !splitSelection.length}
                    onClick={() => splitGroup(false)} aria-label="แยกออกจากกลุ่ม"><Ungroup className="ui-icon" aria-hidden="true" /><span>แยกรูป</span></button>}
                <button type="button" className="btn btn-secondary" disabled={actionsDisabled || !selectedPhotos.length}
                    onClick={() => void downloadSelected()} aria-label="ดาวน์โหลดที่เลือก"><Download className="ui-icon" aria-hidden="true" /><span>ดาวน์โหลด</span></button>
                <button type="button" className="btn btn-secondary" disabled={actionsDisabled || !selectedPhotos.length}
                    onClick={() => {setMenuOpen(false);setBatchPhotos([...selectedPhotos]);dispatch({type:'SET_ACTIVE_MODAL',payload:'batch'});}} aria-label="แก้ไขที่เลือก"><PencilLine className="ui-icon" aria-hidden="true"/><span>แก้ไข</span></button>
                <div className="selection-menu-anchor" ref={menuRef}>
                    <button type="button" className="btn btn-secondary" disabled={actionsDisabled} aria-expanded={menuOpen} aria-label="เพิ่มเติม" onClick={() => setMenuOpen(!menuOpen)}><MoreVertical className="ui-icon" aria-hidden="true" /><span>เพิ่มเติม</span></button>
                    {menuOpen && <div className="selection-menu">
                        {mode === 'split' && <button disabled={actionsDisabled} onClick={() => splitGroup(true)}><Layers className="ui-icon" aria-hidden="true" /> สลายกลุ่ม</button>}
                        <button disabled={actionsDisabled || !selectedPhotos.length} onClick={() => { setSelected([]); setMenuOpen(false); }}><X className="ui-icon" aria-hidden="true" /> ล้างการเลือก</button>
                        <button className="selection-delete" disabled={actionsDisabled || !selectedPhotos.length} onClick={() => { setMenuOpen(false); void deleteSelected(); }}><Trash2 className="ui-icon" aria-hidden="true" /> ลบที่เลือก</button>
                    </div>}
                </div>
            </div>}
            {!mode && undo && <div className="group-undo" role="status"><span>{undo.label}</span><button disabled={actionsDisabled} onClick={undoGrouping}><Undo2 className="ui-icon" aria-hidden="true" /> ย้อนกลับ</button><button aria-label="ปิดข้อความ" onClick={() => setUndo(null)}><X className="ui-icon" aria-hidden="true" /></button></div>}
            <DndContext sensors={sensors} collisionDetection={collision} autoScroll modifiers={dragModifiers}
                onDragStart={({ active, activatorEvent }) => beginDrag(String(active.id), activatorEvent.type === 'keydown', memberIds.has(String(active.id)) && !!openGroup && openGroup.length > 1)}
                onDragMove={trackDrag} onDragCancel={cancelDrag} onDragEnd={(event) => void finishDrag(event, draggingMembers.current ? openGroup : undefined)}>
                <div className="gallery-rail">{edge(galleryRef, false)}
                <div className={`gallery-strip ${activeId ? 'is-sorting' : ''}`} ref={galleryRef} aria-busy={saving}
                    onPointerDownCapture={() => { if (!activeId) suppressClickUntil.current = 0; }}>
                    <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
                        {blocks.map((block, index) => {
                            const [photo, ...rest] = block, id = blockId(block);
                            const isExpanded = rest.length > 0 && expanded === id;
                            return <GalleryCard key={id} cardId={id} photo={photo} index={index}
                                count={rest.length ? rest.length + 1 : undefined} expanded={isExpanded}
                                pressed={mode === 'group' ? block.every(member => selected.includes(member.id)) : undefined}
                                disabled={saving || mode === 'split'} onPreview={() => {
                                    if (Date.now() < suppressClickUntil.current || saving) return;
                                    if (mode === 'group') toggleSelection(block.map(member => member.id));
                                    else if (mode === 'split') {
                                        // A tap on the outer rail leaves member selection; never select an outside photo by accident.
                                        leaveSelection();
                                        if (isExpanded) collapseGroup();
                                        else if (rest.length) toggleGroup(id, true);
                                        else { collapseGroup(); openPreview(photo.id, blocks.flat().map(member => member.id)); }
                                    }
                                    else if (rest.length) toggleGroup(id);
                                    else { collapseGroup(); openPreview(photo.id, blocks.flat().map(member => member.id)); }
                                }}>
                                {isExpanded ? <div className="group-members" role="group" aria-label="รูปในกลุ่ม" data-group-id={id}>
                                    <SortableContext items={block.map(member => member.id)} strategy={horizontalListSortingStrategy}>
                                        {block.map((member, memberIndex) => <GalleryCard key={member.id} photo={member} index={memberIndex} member
                                            disabled={saving || mode === 'group'} pressed={mode === 'split' ? selected.includes(member.id) : undefined}
                                            onPreview={() => {
                                                if (Date.now() < suppressClickUntil.current || saving) return;
                                                if (mode === 'split') toggleSelection([member.id]);
                                                else if (!mode) openPreview(member.id, block.map(item => item.id));
                                            }} />)}
                                    </SortableContext>
                                </div> : undefined}
                            </GalleryCard>;
                        })}
                    </SortableContext>
                </div>{edge(galleryRef, true)}</div>
                <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
                    {activePhoto && <div className="thumbnail drag-overlay" aria-hidden="true">
                        <img src={activePhoto.thumbUrl} alt="" draggable={false} />
                        {!draggingMembers.current && <span className="thumbnail-badge">{ids.indexOf(activeId ?? '') + 1}</span>}
                    </div>}
                </DragOverlay>
            </DndContext>
            {batchPhotos && state.activeModal === 'batch' && <BatchEditModal photos={batchPhotos} onClose={() => {
                setBatchPhotos(null); dispatch({type:'SET_ACTIVE_MODAL',payload:'none'});
            }}/>}
        </div>
    );
}
