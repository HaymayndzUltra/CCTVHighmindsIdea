import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, User, UserX, ArrowDownLeft, ArrowUpRight, Minus, Image } from 'lucide-react';

interface DetectionEvent {
  id: string;
  cameraId: string;
  personId: string | null;
  personName: string;
  isKnown: boolean;
  direction: 'ENTER' | 'EXIT' | 'INSIDE' | null;
  detectionMethod: 'line_crossing' | 'heuristic' | null;
  confidence: number;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  snapshotPath: string | null;
  clipPath: string | null;
  telegramSent: boolean;
  telegramSentAt: string | null;
  createdAt: string;
  eventType?: string;
  journeyId?: string | null;
  zoneId?: string | null;
}

type SortField = 'createdAt' | 'cameraId' | 'personName' | 'direction' | 'confidence';
type SortDirection = 'asc' | 'desc';

interface EventTableProps {
  events: DetectionEvent[];
  onSelectEvent: (event: DetectionEvent) => void;
  selectedEventId: string | null;
  isLoading?: boolean;
}

const EVENT_TYPE_CONFIG: Record<string, { label: string; classes: string }> = {
  detection:       { label: 'Detection',  classes: 'bg-neutral-700/60 text-neutral-300' },
  journey:         { label: 'Journey',    classes: 'bg-violet-500/20 text-violet-300' },
  presence_change: { label: 'Presence',   classes: 'bg-blue-500/20 text-blue-300' },
  zone_enter:      { label: 'Zone In',    classes: 'bg-emerald-500/20 text-emerald-300' },
  zone_exit:       { label: 'Zone Out',   classes: 'bg-amber-500/20 text-amber-300' },
  loiter:          { label: 'Loiter',     classes: 'bg-red-500/20 text-red-300' },
  behavior:        { label: 'Behavior',   classes: 'bg-orange-500/20 text-orange-300' },
  sound:           { label: 'Sound',      classes: 'bg-cyan-500/20 text-cyan-300' },
};

const DIRECTION_CONFIG: Record<string, { icon: typeof ArrowDownLeft; label: string; color: string }> = {
  ENTER: { icon: ArrowDownLeft, label: 'Enter', color: 'text-emerald-400' },
  EXIT: { icon: ArrowUpRight, label: 'Exit', color: 'text-amber-400' },
  INSIDE: { icon: Minus, label: 'Inside', color: 'text-blue-400' },
};

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function SortIndicator({
  field,
  activeField,
  activeDir,
}: {
  field: SortField;
  activeField: SortField;
  activeDir: SortDirection;
}) {
  if (activeField !== field) return null;
  return activeDir === 'asc' ? (
    <ChevronUp size={12} className="inline ml-0.5" />
  ) : (
    <ChevronDown size={12} className="inline ml-0.5" />
  );
}

export default function EventTable({
  events,
  onSelectEvent,
  selectedEventId,
  isLoading = false,
}: EventTableProps) {
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }, [sortField]);

  const sortedEvents = [...events].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'createdAt':
        cmp = a.createdAt.localeCompare(b.createdAt);
        break;
      case 'cameraId':
        cmp = a.cameraId.localeCompare(b.cameraId);
        break;
      case 'personName':
        cmp = a.personName.localeCompare(b.personName);
        break;
      case 'direction':
        cmp = (a.direction ?? '').localeCompare(b.direction ?? '');
        break;
      case 'confidence':
        cmp = a.confidence - b.confidence;
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Loading events...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-500">
        <Image size={40} strokeWidth={1} />
        <span className="text-sm font-medium">No events found</span>
        <span className="text-xs">Adjust filters or wait for new detections</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-left text-xs" role="grid">
        <thead className="sticky top-0 z-10 border-b border-neutral-700 bg-neutral-900">
          <tr>
            <th className="px-3 py-2.5 font-medium text-neutral-400">
              <button
                onClick={() => handleSort('createdAt')}
                className="flex items-center gap-0.5 hover:text-neutral-200 transition-colors"
                aria-label="Sort by timestamp"
              >
                Timestamp <SortIndicator field="createdAt" activeField={sortField} activeDir={sortDir} />
              </button>
            </th>
            <th className="px-3 py-2.5 font-medium text-neutral-400">
              <button
                onClick={() => handleSort('cameraId')}
                className="flex items-center gap-0.5 hover:text-neutral-200 transition-colors"
                aria-label="Sort by camera"
              >
                Camera <SortIndicator field="cameraId" activeField={sortField} activeDir={sortDir} />
              </button>
            </th>
            <th className="px-3 py-2.5 font-medium text-neutral-400">
              <button
                onClick={() => handleSort('personName')}
                className="flex items-center gap-0.5 hover:text-neutral-200 transition-colors"
                aria-label="Sort by person"
              >
                Person <SortIndicator field="personName" activeField={sortField} activeDir={sortDir} />
              </button>
            </th>
            <th className="px-3 py-2.5 font-medium text-neutral-400">
              <button
                onClick={() => handleSort('direction')}
                className="flex items-center gap-0.5 hover:text-neutral-200 transition-colors"
                aria-label="Sort by direction"
              >
                Direction <SortIndicator field="direction" activeField={sortField} activeDir={sortDir} />
              </button>
            </th>
            <th className="px-3 py-2.5 font-medium text-neutral-400">
              <button
                onClick={() => handleSort('confidence')}
                className="flex items-center gap-0.5 hover:text-neutral-200 transition-colors"
                aria-label="Sort by confidence"
              >
                Confidence <SortIndicator field="confidence" activeField={sortField} activeDir={sortDir} />
              </button>
            </th>
            <th className="px-3 py-2.5 font-medium text-neutral-400">Type</th>
            <th className="px-3 py-2.5 font-medium text-neutral-400">Snapshot</th>
          </tr>
        </thead>
        <tbody>
          {sortedEvents.map((event) => {
            const isSelected = event.id === selectedEventId;
            const dirConfig = event.direction ? DIRECTION_CONFIG[event.direction] : null;
            const DirIcon = dirConfig?.icon ?? Minus;

            return (
              <tr
                key={event.id}
                onClick={() => onSelectEvent(event)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectEvent(event);
                  }
                }}
                tabIndex={0}
                role="row"
                aria-selected={isSelected}
                className={`cursor-pointer border-b border-neutral-800/50 transition-colors ${
                  isSelected
                    ? 'bg-primary-600/10 border-l-2 border-l-primary-500'
                    : 'hover:bg-neutral-800/50'
                } ${event.id.startsWith('new-') ? 'animate-pulse' : ''}`}
              >
                {/* Timestamp */}
                <td className="whitespace-nowrap px-3 py-2.5 text-neutral-300">
                  {formatTimestamp(event.createdAt)}
                </td>

                {/* Camera */}
                <td className="px-3 py-2.5">
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
                    {event.cameraId}
                  </span>
                </td>

                {/* Person */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {event.isKnown ? (
                      <User size={13} className="text-emerald-400" />
                    ) : (
                      <UserX size={13} className="text-red-400" />
                    )}
                    <span className={event.isKnown ? 'text-neutral-200' : 'text-neutral-400 italic'}>
                      {event.personName}
                    </span>
                  </div>
                </td>

                {/* Direction */}
                <td className="px-3 py-2.5">
                  {dirConfig ? (
                    <div className={`flex items-center gap-1 ${dirConfig.color}`}>
                      <DirIcon size={13} />
                      <span className="font-medium">{dirConfig.label}</span>
                    </div>
                  ) : (
                    <span className="text-neutral-500">—</span>
                  )}
                </td>

                {/* Confidence */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-700">
                      <div
                        className={`h-full rounded-full ${
                          event.confidence >= 0.8
                            ? 'bg-emerald-500'
                            : event.confidence >= 0.5
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(100, event.confidence * 100)}%` }}
                      />
                    </div>
                    <span className="text-neutral-400">{(event.confidence * 100).toFixed(0)}%</span>
                  </div>
                </td>

                {/* Event Type badge */}
                <td className="px-3 py-2.5">
                  {(() => {
                    const typeKey = event.eventType ?? 'detection';
                    const cfg = EVENT_TYPE_CONFIG[typeKey];
                    return cfg ? (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.classes}`}>
                        {cfg.label}
                      </span>
                    ) : (
                      <span className="rounded bg-neutral-700/60 px-1.5 py-0.5 text-[10px] text-neutral-400">
                        {typeKey}
                      </span>
                    );
                  })()}
                </td>

                {/* Snapshot thumbnail */}
                <td className="px-3 py-2.5">
                  {event.snapshotPath ? (
                    <div className="h-8 w-8 overflow-hidden rounded border border-neutral-700 bg-neutral-800">
                      <Image size={16} className="m-auto mt-1 text-neutral-500" />
                    </div>
                  ) : (
                    <span className="text-neutral-600">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
