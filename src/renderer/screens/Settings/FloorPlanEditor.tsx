import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Upload, Map, Loader2, Camera, Move } from 'lucide-react';

interface CameraPosition {
  id: string;
  label: string;
  floorX: number | null;
  floorY: number | null;
  fovDeg: number | null;
  rotationDeg: number | null;
}

interface FloorPlanData {
  imagePath: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  scaleMetersPerPixel: number | null;
  cameras: CameraPosition[];
}

export default function FloorPlanEditor() {
  const [floorPlan, setFloorPlan] = useState<FloorPlanData | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraPosition[]>([]);
  const [draggingCamera, setDraggingCamera] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      if (!window.electronAPI?.floorplan?.get) return;

      const data = await window.electronAPI.floorplan.get();
      if (data) {
        setFloorPlan(data);
        setCameras(data.cameras ?? []);
        if (data.imagePath) {
          setImagePreview(data.imagePath);
        }
      } else {
        // Load cameras even without floor plan
        if (window.electronAPI?.camera?.list) {
          const cameraList = await window.electronAPI.camera.list();
          setCameras(
            (cameraList ?? []).map((c) => ({
              id: c.id,
              label: c.label,
              floorX: null,
              floorY: null,
              fovDeg: null,
              rotationDeg: null,
            }))
          );
        }
      }
    } catch (error) {
      console.error('[FloorPlanEditor] Failed to load:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImagePreview(dataUrl);

      const img = new Image();
      img.onload = () => {
        setFloorPlan((prev) => ({
          ...(prev ?? { imagePath: null, imageWidth: null, imageHeight: null, scaleMetersPerPixel: null, cameras: [] }),
          imagePath: dataUrl,
          imageWidth: img.width,
          imageHeight: img.height,
        }));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggingCamera || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setCameras((prev) =>
      prev.map((c) =>
        c.id === draggingCamera ? { ...c, floorX: Math.round(x * 10) / 10, floorY: Math.round(y * 10) / 10 } : c
      )
    );
    setDraggingCamera(null);
  };

  const handleSave = async () => {
    if (!window.electronAPI?.floorplan?.save) return;

    setIsSaving(true);
    setStatusMessage(null);

    try {
      await window.electronAPI.floorplan.save({
        imagePath: floorPlan?.imagePath ?? imagePreview,
        imageWidth: floorPlan?.imageWidth,
        imageHeight: floorPlan?.imageHeight,
        scaleMetersPerPixel: floorPlan?.scaleMetersPerPixel,
        cameras: cameras.map((c) => ({
          id: c.id,
          label: c.label,
          floorX: c.floorX,
          floorY: c.floorY,
          fovDeg: c.fovDeg,
          rotationDeg: c.rotationDeg,
        })),
      });

      setStatusMessage({ type: 'success', text: 'Floor plan saved.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage({ type: 'error', text: `Save failed: ${message}` });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2 text-sm">Loading floor plan...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Map size={18} className="text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-200">Floor Plan Editor</h3>
        </div>
        <label className="flex cursor-pointer items-center gap-1 rounded bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-700">
          <Upload size={12} />
          Upload Image
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </label>
      </div>

      <p className="text-xs text-neutral-500">
        Upload a floor plan image and drag cameras to their positions. Positions are stored as percentage coordinates.
      </p>

      {/* Floor Plan Canvas */}
      <div
        ref={canvasRef}
        onClick={handleCanvasClick}
        className={`relative min-h-[400px] rounded-lg border bg-neutral-900/50 overflow-hidden ${
          draggingCamera ? 'cursor-crosshair border-primary-500' : 'border-neutral-700'
        }`}
      >
        {imagePreview ? (
          <img
            src={imagePreview}
            alt="Floor plan"
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex h-full min-h-[400px] items-center justify-center">
            <div className="text-center">
              <Map size={32} className="mx-auto mb-2 text-neutral-600" />
              <p className="text-sm text-neutral-500">No floor plan uploaded.</p>
              <p className="text-xs text-neutral-600">Upload an image to get started.</p>
            </div>
          </div>
        )}

        {/* Camera markers */}
        {cameras
          .filter((c) => c.floorX !== null && c.floorY !== null)
          .map((cam) => (
            <div
              key={cam.id}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ left: `${cam.floorX}%`, top: `${cam.floorY}%` }}
            >
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-primary-600 shadow-lg"
                title={cam.label}
              >
                <Camera size={12} className="text-white" />
              </div>
              <span className="mt-0.5 rounded bg-black/60 px-1 text-[9px] font-medium text-white">
                {cam.label}
              </span>
            </div>
          ))}

        {draggingCamera && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <p className="rounded bg-black/60 px-3 py-1.5 text-xs text-white">
              Click to place {cameras.find((c) => c.id === draggingCamera)?.label ?? 'camera'}
            </p>
          </div>
        )}
      </div>

      {/* Camera Position List */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
        <h4 className="mb-2 text-xs font-medium text-neutral-400">Camera Positions</h4>
        <div className="space-y-1.5">
          {cameras.map((cam) => (
            <div key={cam.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera size={12} className="text-neutral-500" />
                <span className="text-xs text-neutral-300">{cam.label}</span>
                {cam.floorX !== null && cam.floorY !== null && (
                  <span className="text-[10px] text-neutral-500">
                    ({cam.floorX.toFixed(1)}%, {cam.floorY.toFixed(1)}%)
                  </span>
                )}
              </div>
              <button
                onClick={() => setDraggingCamera(cam.id)}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors ${
                  draggingCamera === cam.id
                    ? 'bg-primary-600/20 text-primary-400'
                    : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'
                }`}
              >
                <Move size={10} />
                {cam.floorX !== null ? 'Reposition' : 'Place'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center justify-between pt-1">
        <div>
          {statusMessage && (
            <span
              className={`text-xs ${statusMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}
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
          Save Floor Plan
        </button>
      </div>
    </div>
  );
}
