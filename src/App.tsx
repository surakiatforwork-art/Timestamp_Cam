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

function App() {
    const { state } = useApp();

    return (
        <div className="app">
            <Topbar />
            <Stage />
            <BottomControls />

            <Toast />
            <DownloadProgressModal />

            {state.activeModal === 'preview' && <PreviewModal />}
            {state.activeModal === 'settings' && <SettingsModal />}
            {state.activeModal === 'map' && <MapModal />}
            {state.activeModal === 'trash' && <TrashModal />}
        </div>
    );
}

export default App;
