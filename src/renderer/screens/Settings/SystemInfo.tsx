import { useState, useEffect, useCallback } from 'react';
import { Monitor, RefreshCw, Loader2 } from 'lucide-react';

interface SystemStatusData {
  aiServiceStatus: 'starting' | 'healthy' | 'unhealthy' | 'stopped';
  gpuEnabled: boolean;
  camerasConnected: number;
  totalEvents: number;
  dbFileSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${units[i]}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'text-emerald-400';
    case 'starting':
      return 'text-amber-400';
    case 'unhealthy':
      return 'text-red-400';
    case 'stopped':
      return 'text-neutral-500';
    default:
      return 'text-neutral-500';
  }
}

function statusDot(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-400';
    case 'starting':
      return 'bg-amber-400';
    case 'unhealthy':
      return 'bg-red-400';
    case 'stopped':
      return 'bg-neutral-500';
    default:
      return 'bg-neutral-500';
  }
}

export default function SystemInfo() {
  const [status, setStatus] = useState<SystemStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadStatus = useCallback(async (isRefresh = false) => {
    try {
      if (!window.electronAPI?.system?.getStatus) return;

      if (isRefresh) {
        setIsRefreshing(true);
      }

      const result = await window.electronAPI.system.getStatus();
      setStatus(result as SystemStatusData);
    } catch (error) {
      console.error('[SystemInfo] Failed to load system status:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2 text-sm">Loading system info...</span>
      </div>
    );
  }

  const rows: { label: string; value: string; statusKey?: string }[] = status
    ? [
        {
          label: 'AI Service',
          value: status.aiServiceStatus.charAt(0).toUpperCase() + status.aiServiceStatus.slice(1),
          statusKey: status.aiServiceStatus,
        },
        {
          label: 'GPU Acceleration',
          value: status.gpuEnabled ? 'Enabled' : 'Disabled (CPU mode)',
        },
        {
          label: 'AI Model',
          value: 'buffalo_l (InsightFace)',
        },
        {
          label: 'Cameras Connected',
          value: String(status.camerasConnected),
        },
        {
          label: 'Total Events',
          value: status.totalEvents.toLocaleString(),
        },
        {
          label: 'Database Size',
          value: formatBytes(status.dbFileSize),
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor size={18} className="text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-200">System Information</h3>
        </div>
        <button
          onClick={() => loadStatus(true)}
          disabled={isRefreshing}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
          aria-label="Refresh system info"
        >
          <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <div className="space-y-2.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-xs text-neutral-500">{row.label}</span>
              <div className="flex items-center gap-1.5">
                {row.statusKey && (
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot(row.statusKey)}`} />
                )}
                <span className={`text-xs font-medium ${row.statusKey ? statusColor(row.statusKey) : 'text-neutral-200'}`}>
                  {row.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
