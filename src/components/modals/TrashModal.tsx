import { useState } from 'react';
import { useApp } from '../../context/AppContext';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function remainingDays(deletedAtISO: string): string {
    const remaining = new Date(deletedAtISO).getTime() + RETENTION_MS - Date.now();
    if (remaining <= 0) return 'กำลังลบอัตโนมัติ';
    return `เหลือ ${Math.ceil(remaining / (24 * 60 * 60 * 1000))} วัน`;
}

export default function TrashModal() {
    const {
        state, closeModal, restoreTrashPhotos,
        permanentlyDeleteTrashPhotos, clearTrash, showToast,
    } = useApp();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const { trashPhotos } = state;

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
                        />
                        เลือกทั้งหมด
                    </label>
                    <span>{trashPhotos.length} รูป</span>
                </div>

                <div className="trash-list">
                    {trashPhotos.length === 0 ? (
                        <p className="trash-empty">ถังขยะว่างอยู่</p>
                    ) : trashPhotos.map((photo) => (
                        <label className="trash-item" key={photo.id}>
                            <input
                                type="checkbox"
                                checked={selectedIds.has(photo.id)}
                                onChange={() => toggle(photo.id)}
                            />
                            <img src={photo.thumbUrl} alt="รูปที่ลบ" />
                            <span className="trash-item-info">
                                <strong>{photo.sourceName === 'camera' ? 'รูปจากกล้อง' : photo.sourceName}</strong>
                                <small>ลบเมื่อ {new Date(photo.deletedAtISO).toLocaleString('th-TH')}</small>
                                <small>{remainingDays(photo.deletedAtISO)}</small>
                            </span>
                        </label>
                    ))}
                </div>

                <div className="trash-actions">
                    <button className="btn btn-secondary" onClick={handleClearTrash} disabled={!trashPhotos.length}>
                        ล้างถังขยะ
                    </button>
                    <button className="btn btn-danger" onClick={deleteSelected} disabled={!selectedIds.size}>
                        ลบถาวร
                    </button>
                    <button className="btn btn-primary" onClick={restoreSelected} disabled={!selectedIds.size}>
                        กู้คืน
                    </button>
                </div>
            </div>
        </div>
    );
}
