import { useEffect, useState } from 'react';
import { Circle, Cpu, MonitorCheck, HardDrive } from 'lucide-react';

interface CameraStatusInfo {
  cameraId: string;
  label: string;
  status: 'connected' | 'reconnecting' | 'offline';
}

interface StatusBarProps {
  cameras: CameraStatusInfo[];
  aiServiceStatus?: 'starting' | 'healthy' | 'unhealthy' | 'stopped';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

const CAMERA_STATUS_COLORS: Record<string, string> = {
  connected: 'text-emerald-400',
  reconnecting: 'text-amber-400',
  offline: 'text-red-400',
};

const CAMERA_STATUS_DOT: Record<string, string> = {
  connected: 'fill-emerald-400 text-emerald-400',
  reconnecting: 'fill-amber-400 text-amber-400 animate-pulse',
  offline: 'fill-red-400 text-red-400',
};

const AI_STATUS_COLORS: Record<string, string> = {
  starting: 'text-amber-400',
  healthy: 'text-emerald-400',
  unhealthy: 'text-red-400',
  stopped: 'text-neutral-500',
};

const AI_STATUS_LABELS: Record<string, string> = {
  starting: 'Starting...',
  healthy: 'Online',
  unhealthy: 'Error',
  stopped: 'Offline',
};

export default function StatusBar({ cameras, aiServiceStatus = 'stopped' }: StatusBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [recordingCount, setRecordingCount] = useState(0);
  const [diskUsageTotal, setDiskUsageTotal] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Poll recording status and disk usage
  useEffect(() => {
    let isMounted = true;

    const fetchRecordingInfo = async () => {
      try {
        if (!window.electronAPI?.recording?.status) return;
        const statuses = await window.electronAPI.recording.status();
        if (!isMounted || !statuses || typeof statuses !== 'object') return;
        const entries = Object.values(statuses as Record<string, { status: string }>);
        setRecordingCount(entries.filter((s) => s.status === 'recording').length);
      } catch { /* ignore */ }

      try {
        if (!window.electronAPI?.recording?.diskUsage) return;
        const usage = await window.electronAPI.recording.diskUsage();
        if (!isMounted) return;
        setDiskUsageTotal(usage.totalBytes);
      } catch { /* ignore */ }
    };

    fetchRecordingInfo();
    const interval = setInterval(fetchRecordingInfo, 10_000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  const connectedCount = cameras.filter((c) => c.status === 'connected').length;

  return (
    <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-900/80 px-4 py-1.5 text-xs backdrop-blur-sm">
      {/* Camera statuses */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-neutral-400">
          <MonitorCheck className="h-3.5 w-3.5" />
          <span>{connectedCount}/{cameras.length} cameras</span>
        </div>

        {cameras.map((cam) => (
          <div key={cam.cameraId} className="flex items-center gap-1">
            <Circle className={`h-2 w-2 ${CAMERA_STATUS_DOT[cam.status] || CAMERA_STATUS_DOT.offline}`} />
            <span className={`${CAMERA_STATUS_COLORS[cam.status] || CAMERA_STATUS_COLORS.offline}`}>
              {cam.cameraId}
            </span>
          </div>
        ))}
      </div>

      {/* Recording + AI service + clock */}
      <div className="flex items-center gap-4">
        {/* Recording status */}
        <div className="flex items-center gap-1.5">
          {recordingCount > 0 ? (
            <>
              <Circle className="h-2 w-2 animate-pulse fill-red-500 text-red-500" />
              <span className="text-red-400">REC {recordingCount}</span>
            </>
          ) : (
            <>
              <Circle className="h-2 w-2 fill-neutral-600 text-neutral-600" />
              <span className="text-neutral-500">REC off</span>
            </>
          )}
          {diskUsageTotal > 0 && (
            <span className="flex items-center gap-0.5 text-neutral-500">
              <HardDrive className="h-3 w-3" />
              {formatBytes(diskUsageTotal)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Cpu className={`h-3.5 w-3.5 ${AI_STATUS_COLORS[aiServiceStatus]}`} />
          <span className={AI_STATUS_COLORS[aiServiceStatus]}>
            AI: {AI_STATUS_LABELS[aiServiceStatus]}
          </span>
        </div>

        <span className="text-neutral-500">
          {currentTime.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
