import { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, Camera, Loader2 } from 'lucide-react';

interface CameraConfig {
  id: string;
  label: string;
  ipAddress: string;
  model: string;
  rtspUrl: string;
  hasPtz: boolean;
  enabled: boolean;
  motionSensitivity: number;
}

interface EditableFields {
  label: string;
  ipAddress: string;
  model: string;
  rtspUrl: string;
  enabled: boolean;
}

export default function CameraManagement() {
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  const [editState, setEditState] = useState<Record<string, EditableFields>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ id: string; type: 'success' | 'error'; text: string } | null>(null);

  const loadCameras = useCallback(async () => {
    try {
      if (window.electronAPI?.camera?.list) {
        const cameraList = await window.electronAPI.camera.list();
        setCameras(
          cameraList.map((c) => ({
            id: c.id,
            label: c.label,
            ipAddress: c.ipAddress,
            model: c.model,
            rtspUrl: c.rtspUrl,
            hasPtz: c.hasPtz,
            enabled: c.enabled,
            motionSensitivity: c.motionSensitivity,
          }))
        );

        const initialEdits: Record<string, EditableFields> = {};
        for (const c of cameraList) {
          initialEdits[c.id] = {
            label: c.label,
            ipAddress: c.ipAddress,
            model: c.model,
            rtspUrl: c.rtspUrl,
            enabled: c.enabled,
          };
        }
        setEditState(initialEdits);
      }
    } catch (error) {
      console.error('[CameraManagement] Failed to load cameras:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCameras();
  }, [loadCameras]);

  const handleFieldChange = (cameraId: string, field: keyof EditableFields, value: string | boolean) => {
    setEditState((prev) => ({
      ...prev,
      [cameraId]: {
        ...prev[cameraId],
        [field]: value,
      },
    }));
  };

  const handleReset = (cameraId: string) => {
    const original = cameras.find((c) => c.id === cameraId);
    if (!original) {
      return;
    }
    setEditState((prev) => ({
      ...prev,
      [cameraId]: {
        label: original.label,
        ipAddress: original.ipAddress,
        model: original.model,
        rtspUrl: original.rtspUrl,
        enabled: original.enabled,
      },
    }));
    setStatusMessage(null);
  };

  const handleSave = async (cameraId: string) => {
    const edits = editState[cameraId];
    if (!edits) {
      return;
    }

    setSavingId(cameraId);
    setStatusMessage(null);

    try {
      if (window.electronAPI?.camera?.update) {
        await window.electronAPI.camera.update(cameraId, {
          label: edits.label,
          ipAddress: edits.ipAddress,
          model: edits.model,
          rtspUrl: edits.rtspUrl,
          enabled: edits.enabled,
        });

        setStatusMessage({ id: cameraId, type: 'success', text: 'Saved successfully' });
        await loadCameras();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[CameraManagement] Save failed for ${cameraId}:`, message);
      setStatusMessage({ id: cameraId, type: 'error', text: `Save failed: ${message}` });
    } finally {
      setSavingId(null);
    }
  };

  const hasChanges = (cameraId: string): boolean => {
    const original = cameras.find((c) => c.id === cameraId);
    const edits = editState[cameraId];
    if (!original || !edits) {
      return false;
    }
    return (
      original.label !== edits.label ||
      original.ipAddress !== edits.ipAddress ||
      original.model !== edits.model ||
      original.rtspUrl !== edits.rtspUrl ||
      original.enabled !== edits.enabled
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2 text-sm">Loading cameras...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Camera size={18} className="text-neutral-400" />
        <h3 className="text-sm font-semibold text-neutral-200">Camera Management</h3>
      </div>

      {cameras.length === 0 ? (
        <p className="text-sm text-neutral-500">No cameras configured.</p>
      ) : (
        <div className="space-y-3">
          {cameras.map((camera) => {
            const edits = editState[camera.id];
            if (!edits) {
              return null;
            }

            const isChanged = hasChanges(camera.id);
            const isSaving = savingId === camera.id;
            const status = statusMessage?.id === camera.id ? statusMessage : null;

            return (
              <div
                key={camera.id}
                className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-100">{camera.id}</span>
                    {camera.hasPtz && (
                      <span className="rounded bg-primary-600/20 px-1.5 py-0.5 text-[10px] font-medium text-primary-400">
                        PTZ
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                      <input
                        type="checkbox"
                        checked={edits.enabled}
                        onChange={(e) => handleFieldChange(camera.id, 'enabled', e.target.checked)}
                        className="rounded border-neutral-600 bg-neutral-800"
                      />
                      Enabled
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-neutral-500">Label</label>
                    <input
                      type="text"
                      value={edits.label}
                      onChange={(e) => handleFieldChange(camera.id, 'label', e.target.value)}
                      className="w-full rounded bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-500">IP Address</label>
                    <input
                      type="text"
                      value={edits.ipAddress}
                      onChange={(e) => handleFieldChange(camera.id, 'ipAddress', e.target.value)}
                      className="w-full rounded bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-500">Model</label>
                    <input
                      type="text"
                      value={edits.model}
                      onChange={(e) => handleFieldChange(camera.id, 'model', e.target.value)}
                      className="w-full rounded bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-500">RTSP URL</label>
                    <input
                      type="text"
                      value={edits.rtspUrl}
                      onChange={(e) => handleFieldChange(camera.id, 'rtspUrl', e.target.value)}
                      className="w-full rounded bg-neutral-800 px-2.5 py-1.5 text-sm font-mono text-neutral-200 outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-3 flex items-center justify-between">
                  <div>
                    {status && (
                      <span
                        className={`text-xs ${status.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {status.text}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReset(camera.id)}
                      disabled={!isChanged || isSaving}
                      className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <RotateCcw size={12} />
                      Reset
                    </button>
                    <button
                      onClick={() => handleSave(camera.id)}
                      disabled={!isChanged || isSaving}
                      className="flex items-center gap-1 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isSaving ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Save size={12} />
                      )}
                      Save
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
