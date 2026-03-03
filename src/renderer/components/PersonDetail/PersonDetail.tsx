import { useState, useEffect, useCallback } from 'react';
import { Trash2, ToggleLeft, ToggleRight, Pencil, Check, X, User, ShieldOff, RefreshCw, AlertTriangle } from 'lucide-react';
import type { Person } from '../../../shared/types';

interface NegativeEntry {
  id: string;
  person_id: string;
  created_at: string;
}

interface PersonDetailProps {
  person: Person;
  onDelete: (personId: string) => void;
  onToggle: (personId: string, enabled: boolean) => void;
  onRequestDelete: (person: Person) => void;
}

export default function PersonDetail({
  person,
  onToggle,
  onRequestDelete,
}: PersonDetailProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(person.name);
  const [negatives, setNegatives] = useState<NegativeEntry[]>([]);
  const [isLoadingNegatives, setIsLoadingNegatives] = useState(false);
  const [negativesError, setNegativesError] = useState<string | null>(null);

  const loadNegatives = useCallback(async () => {
    if (!window.electronAPI?.person?.negativeList) return;
    setIsLoadingNegatives(true);
    setNegativesError(null);
    try {
      const result = await window.electronAPI.person.negativeList(person.id);
      setNegatives((result as { entries: NegativeEntry[] })?.entries ?? []);
    } catch {
      setNegativesError('Failed to load negative gallery');
    } finally {
      setIsLoadingNegatives(false);
    }
  }, [person.id]);

  useEffect(() => {
    loadNegatives();
  }, [loadNegatives]);

  const handleDeleteNegative = async (negativeId: string) => {
    if (!window.electronAPI?.person?.negativeDelete) return;
    try {
      await window.electronAPI.person.negativeDelete(negativeId);
      setNegatives((prev) => prev.filter((n) => n.id !== negativeId));
    } catch {
      setNegativesError('Failed to remove negative entry');
    }
  };

  const handleSaveName = () => {
    if (editedName.trim() && editedName.trim() !== person.name) {
      // Future: call update IPC
    }
    setIsEditingName(false);
  };

  const handleCancelEdit = () => {
    setEditedName(person.name);
    setIsEditingName(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-800 px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-neutral-700 text-xl font-semibold text-neutral-200">
            {person.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-lg font-semibold text-neutral-100 focus:border-primary-500 focus:outline-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                />
                <button
                  onClick={handleSaveName}
                  className="rounded p-1 text-green-400 hover:bg-neutral-800"
                  aria-label="Save name"
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-800"
                  aria-label="Cancel editing"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-neutral-100">
                  {person.name}
                </h2>
                <button
                  onClick={() => {
                    setEditedName(person.name);
                    setIsEditingName(true);
                  }}
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
                  aria-label="Edit name"
                >
                  <Pencil size={14} />
                </button>
              </div>
            )}
            {person.label && (
              <p className="text-sm text-neutral-400">{person.label}</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-6">
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Status
            </h3>
            <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-200">
                  Face Recognition
                </p>
                <p className="text-xs text-neutral-500">
                  {person.enabled
                    ? 'This person will be identified by the system.'
                    : 'This person is excluded from recognition.'}
                </p>
              </div>
              <button
                onClick={() => onToggle(person.id, !person.enabled)}
                className={`transition-colors ${
                  person.enabled ? 'text-green-400' : 'text-neutral-500'
                }`}
                aria-label={person.enabled ? 'Disable recognition' : 'Enable recognition'}
              >
                {person.enabled ? (
                  <ToggleRight size={28} />
                ) : (
                  <ToggleLeft size={28} />
                )}
              </button>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Enrolled Images
            </h3>
            {person.embeddingsCount > 0 ? (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <User size={20} className="text-neutral-400" />
                  <p className="text-sm text-neutral-300">
                    {person.embeddingsCount} face embedding{person.embeddingsCount !== 1 ? 's' : ''} stored
                  </p>
                </div>
                {(person as unknown as { autoEnrollCount?: number }).autoEnrollCount !== undefined &&
                  (person as unknown as { autoEnrollCount: number }).autoEnrollCount > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-300">
                      <RefreshCw size={10} />
                      {(person as unknown as { autoEnrollCount: number }).autoEnrollCount} auto-enrolled
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-neutral-700 py-6 text-sm text-neutral-500">
                No images enrolled yet.
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Negative Gallery
              </h3>
              <button
                onClick={loadNegatives}
                disabled={isLoadingNegatives}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 disabled:opacity-40"
                aria-label="Refresh negative gallery"
              >
                <RefreshCw size={12} className={isLoadingNegatives ? 'animate-spin' : ''} />
              </button>
            </div>
            {negativesError && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-800/50 bg-red-900/20 px-3 py-2 text-xs text-red-400">
                <AlertTriangle size={12} />
                {negativesError}
              </div>
            )}
            {negatives.length > 0 ? (
              <div className="space-y-1.5">
                {negatives.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <ShieldOff size={14} className="text-orange-400" />
                      <span className="text-xs text-neutral-400">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteNegative(entry.id)}
                      className="rounded p-1 text-neutral-600 hover:bg-neutral-800 hover:text-red-400"
                      aria-label="Remove negative entry"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-neutral-700 py-4 text-xs text-neutral-600">
                No false positives blocked yet.
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Details
            </h3>
            <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500">ID</span>
                <span className="font-mono text-xs text-neutral-400">{person.id}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500">Notification</span>
                <span className="text-neutral-300">{person.telegramNotify.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500">Created</span>
                <span className="text-neutral-300">
                  {new Date(person.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="border-t border-neutral-800 px-6 py-4">
        <button
          onClick={() => onRequestDelete(person)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-900/40 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-neutral-950"
          aria-label={`Delete ${person.name}`}
        >
          <Trash2 size={16} />
          Delete Person
        </button>
      </div>
    </div>
  );
}
