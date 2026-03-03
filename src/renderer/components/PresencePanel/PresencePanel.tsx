import { useEffect, useState, useCallback } from 'react';
import { User, Wifi, WifiOff, Clock, MapPin } from 'lucide-react';
import type { PresenceState } from '../../../shared/types';

// --- Types ---

interface PresenceEntry {
  personId: string;
  personName: string;
  state: PresenceState;
  lastCameraId: string | null;
  lastSeenAt: string | null;
  stateChangedAt: string | null;
}

// --- Helpers ---

function getStateBadgeClasses(state: PresenceState): string {
  switch (state) {
    case 'HOME':
      return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    case 'ARRIVING':
      return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40';
    case 'DEPARTING':
      return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
    case 'AT_GATE':
      return 'bg-blue-500/20 text-blue-300 border border-blue-500/40';
    case 'AWAY':
      return 'bg-neutral-600/40 text-neutral-400 border border-neutral-600/40';
    case 'UNKNOWN':
    default:
      return 'bg-neutral-700/40 text-neutral-500 border border-neutral-700/40';
  }
}

function getStateDotClass(state: PresenceState): string {
  switch (state) {
    case 'HOME':       return 'bg-emerald-400';
    case 'ARRIVING':   return 'bg-yellow-400';
    case 'DEPARTING':  return 'bg-amber-400';
    case 'AT_GATE':    return 'bg-blue-400';
    case 'AWAY':       return 'bg-neutral-500';
    default:           return 'bg-neutral-600';
  }
}

function getStateLabel(state: PresenceState): string {
  switch (state) {
    case 'HOME':       return 'Home';
    case 'ARRIVING':   return 'Arriving';
    case 'DEPARTING':  return 'Departing';
    case 'AT_GATE':    return 'At Gate';
    case 'AWAY':       return 'Away';
    case 'UNKNOWN':    return 'Unknown';
    default:           return state;
  }
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';

  const now = Date.now();
  const ts = new Date(isoString).getTime();
  const diffSec = Math.floor((now - ts) / 1000);

  if (diffSec < 60)   return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// --- PresencePanel Component ---

export default function PresencePanel() {
  const [presences, setPresences] = useState<PresenceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [, setTick] = useState(0); // for relative time refresh

  const loadPresences = useCallback(async () => {
    try {
      const result = await window.electronAPI.presence.list();
      setPresences(result.presences as PresenceEntry[]);
    } catch (error) {
      console.error('[PresencePanel] Failed to load presences:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadPresences();
  }, [loadPresences]);

  // Subscribe to real-time presence updates
  useEffect(() => {
    if (!window.electronAPI?.presence?.onUpdate) return;

    const unsubscribe = window.electronAPI.presence.onUpdate((update) => {
      setPresences((prev) => {
        const existing = prev.find((p) => p.personId === update.personId);
        if (existing) {
          return prev.map((p) =>
            p.personId === update.personId
              ? {
                  ...p,
                  state: update.state as PresenceState,
                  lastSeenAt: update.triggerCameraId
                    ? new Date(update.timestamp).toISOString()
                    : p.lastSeenAt,
                  lastCameraId: update.triggerCameraId ?? p.lastCameraId,
                  stateChangedAt: new Date(update.timestamp).toISOString(),
                }
              : p
          );
        }
        // New person — add to list
        return [
          ...prev,
          {
            personId: update.personId,
            personName: update.personName,
            state: update.state as PresenceState,
            lastCameraId: update.triggerCameraId,
            lastSeenAt: new Date(update.timestamp).toISOString(),
            stateChangedAt: new Date(update.timestamp).toISOString(),
          },
        ];
      });
    });

    return () => unsubscribe();
  }, []);

  // Refresh relative timestamps every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Sort: HOME and ARRIVING first, then DEPARTING, AT_GATE, AWAY, UNKNOWN
  const sortOrder: Record<PresenceState, number> = {
    HOME: 0,
    ARRIVING: 1,
    AT_GATE: 2,
    DEPARTING: 3,
    AWAY: 4,
    UNKNOWN: 5,
  };

  const sorted = [...presences].sort(
    (a, b) => (sortOrder[a.state] ?? 5) - (sortOrder[b.state] ?? 5)
  );

  const homeCount = presences.filter((p) => p.state === 'HOME').length;
  const activeCount = presences.filter(
    (p) => p.state !== 'AWAY' && p.state !== 'UNKNOWN'
  ).length;

  return (
    <div className="flex flex-col border-t border-neutral-800 bg-neutral-900/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-neutral-200">Presence</h2>
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">
            {homeCount} home
          </span>
          {activeCount > homeCount && (
            <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-300">
              {activeCount - homeCount} in transit
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs text-neutral-500">
          {presences.some((p) => p.state !== 'AWAY' && p.state !== 'UNKNOWN') ? (
            <Wifi size={12} className="text-emerald-400" />
          ) : (
            <WifiOff size={12} />
          )}
          <span>{presences.length} tracked</span>
        </div>
      </div>

      {/* Person cards */}
      <div className="flex gap-2 overflow-x-auto p-2 pb-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-20 w-40 flex-shrink-0 animate-pulse rounded-lg bg-neutral-800"
            />
          ))
        ) : sorted.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-4 text-xs text-neutral-500">
            <User size={14} />
            <span>No persons tracked yet.</span>
          </div>
        ) : (
          sorted.map((entry) => (
            <PresenceCard key={entry.personId} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}

// --- PresenceCard sub-component ---

function PresenceCard({ entry }: { entry: PresenceEntry }) {
  const initials = entry.personName
    .split(' ')
    .map((n) => n.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className="flex w-44 flex-shrink-0 flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3 transition-colors hover:border-neutral-700"
      role="article"
      aria-label={`${entry.personName}: ${getStateLabel(entry.state)}`}
    >
      {/* Avatar + state dot */}
      <div className="flex items-center gap-2">
        <div className="relative flex-shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-700 text-xs font-semibold text-neutral-200">
            {initials}
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-neutral-900 ${getStateDotClass(entry.state)}`}
            aria-hidden="true"
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-neutral-200">
            {entry.personName}
          </p>
          <span
            className={`mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${getStateBadgeClasses(entry.state)}`}
          >
            {getStateLabel(entry.state)}
          </span>
        </div>
      </div>

      {/* Last seen info */}
      <div className="space-y-0.5">
        {entry.lastCameraId && (
          <div className="flex items-center gap-1 text-[10px] text-neutral-500">
            <MapPin size={9} strokeWidth={2} className="flex-shrink-0" />
            <span className="truncate">{entry.lastCameraId}</span>
          </div>
        )}
        <div className="flex items-center gap-1 text-[10px] text-neutral-500">
          <Clock size={9} strokeWidth={2} className="flex-shrink-0" />
          <span>{formatRelativeTime(entry.lastSeenAt)}</span>
        </div>
      </div>
    </div>
  );
}
