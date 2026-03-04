import { AlertTriangle } from 'lucide-react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  tabName: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export default function UnsavedChangesModal({
  isOpen,
  tabName,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-full bg-amber-500/20 p-2">
            <AlertTriangle size={20} className="text-amber-400" />
          </div>
          <h2 className="text-lg font-semibold text-neutral-100">Unsaved Changes</h2>
        </div>

        <p className="mb-6 text-sm text-neutral-400">
          You have unsaved changes in <span className="font-medium text-neutral-200">{tabName}</span> settings. What
          would you like to do?
        </p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-md border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="flex-1 rounded-md bg-red-600/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-600/30"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            className="flex-1 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-500"
          >
            Save & Switch
          </button>
        </div>
      </div>
    </div>
  );
}
