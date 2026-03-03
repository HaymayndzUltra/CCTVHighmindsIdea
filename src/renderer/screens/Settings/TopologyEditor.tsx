import { useState, useEffect, useCallback } from 'react';
import { Save, Plus, Trash2, Network, Loader2, ArrowRight } from 'lucide-react';

interface TopologyEdge {
  id: string;
  fromCameraId: string;
  toCameraId: string;
  transitMinSec: number;
  transitMaxSec: number;
  direction: 'inbound' | 'outbound' | 'bidirectional' | '';
  enabled: boolean;
}

interface CameraOption {
  id: string;
  label: string;
}

const DIRECTION_OPTIONS = [
  { value: 'bidirectional', label: 'Bidirectional' },
  { value: 'outbound', label: 'Outbound →' },
  { value: 'inbound', label: '← Inbound' },
];

export default function TopologyEditor() {
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      if (!window.electronAPI?.topology?.get || !window.electronAPI?.camera?.list) return;

      const [edgeData, cameraData] = await Promise.all([
        window.electronAPI.topology.get(),
        window.electronAPI.camera.list(),
      ]);

      setEdges(
        (edgeData?.edges ?? []).map((e) => ({
          id: e.id,
          fromCameraId: e.fromCameraId,
          toCameraId: e.toCameraId,
          transitMinSec: e.transitMinSec,
          transitMaxSec: e.transitMaxSec,
          direction: (e.direction as TopologyEdge['direction']) ?? 'bidirectional',
          enabled: e.enabled !== false,
        }))
      );

      setCameras(
        (cameraData ?? []).map((c) => ({
          id: String(c.id ?? ''),
          label: String(c.label ?? c.id ?? ''),
        }))
      );
    } catch (error) {
      console.error('[TopologyEditor] Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddEdge = () => {
    if (cameras.length < 2) return;

    const newEdge: TopologyEdge = {
      id: crypto.randomUUID(),
      fromCameraId: cameras[0]?.id ?? '',
      toCameraId: cameras[1]?.id ?? '',
      transitMinSec: 5,
      transitMaxSec: 30,
      direction: 'bidirectional',
      enabled: true,
    };

    setEdges((prev) => [...prev, newEdge]);
  };

  const handleRemoveEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
  };

  const handleEdgeChange = (edgeId: string, field: keyof TopologyEdge, value: unknown) => {
    setEdges((prev) =>
      prev.map((e) => (e.id === edgeId ? { ...e, [field]: value } : e))
    );
  };

  const handleSave = async () => {
    if (!window.electronAPI?.topology?.save) return;

    setIsSaving(true);
    setStatusMessage(null);

    try {
      await window.electronAPI.topology.save(
        edges.map((e) => ({
          id: e.id,
          fromCameraId: e.fromCameraId,
          toCameraId: e.toCameraId,
          transitMinSec: e.transitMinSec,
          transitMaxSec: e.transitMaxSec,
          direction: (e.direction || 'bidirectional') as 'inbound' | 'outbound' | 'bidirectional',
          enabled: e.enabled,
          createdAt: new Date().toISOString(),
        }))
      );

      setStatusMessage({ type: 'success', text: 'Topology saved successfully.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[TopologyEditor] Save failed:', message);
      setStatusMessage({ type: 'error', text: `Save failed: ${message}` });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2 text-sm">Loading topology...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network size={18} className="text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-200">Camera Topology</h3>
        </div>
        <button
          onClick={handleAddEdge}
          disabled={cameras.length < 2}
          className="flex items-center gap-1 rounded bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} />
          Add Edge
        </button>
      </div>

      <p className="text-xs text-neutral-500">
        Define directional connections between cameras with expected transit times.
        Used for journey tracking, anomaly detection, and predictive camera handoff.
      </p>

      {edges.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-700 p-8 text-center">
          <Network size={24} className="mx-auto mb-2 text-neutral-600" />
          <p className="text-sm text-neutral-500">No topology edges defined.</p>
          <p className="text-xs text-neutral-600">
            Add edges to connect cameras and enable cross-camera intelligence.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {edges.map((edge) => (
            <div
              key={edge.id}
              className={`rounded-lg border p-3 transition-colors ${
                edge.enabled
                  ? 'border-neutral-700 bg-neutral-900/50'
                  : 'border-neutral-800 bg-neutral-900/20 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* From Camera */}
                <select
                  value={edge.fromCameraId}
                  onChange={(e) => handleEdgeChange(edge.id, 'fromCameraId', e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
                >
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>

                <ArrowRight size={14} className="text-neutral-500 shrink-0" />

                {/* To Camera */}
                <select
                  value={edge.toCameraId}
                  onChange={(e) => handleEdgeChange(edge.id, 'toCameraId', e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
                >
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>

                {/* Direction */}
                <select
                  value={edge.direction}
                  onChange={(e) =>
                    handleEdgeChange(edge.id, 'direction', e.target.value)
                  }
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
                >
                  {DIRECTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {/* Transit Min */}
                <div className="flex items-center gap-1">
                  <label className="text-[10px] text-neutral-500 whitespace-nowrap">Min</label>
                  <input
                    type="number"
                    min={0}
                    value={edge.transitMinSec}
                    onChange={(e) =>
                      handleEdgeChange(edge.id, 'transitMinSec', parseInt(e.target.value, 10) || 0)
                    }
                    className="w-14 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-neutral-600">s</span>
                </div>

                {/* Transit Max */}
                <div className="flex items-center gap-1">
                  <label className="text-[10px] text-neutral-500 whitespace-nowrap">Max</label>
                  <input
                    type="number"
                    min={0}
                    value={edge.transitMaxSec}
                    onChange={(e) =>
                      handleEdgeChange(edge.id, 'transitMaxSec', parseInt(e.target.value, 10) || 0)
                    }
                    className="w-14 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-neutral-600">s</span>
                </div>

                {/* Enabled Toggle */}
                <button
                  onClick={() => handleEdgeChange(edge.id, 'enabled', !edge.enabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                    edge.enabled ? 'bg-primary-600' : 'bg-neutral-700'
                  }`}
                  role="switch"
                  aria-checked={edge.enabled}
                  aria-label={`Toggle edge ${edge.fromCameraId} to ${edge.toCameraId}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      edge.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>

                {/* Delete */}
                <button
                  onClick={() => handleRemoveEdge(edge.id)}
                  className="rounded p-1 text-neutral-500 transition-colors hover:bg-red-900/20 hover:text-red-400"
                  aria-label={`Remove edge ${edge.fromCameraId} to ${edge.toCameraId}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save */}
      <div className="flex items-center justify-between pt-2">
        <div>
          {statusMessage && (
            <span
              className={`text-xs ${
                statusMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {statusMessage.text}
            </span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save Topology
        </button>
      </div>
    </div>
  );
}
