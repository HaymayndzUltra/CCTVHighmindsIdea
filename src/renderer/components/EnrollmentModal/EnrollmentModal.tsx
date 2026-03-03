import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Camera, Image, X, Loader2, AlertCircle, CheckCircle } from 'lucide-react';

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

const TABS: { id: TabId; label: string; icon: typeof Upload }[] = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'capture', label: 'Capture', icon: Camera },
  { id: 'event', label: 'From Event', icon: Image },
];

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
            <div className="flex min-h-[120px] flex-col items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800/30 px-4 py-6">
              <Camera size={28} className="mb-2 text-neutral-500" />
              <p className="text-sm text-neutral-400">
                Live camera capture
              </p>
              <p className="mt-1 text-xs text-neutral-600">
                Select a camera and click "Capture Face" to freeze a frame.
              </p>
              <p className="mt-3 text-xs text-neutral-500 italic">
                Camera stream preview will appear here when streams are active.
              </p>
            </div>
          )}

          {activeTab === 'event' && (
            <div className="flex min-h-[120px] flex-col items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800/30 px-4 py-6">
              <Image size={28} className="mb-2 text-neutral-500" />
              <p className="text-sm text-neutral-400">
                Select from recent detections
              </p>
              <p className="mt-1 text-xs text-neutral-600">
                Click a detected face snapshot to use it for enrollment.
              </p>
              <p className="mt-3 text-xs text-neutral-500 italic">
                Recent detection events will appear here when available.
              </p>
            </div>
          )}

          {/* Image Preview Grid */}
          {images.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-neutral-400">
                Selected Images ({images.length})
              </p>
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
