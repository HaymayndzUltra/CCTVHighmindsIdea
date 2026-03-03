import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Camera, Image, X, Loader2, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { useWebRTCStream } from '../../hooks/useWebRTCStream';

type TabId = 'upload' | 'capture' | 'event';

interface EnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEnroll: (data: {
    personName: string;
    label?: string;
    imageData: string[];
    source: 'upload' | 'capture' | 'event';
  }) => Promise<{ success: boolean; embeddingsCount: number; errors: string[] }>;
}

interface ImagePreview {
  id: string;
  dataUrl: string;
  base64: string;
  name: string;
}

interface CameraOption {
  id: string;
  label: string;
}

interface EventSnapshot {
  id: string;
  personName: string;
  snapshotPath: string;
  createdAt: string;
  confidence: number;
}

const TABS: { id: TabId; label: string; icon: typeof Upload }[] = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'capture', label: 'Capture', icon: Camera },
  { id: 'event', label: 'From Event', icon: Image },
];

function CaptureTab({
  cameras,
  onCapture,
  disabled,
}: {
  cameras: CameraOption[];
  onCapture: (img: ImagePreview) => void;
  disabled: boolean;
}) {
  const [selectedCameraId, setSelectedCameraId] = useState(cameras[0]?.id ?? '');
  const { videoRef, connectionStatus, retry } = useWebRTCStream(selectedCameraId);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      onCapture({
        id: `cap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        dataUrl,
        base64,
        name: `capture-${Date.now()}.jpg`,
      });
    }
  }, [videoRef, onCapture]);

  if (cameras.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/30 p-4">
        <Camera size={28} className="text-neutral-500" />
        <p className="text-sm text-neutral-400">No cameras configured</p>
      </div>
    );
  }

  const isConnected = connectionStatus === 'connected';
  const isFailed = connectionStatus === 'failed' || connectionStatus === 'fallback';

  return (
    <div className="flex flex-col gap-3">
      <select
        value={selectedCameraId}
        onChange={(e) => setSelectedCameraId(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        {cameras.map((cam) => (
          <option key={cam.id} value={cam.id}>
            {cam.label || cam.id}
          </option>
        ))}
      </select>

      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-neutral-700 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${isConnected ? 'block' : 'hidden'}`}
        />
        {!isConnected && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500">
            {isFailed ? (
              <>
                <Camera size={24} className="text-neutral-600" />
                <p className="text-xs text-neutral-500">Stream unavailable</p>
                <button
                  onClick={retry}
                  className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
                >
                  <RefreshCw size={12} /> Retry
                </button>
              </>
            ) : (
              <>
                <Loader2 size={22} className="animate-spin" />
                <p className="text-xs">Connecting to stream...</p>
              </>
            )}
          </div>
        )}
        {isConnected && (
          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-[10px] text-emerald-400 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Live
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <button
        onClick={handleCapture}
        disabled={!isConnected || disabled}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Camera size={14} />
        Capture Face
      </button>
    </div>
  );
}

function FromEventTab({
  selectedImageIds,
  onSelect,
  disabled,
}: {
  selectedImageIds: string[];
  onSelect: (img: ImagePreview) => void;
  disabled: boolean;
}) {
  const [snapshots, setSnapshots] = useState<EventSnapshot[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      try {
        const result = await window.electronAPI.events.list({
          limit: 30,
          offset: 0,
        });
        const eventsArr = result as Array<{
          id: string;
          personName: string;
          snapshotPath: string | null;
          createdAt: string;
          confidence: number;
        }>;
        const withSnapshots = eventsArr.filter((e) => e.snapshotPath) as EventSnapshot[];
        if (isMounted) setSnapshots(withSnapshots);

        for (const evt of withSnapshots) {
          if (!isMounted) break;
          try {
            const b64 = await window.electronAPI.events.snapshotBase64(evt.snapshotPath);
            if (b64 && isMounted) {
              setThumbnails((prev) => ({ ...prev, [evt.id]: `data:image/jpeg;base64,${b64}` }));
            }
          } catch { /* ignore */ }
        }
      } catch (err) {
        console.error('[FromEventTab] Failed to load events:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
    return () => { isMounted = false; };
  }, []);

  const handleSelect = useCallback(
    (evt: EventSnapshot, dataUrl: string) => {
      const base64 = dataUrl.split(',')[1];
      if (!base64) return;
      onSelect({
        id: `evt-${evt.id}`,
        dataUrl,
        base64,
        name: `event-${evt.id.slice(0, 8)}.jpg`,
      });
    },
    [onSelect]
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[160px] items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/30">
        <Loader2 size={18} className="animate-spin text-neutral-500" />
        <span className="text-sm text-neutral-500">Loading recent detections...</span>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/30">
        <Image size={28} className="text-neutral-500" />
        <p className="text-sm text-neutral-400">No detection snapshots available yet</p>
        <p className="text-xs text-neutral-600">Snapshots appear after face detections are recorded</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {snapshots.map((evt) => {
        const dataUrl = thumbnails[evt.id];
        const imageId = `evt-${evt.id}`;
        const isSelected = selectedImageIds.includes(imageId);
        return (
          <button
            key={evt.id}
            onClick={() => dataUrl && !disabled && handleSelect(evt, dataUrl)}
            disabled={!dataUrl || disabled}
            title={`${evt.personName} — ${new Date(evt.createdAt).toLocaleString()}`}
            className={`group relative aspect-square overflow-hidden rounded-lg border bg-neutral-800 transition-all disabled:cursor-wait disabled:opacity-50 ${
              isSelected
                ? 'border-primary-500 ring-2 ring-primary-500/70'
                : 'border-neutral-700 hover:border-primary-500'
            }`}
          >
            {dataUrl ? (
              <>
                <img src={dataUrl} alt={evt.personName} className="h-full w-full object-cover" />
                <div className="absolute left-1.5 top-1.5">
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] font-semibold ${
                      isSelected
                        ? 'border-primary-300 bg-primary-500 text-white'
                        : 'border-white/70 bg-black/40 text-transparent'
                    }`}
                  >
                    ✓
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="truncate text-[10px] font-medium text-white">{evt.personName}</p>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Loader2 size={14} className="animate-spin text-neutral-600" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function EnrollmentModal({
  isOpen,
  onClose,
  onEnroll,
}: EnrollmentModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('upload');
  const [personName, setPersonName] = useState('');
  const [label, setLabel] = useState('');
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [result, setResult] = useState<{
    success: boolean;
    embeddingsCount: number;
    errors: string[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPersonName('');
      setLabel('');
      setImages([]);
      setResult(null);
      setActiveTab('upload');
      setIsSubmitting(false);
      setTimeout(() => nameInputRef.current?.focus(), 100);
      window.electronAPI.camera.list()
        .then((cams) => setCameras(cams.map((c) => ({ id: c.id, label: c.label }))))
        .catch(() => setCameras([]));
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const handleFilesSelected = useCallback((files: FileList | null) => {
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const base64 = dataUrl.split(',')[1];
        if (base64) {
          setImages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              dataUrl,
              base64,
              name: file.name,
            },
          ]);
        }
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFilesSelected(e.dataTransfer.files);
    },
    [handleFilesSelected]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const toggleImage = useCallback((image: ImagePreview) => {
    setImages((prev) => {
      const exists = prev.some((img) => img.id === image.id);
      return exists ? prev.filter((img) => img.id !== image.id) : [...prev, image];
    });
  }, []);

  const clearSelectedImages = useCallback(() => {
    setImages([]);
  }, []);

  const handleSubmit = async () => {
    if (!personName.trim() || images.length === 0) return;

    setIsSubmitting(true);
    setResult(null);

    try {
      const enrollResult = await onEnroll({
        personName: personName.trim(),
        label: label.trim() || undefined,
        imageData: images.map((img) => img.base64),
        source: activeTab,
      });

      setResult(enrollResult);

      if (enrollResult.success) {
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (err) {
      setResult({
        success: false,
        embeddingsCount: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const isFormValid = personName.trim().length > 0 && images.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enrollment-title"
      onClick={!isSubmitting ? onClose : undefined}
    >
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <h2 id="enrollment-title" className="text-lg font-semibold text-neutral-100">
            Enroll New Person
          </h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Name & Label */}
          <div className="mb-5 grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="person-name"
                className="mb-1.5 block text-xs font-medium text-neutral-400"
              >
                Name <span className="text-red-400">*</span>
              </label>
              <input
                ref={nameInputRef}
                id="person-name"
                type="text"
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label
                htmlFor="person-label"
                className="mb-1.5 block text-xs font-medium text-neutral-400"
              >
                Label
              </label>
              <input
                id="person-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Family, Staff"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-4 flex gap-1 rounded-lg bg-neutral-800 p-1">
            {TABS.map(({ id, label: tabLabel, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                disabled={isSubmitting}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                  activeTab === id
                    ? 'bg-neutral-700 text-neutral-100'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Icon size={14} />
                {tabLabel}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'upload' && (
            <div
              className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-700 bg-neutral-800/30 px-4 py-6 transition-colors hover:border-primary-600 hover:bg-neutral-800/50"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Drop images or click to browse"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  fileInputRef.current?.click();
                }
              }}
            >
              <Upload size={28} className="mb-2 text-neutral-500" />
              <p className="text-sm text-neutral-400">
                Drop images here or <span className="text-primary-400">browse</span>
              </p>
              <p className="mt-1 text-xs text-neutral-600">JPG, PNG accepted</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/jpg"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
            </div>
          )}

          {activeTab === 'capture' && (
            <CaptureTab
              cameras={cameras}
              onCapture={(img) => setImages((prev) => [...prev, img])}
              disabled={isSubmitting}
            />
          )}

          {activeTab === 'event' && (
            <FromEventTab
              selectedImageIds={images.map((img) => img.id)}
              onSelect={toggleImage}
              disabled={isSubmitting}
            />
          )}

          {/* Image Preview Grid */}
          {images.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-neutral-400">
                Selected Images ({images.length})
              </p>
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  onClick={clearSelectedImages}
                  disabled={images.length === 0 || isSubmitting}
                  className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Deselect All
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-neutral-700"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      onClick={() => removeImage(img.id)}
                      disabled={isSubmitting}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80 hover:text-white"
                      aria-label={`Remove ${img.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result Message */}
          {result && (
            <div
              className={`mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
                result.success
                  ? 'border border-green-800/50 bg-green-900/20 text-green-300'
                  : 'border border-red-800/50 bg-red-900/20 text-red-300'
              }`}
            >
              {result.success ? (
                <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              )}
              <div>
                {result.success ? (
                  <p>
                    Enrolled successfully with {result.embeddingsCount} face
                    embedding{result.embeddingsCount !== 1 ? 's' : ''}.
                  </p>
                ) : (
                  <div>
                    <p className="font-medium">Enrollment failed.</p>
                    {result.errors.map((err, i) => (
                      <p key={i} className="mt-1 text-xs opacity-80">
                        {err}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-neutral-800 px-6 py-4">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-neutral-900"
          >
            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
            {isSubmitting ? 'Enrolling...' : 'Enroll'}
          </button>
        </div>
      </div>
    </div>
  );
}
