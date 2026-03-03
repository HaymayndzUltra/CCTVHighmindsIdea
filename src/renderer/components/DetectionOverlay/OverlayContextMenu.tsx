import { useEffect, useRef } from 'react';
import { UserPlus, ShieldX, Crosshair } from 'lucide-react';

/**
 * OverlayContextMenu — floating context menu shown when right-clicking a detection box.
 *
 * Actions:
 * - Enroll Face: triggers enrollment flow for the detected person
 * - Mark as False Positive: adds crop to negative gallery
 * - Track This Person: engages PTZ auto-tracking on the track
 */

export interface ContextMenuAction {
  type: 'enroll' | 'false_positive' | 'track';
  trackId: number;
  objectClass: string;
  personId: string | null;
}

interface OverlayContextMenuProps {
  x: number;
  y: number;
  trackId: number;
  objectClass: string;
  personId: string | null;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

export default function OverlayContextMenu({
  x,
  y,
  trackId,
  objectClass,
  personId,
  onAction,
  onClose,
}: OverlayContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 150);

  const isPerson = objectClass === 'person';

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-lg border border-neutral-700 bg-neutral-900/95 py-1 shadow-xl backdrop-blur-sm"
      style={{ left: adjustedX, top: adjustedY }}
      role="menu"
      aria-label="Detection actions"
    >
      {/* Header */}
      <div className="border-b border-neutral-800 px-3 py-1.5">
        <span className="text-xs font-medium text-neutral-400">
          Track #{trackId} · {objectClass}
        </span>
      </div>

      {/* Enroll Face — only for person class */}
      {isPerson && (
        <button
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
          onClick={() => {
            onAction({ type: 'enroll', trackId, objectClass, personId });
            onClose();
          }}
          role="menuitem"
        >
          <UserPlus size={14} className="text-emerald-400" />
          <span>Enroll Face</span>
        </button>
      )}

      {/* Mark as False Positive — only for person class with an identity */}
      {isPerson && personId && (
        <button
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
          onClick={() => {
            onAction({ type: 'false_positive', trackId, objectClass, personId });
            onClose();
          }}
          role="menuitem"
        >
          <ShieldX size={14} className="text-amber-400" />
          <span>Mark as False Positive</span>
        </button>
      )}

      {/* Track This Person — PTZ auto-track (person only) */}
      {isPerson && (
        <button
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
          onClick={() => {
            onAction({ type: 'track', trackId, objectClass, personId });
            onClose();
          }}
          role="menuitem"
        >
          <Crosshair size={14} className="text-blue-400" />
          <span>Track This Person</span>
        </button>
      )}

      {/* No actions available for non-person objects */}
      {!isPerson && (
        <div className="px-3 py-2 text-xs text-neutral-500">
          No actions available
        </div>
      )}
    </div>
  );
}
