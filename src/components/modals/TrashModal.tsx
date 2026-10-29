import { useState } from 'react';
import { useApp } from '../../context/AppContext';

function trashAge(deletedAtISO: string): string {
    const days = Math.max(0, Math.floor((Date.now() - new Date(deletedAtISO).getTime()) / 86400000));
    return days > 30 ? `อยู่ในถังขยะ ${days} วัน · เกิน 30 วัน` : `อยู่ในถังขยะ ${days} วัน`;
}

export default function TrashModal() {
    const {
        state, closeModal, restoreTrashPhotos,
        permanentlyDeleteTrashPhotos, clearTrash, showToast, retryTrashStorage,
    } = useApp();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const { trashPhotos } = state;
    const [busy, setBusy] = useState(false);
    const canEdit = state.trashStatus === 'ready' && !busy;
    const progress = state.trashProgress;
    const percent = progress.total ? Math.round(progress.current / progress.total * 100) : 0;

    const run = async (action: () => Promise<void>) => {
        if (!canEdit) return;
        setBusy(true);
        try { await action(); }
        catch { showToast('จัดการรูปในถังขยะไม่สำเร็จ กรุณาลองอีกครั้ง', 'error'); }
        finally { setBusy(false); }
    };

    const toggle = (id: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        setSelectedIds(selectedIds.size === trashPhotos.length
            ? new Set()
            : new Set(trashPhotos.map((photo) => photo.id)));
    };

    const restoreSelected = async () => {
        if (!selectedIds.size) return;
        const count = await restoreTrashPhotos([...selectedIds]);
        setSelectedIds(new Set());
        showToast(`กู้คืน ${count} รูปแล้ว`, 'success');
    };

    const deleteSelected = async () => {
        if (!selectedIds.size || !confirm(`ลบถาวร ${selectedIds.size} รูป?`)) return;
        await permanentlyDeleteTrashPhotos([...selectedIds]);
        setSelectedIds(new Set());
        showToast('ลบรูปถาวรแล้ว', 'info');
    };

    const handleClearTrash = async () => {
        if (!trashPhotos.length || !confirm(`ล้างถังขยะทั้งหมด ${trashPhotos.length} รูป?`)) return;
        await clearTrash();
        setSelectedIds(new Set());
        showToast('ล้างถังขยะแล้ว', 'info');
    };

    return (
        <div className="modal-backdrop trash-modal" onClick={closeModal}>
            <div className="modal-content" onClick={(event) => event.stopPropagation()}>
                <div className="modal-header">
                    <h2>ถังขยะ</h2>
                    <button className="icon-btn" onClick={closeModal} title="ปิด">✕</button>
                </div>

                <div className="trash-toolbar">
                    <label className="trash-select-all">
                        <input
                            type="checkbox"
                            checked={trashPhotos.length > 0 && selectedIds.size === trashPhotos.length}
                            onChange={toggleAll}
                            disabled={!canEdit}
                        />
                        เลือกทั้งหมด
                    </label>
                    <span>{trashPhotos.length} รูป</span>
                </div>

                <div className="trash-list">
                    {state.trashStatus === 'loading' && (
                        <div className="trash-load-status" role="status" aria-live="polite">
                            <span className="loading-spinner" aria-hidden="true" />
                            <strong>{progress.phase === 'migration' ? 'กำลังย้ายข้อมูลถังขยะ' : 'กำลังโหลดถังขยะ'}</strong>
                            <span>{progress.current} / {progress.total} รูป · {percent}%</span>
                            <progress max={Math.max(progress.total, 1)} value={progress.current} aria-label="ความคืบหน้าถังขยะ" />
                        </div>
                    )}
                    {state.trashStatus === 'error' && (
                        <div className="trash-load-status" role="alert">
                            <strong>โหลดถังขยะไม่สำเร็จ</strong>
                            <button className="btn btn-secondary" onClick={retryTrashStorage}>ลองอีกครั้ง</button>
                        </div>
                    )}
                    {state.trashStatus === 'ready' && trashPhotos.length === 0 ? (
                        <p className="trash-empty">ถังขยะว่างอยู่</p>
                    ) : trashPhotos.map((photo) => (
                        <label className="trash-item" key={photo.id}>
                            <input
                                type="checkbox"
                                checked={selectedIds.has(photo.id)}
                                onChange={() => toggle(photo.id)}
                                disabled={!canEdit}
                            />
                            <img src={photo.thumbUrl} alt="รูปที่ลบ" />
                            <span className="trash-item-info">
                                <strong>{photo.sourceName === 'camera' ? 'รูปจากกล้อง' : photo.sourceName}</strong>
                                <small>ลบเมื่อ {new Date(photo.deletedAtISO).toLocaleString('th-TH')}</small>
                                <small>{trashAge(photo.deletedAtISO)}</small>
                            </span>
                        </label>
                    ))}
                </div>

                <div className="trash-actions">
                    <button className="btn btn-secondary" onClick={() => run(handleClearTrash)} disabled={!canEdit || !trashPhotos.length}>
                        ล้างถังขยะ
                    </button>
                    <button className="btn btn-danger" onClick={() => run(deleteSelected)} disabled={!canEdit || !selectedIds.size}>
                        ลบถาวร
                    </button>
                    <button className="btn btn-primary" onClick={() => run(restoreSelected)} disabled={!canEdit || !selectedIds.size}>
                        กู้คืน
                    </button>
                </div>
            </div>
        </div>
    );
}
