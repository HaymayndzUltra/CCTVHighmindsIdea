import { useEffect, useState, useCallback } from 'react';
import CameraGrid from '../../components/CameraGrid/CameraGrid';
import type { LayoutMode } from '../../components/CameraGrid/CameraGrid';
import LayoutSelector from '../../components/LayoutSelector/LayoutSelector';
import StatusBar from '../../components/StatusBar/StatusBar';
import PresencePanel from '../../components/PresencePanel/PresencePanel';

interface CameraInfo {
  id: string;
  label: string;
  model: string;
  hasPtz: boolean;
  enabled: boolean;
}

interface FullscreenCamera {
  cameraId: string;
  label: string;
  model: string;
  hasPtz: boolean;
}

interface DashboardProps {
  onOpenFullscreen?: (camera: FullscreenCamera) => void;
}

interface SystemStatusPush {
  cameras: Array<{ cameraId: string; status: 'connected' | 'reconnecting' | 'offline'; fps: number }>;
  aiService: { status: 'starting' | 'healthy' | 'unhealthy' | 'stopped'; uptime: number };
}

export default function Dashboard({ onOpenFullscreen }: DashboardProps) {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [layout, setLayout] = useState<LayoutMode>('2x2');
  const [miniPtzEnabled, setMiniPtzEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [systemStatus, setSystemStatus] = useState<SystemStatusPush | null>(null);

  // Load cameras and saved layout on mount
  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        // Fetch camera list from main process
        if (window.electronAPI?.camera?.list) {
          const cameraList = await window.electronAPI.camera.list();
          if (isMounted) {
            setCameras(
              cameraList
                .filter((c) => c.enabled)
                .map((c) => ({ id: c.id, label: c.label, model: c.model, hasPtz: c.hasPtz, enabled: c.enabled }))
            );
          }
        }

        // Restore saved layout
        if (window.electronAPI?.settings?.get) {
          const result = await window.electronAPI.settings.get('default_layout');
          if (isMounted && result?.value) {
            const savedLayout = result.value as LayoutMode;
            if (['1x1', '2x2', '3x1', 'custom'].includes(savedLayout)) {
              setLayout(savedLayout);
            }
          }

          const ptzResult = await window.electronAPI.settings.get('mini_ptz_enabled');
          if (isMounted && ptzResult?.value) {
            setMiniPtzEnabled(ptzResult.value === 'true');
          }
        }
      } catch (error) {
        console.error('[Dashboard] Failed to initialize:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    init();
    return () => { isMounted = false; };
  }, []);

  // Streams are auto-started by the main process after go2rtc is ready.
  // Dashboard only displays frames — no start/stop lifecycle here.
  // This ensures streams persist across navigation (Dashboard ↔ Fullscreen ↔ Settings).

  // Handle layout change with persistence
  const handleLayoutChange = useCallback(async (newLayout: LayoutMode) => {
    setLayout(newLayout);
    try {
      if (window.electronAPI?.settings?.set) {
        await window.electronAPI.settings.set('default_layout', newLayout);
      }
    } catch (error) {
      console.error('[Dashboard] Failed to persist layout:', error);
    }
  }, []);

  // Subscribe to real-time system:status push from main process
  useEffect(() => {
    if (!window.electronAPI?.system?.onStatus) {
      return;
    }

    const unsubscribe = window.electronAPI.system.onStatus((data) => {
      setSystemStatus(data as SystemStatusPush);
    });

    return () => { unsubscribe(); };
  }, []);

  // Build status bar camera data from real-time system status push
  const cameraStatuses = cameras.map((cam) => {
    const live = systemStatus?.cameras?.find((c) => c.cameraId === cam.id);
    return {
      cameraId: cam.id,
      label: cam.label,
      status: live?.status ?? ('offline' as const),
    };
  });

  const aiServiceStatus = systemStatus?.aiService?.status ?? 'stopped';

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Loading cameras...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <h1 className="text-lg font-semibold text-neutral-100">Live View</h1>
        <LayoutSelector activeLayout={layout} onLayoutChange={handleLayoutChange} />
      </div>

      {/* Camera Grid */}
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        {cameras.length > 0 ? (
          <CameraGrid
            cameras={cameras}
            layout={layout}
            miniPtzEnabled={miniPtzEnabled}
            onSelectCamera={(cameraId) => {
              const cam = cameras.find((c) => c.id === cameraId);
              if (cam && onOpenFullscreen) {
                onOpenFullscreen({
                  cameraId: cam.id,
                  label: cam.label,
                  model: cam.model,
                  hasPtz: cam.hasPtz,
                });
              }
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-neutral-700 text-neutral-500">
            No cameras configured. Go to Settings to add cameras.
          </div>
        )}
      </div>

      {/* Presence Panel — horizontal scroll strip below camera grid */}
      <PresencePanel />

      {/* Status Bar */}
      <StatusBar cameras={cameraStatuses} aiServiceStatus={aiServiceStatus} />
    </div>
  );
}
