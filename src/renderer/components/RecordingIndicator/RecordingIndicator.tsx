import { useEffect, useState } from 'react';
import { Circle } from 'lucide-react';

/**
 * RecordingIndicator — shows recording status badge on camera views.
 *
 * - Red pulsing dot + "REC" when recording
 * - Gray dot + "OFF" when stopped
 * - Optional disk usage display
 */

interface RecordingIndicatorProps {
  cameraId: string;
  showDiskUsage?: boolean;
  compact?: boolean;
}

type RecordingStatus = 'recording' | 'stopped' | 'error';

interface StatusInfo {
  status: RecordingStatus;
  mode: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function RecordingIndicator({
  cameraId,
  showDiskUsage = false,
  compact = false,
}: RecordingIndicatorProps) {
  const [statusInfo, setStatusInfo] = useState<StatusInfo>({
    status: 'stopped',
    mode: 'off',
  });
  const [diskUsageBytes, setDiskUsageBytes] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;

    const fetchStatus = async () => {
      try {
        if (!window.electronAPI?.recording?.status) return;
        const result = await window.electronAPI.recording.status(cameraId);
        if (!isMounted) return;
        if (result && typeof result === 'object' && 'status' in result) {
          setStatusInfo(result as StatusInfo);
        }
      } catch {
        /* ignore */
      }
    };

    const fetchDiskUsage = async () => {
      if (!showDiskUsage) return;
      try {
        if (!window.electronAPI?.recording?.diskUsage) return;
        const usage = await window.electronAPI.recording.diskUsage();
        if (!isMounted) return;
        setDiskUsageBytes(usage.perCamera[cameraId] ?? 0);
      } catch {
        /* ignore */
      }
    };

    fetchStatus();
    fetchDiskUsage();

    const interval = setInterval(() => {
      fetchStatus();
      if (showDiskUsage) fetchDiskUsage();
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [cameraId, showDiskUsage]);

  const isRecording = statusInfo.status === 'recording';
  const isError = statusInfo.status === 'error';

  if (compact) {
    return (
      <div
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold backdrop-blur-sm ${
          isRecording
            ? 'bg-red-600/80 text-white'
            : isError
              ? 'bg-amber-600/80 text-white'
              : 'bg-neutral-800/60 text-neutral-500'
        }`}
        title={`Recording: ${statusInfo.status} (${statusInfo.mode})`}
      >
        <Circle
          className={`h-1.5 w-1.5 fill-current ${isRecording ? 'animate-pulse' : ''}`}
        />
        {isRecording ? 'REC' : isError ? 'ERR' : 'OFF'}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium backdrop-blur-sm ${
        isRecording
          ? 'bg-red-600/80 text-white'
          : isError
            ? 'bg-amber-600/80 text-white'
            : 'bg-neutral-800/60 text-neutral-500'
      }`}
      title={`Recording: ${statusInfo.status} (${statusInfo.mode})`}
    >
      <Circle
        className={`h-2 w-2 fill-current ${isRecording ? 'animate-pulse' : ''}`}
      />
      <span>{isRecording ? 'REC' : isError ? 'ERROR' : 'OFF'}</span>
      {showDiskUsage && diskUsageBytes > 0 && (
        <span className="ml-1 text-[10px] opacity-70">
          {formatBytes(diskUsageBytes)}
        </span>
      )}
    </div>
  );
}
