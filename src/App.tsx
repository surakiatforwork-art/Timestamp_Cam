import './App.css';
import { useApp } from './context/AppContext';
import Topbar from './components/Topbar/Topbar';
import Stage from './components/Stage/Stage';
import BottomControls from './components/BottomControls/BottomControls';
import Toast from './components/common/Toast';
import PreviewModal from './components/modals/PreviewModal';
import SettingsModal from './components/modals/SettingsModal';
import MapModal from './components/modals/MapModal';
import TrashModal from './components/modals/TrashModal';
import DownloadProgressModal from './components/common/DownloadProgressModal';
import TrashReminder from './components/common/TrashReminder';

function App() {
    const { state, retryPhotoStorage } = useApp();

    if (state.storageStatus !== 'ready') {
        return (
            <div className="app">
                <div className="download-progress-backdrop" role="dialog" aria-modal="true" aria-labelledby="storage-title">
                    <div className="download-progress-dialog">
                        {state.storageStatus === 'loading' ? (
                            <>
                                <span className="loading-spinner large" aria-hidden="true" />
                                <strong id="storage-title">กำลังเปิดคลังภาพ</strong>
                            </>
                        ) : (
                            <>
                                <strong id="storage-title">เปิดคลังภาพไม่สำเร็จ</strong>
                                <p>ยังอ่านข้อมูลภาพไม่ได้ กรุณาลองอีกครั้งและตรวจสอบพื้นที่ว่างในเครื่อง</p>
                                <button className="btn btn-primary" onClick={retryPhotoStorage}>ลองอีกครั้ง</button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app">
            <Topbar />
            <Stage />
            <BottomControls />

            <Toast />
            <DownloadProgressModal />
            <TrashReminder />

            {state.activeModal === 'preview' && <PreviewModal />}
            {state.activeModal === 'settings' && <SettingsModal />}
            {state.activeModal === 'map' && <MapModal />}
            {state.activeModal === 'trash' && <TrashModal />}
        </div>
    );
}

export default App;
