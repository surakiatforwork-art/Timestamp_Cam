import { useApp } from '../../context/AppContext';

export default function DownloadProgressModal() {
    const { state } = useApp();
    const isImporting = state.downloadProgress === null && state.importProgress !== null;
    const progress = state.downloadProgress ?? state.importProgress;
    if (!progress) return null;

    const percent = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
        <div className="download-progress-backdrop" role="status" aria-live="polite">
            <div className="download-progress-dialog">
                <span className="loading-spinner large" aria-hidden="true" />
                <strong>{isImporting ? 'กำลังนำเข้ารูป' : 'กำลังดาวน์โหลดรูป'}</strong>
                <span>{progress.current} / {progress.total}</span>
                <div className="download-progress-track">
                    <div className="download-progress-fill" style={{ width: `${percent}%` }} />
                </div>
                <span>{percent}%</span>
            </div>
        </div>
    );
}
