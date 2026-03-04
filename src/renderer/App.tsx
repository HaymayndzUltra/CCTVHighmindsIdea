import { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './screens/Dashboard/Dashboard';
import EventLog from './screens/EventLog/EventLog';
import PersonDirectory from './screens/PersonDirectory/PersonDirectory';
import Settings from './screens/Settings/Settings';
import CameraFullscreenView from './screens/CameraFullscreenView/CameraFullscreenView';
import ZoneEditor from './screens/ZoneEditor/ZoneEditor';
import Analytics from './screens/Analytics/Analytics';
import FloorPlan from './screens/FloorPlan/FloorPlan';
import SituationRoom from './screens/SituationRoom/SituationRoom';
import ErrorBoundary from './components/ErrorBoundary';

type Screen = 'dashboard' | 'event-log' | 'person-directory' | 'zone-editor' | 'analytics' | 'floor-plan' | 'situation-room' | 'settings';

interface FullscreenCamera {
  cameraId: string;
  label: string;
  model: string;
  hasPtz: boolean;
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>('dashboard');
  const [fullscreenCamera, setFullscreenCamera] = useState<FullscreenCamera | null>(null);

  const handleOpenFullscreen = useCallback((camera: FullscreenCamera) => {
    setFullscreenCamera(camera);
  }, []);

  const handleCloseFullscreen = useCallback(() => {
    setFullscreenCamera(null);
  }, []);

  const renderOtherScreen = () => {
    switch (activeScreen) {
      case 'event-log':
        return <EventLog />;
      case 'person-directory':
        return <PersonDirectory />;
      case 'zone-editor':
        return <ZoneEditor />;
      case 'analytics':
        return <Analytics />;
      case 'floor-plan':
        return <ErrorBoundary fallbackTitle="Floor Plan failed to load"><FloorPlan onOpenFullscreen={handleOpenFullscreen} /></ErrorBoundary>;
      case 'situation-room':
        return <ErrorBoundary fallbackTitle="Situation Room failed to load"><SituationRoom /></ErrorBoundary>;
      case 'settings':
        return <Settings />;
      default:
        return null;
    }
  };

  if (fullscreenCamera) {
    return (
      <CameraFullscreenView
        cameraId={fullscreenCamera.cameraId}
        cameraLabel={fullscreenCamera.label}
        cameraModel={fullscreenCamera.model}
        hasPtz={fullscreenCamera.hasPtz}
        onBack={handleCloseFullscreen}
      />
    );
  }

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-100">
      <Sidebar activeScreen={activeScreen} onNavigate={setActiveScreen} />
      <main className="flex-1 overflow-hidden relative">
        {/* Dashboard always mounted to keep WebRTC streams alive across navigation */}
        <div className={`h-full ${activeScreen === 'dashboard' ? '' : 'hidden'}`}>
          <Dashboard onOpenFullscreen={handleOpenFullscreen} />
        </div>
        {/* Other screens mount/unmount normally */}
        {activeScreen !== 'dashboard' && (
          <div className="h-full overflow-auto">
            {renderOtherScreen()}
          </div>
        )}
      </main>
    </div>
  );
}
