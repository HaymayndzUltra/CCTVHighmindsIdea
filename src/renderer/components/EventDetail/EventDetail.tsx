import {
  User,
  UserX,
  ArrowDownLeft,
  ArrowUpRight,
  Minus,
  Camera,
  Clock,
  Shield,
  Crosshair,
  Send,
  X,
  Route,
  MapPin,
  Tag,
} from 'lucide-react';

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

const EVENT_TYPE_LABEL: Record<string, string> = {
  detection:       'Detection',
  journey:         'Journey',
  presence_change: 'Presence Change',
  zone_enter:      'Zone Enter',
  zone_exit:       'Zone Exit',
  loiter:          'Loiter',
  behavior:        'Behavior',
  sound:           'Sound',
};

interface EventDetailProps {
  event: DetectionEvent;
  onClose: () => void;
}

const DIRECTION_CONFIG: Record<string, { icon: typeof ArrowDownLeft; label: string; color: string; bg: string }> = {
  ENTER: { icon: ArrowDownLeft, label: 'Enter', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  EXIT: { icon: ArrowUpRight, label: 'Exit', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  INSIDE: { icon: Minus, label: 'Inside', color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

function formatFullTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export default function EventDetail({ event, onClose }: EventDetailProps) {
  const dirConfig = event.direction ? DIRECTION_CONFIG[event.direction] : null;
  const DirIcon = dirConfig?.icon ?? Minus;

  return (
    <div className="flex h-full flex-col border-l border-neutral-800 bg-neutral-900/70">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-100">Event Detail</h3>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          aria-label="Close event detail"
          title="Close (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Snapshot */}
        <div className="mb-4 aspect-video w-full overflow-hidden rounded-lg border border-neutral-700 bg-black">
          {event.snapshotPath ? (
            <div className="flex h-full items-center justify-center text-neutral-500">
              <Camera size={32} strokeWidth={1} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-neutral-600">
              <Camera size={28} strokeWidth={1} />
              <span className="text-xs">No snapshot</span>
            </div>
          )}
        </div>

        {/* Person Info */}
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-800/50 p-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full ${
              event.isKnown ? 'bg-emerald-500/15' : 'bg-red-500/15'
            }`}
          >
            {event.isKnown ? (
              <User size={20} className="text-emerald-400" />
            ) : (
              <UserX size={20} className="text-red-400" />
            )}
          </div>
          <div>
            <div className="text-sm font-semibold text-neutral-100">{event.personName}</div>
            <div className="text-xs text-neutral-400">
              {event.isKnown ? 'Known person' : 'Unknown person'}
              {event.personId && (
                <span className="ml-1 text-neutral-500">({event.personId.slice(0, 8)}…)</span>
              )}
            </div>
          </div>
        </div>

        {/* Direction badge */}
        {dirConfig && (
          <div className={`mb-4 flex items-center gap-2 rounded-lg ${dirConfig.bg} border border-neutral-800 p-3`}>
            <DirIcon size={18} className={dirConfig.color} />
            <div>
              <div className={`text-sm font-semibold ${dirConfig.color}`}>{dirConfig.label}</div>
              <div className="text-xs text-neutral-400">
                via {event.detectionMethod === 'line_crossing' ? 'Line Crossing' : 'Heuristic'}
              </div>
            </div>
          </div>
        )}

        {/* Event type + context badges */}
        {(event.eventType || event.journeyId || event.zoneId) && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {event.eventType && event.eventType !== 'detection' && (
              <span className="flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                <Tag size={9} />
                {EVENT_TYPE_LABEL[event.eventType] ?? event.eventType}
              </span>
            )}
            {event.journeyId && (
              <span className="flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                <Route size={9} />
                Journey
              </span>
            )}
            {event.zoneId && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                <MapPin size={9} />
                Zone
              </span>
            )}
          </div>
        )}

        {/* Metadata Grid */}
        <div className="space-y-3">
          <MetadataRow
            icon={Camera}
            label="Camera"
            value={event.cameraId}
          />
          <MetadataRow
            icon={Clock}
            label="Timestamp"
            value={formatFullTimestamp(event.createdAt)}
          />
          {event.eventType && (
            <MetadataRow
              icon={Tag}
              label="Event Type"
              value={EVENT_TYPE_LABEL[event.eventType] ?? event.eventType}
            />
          )}
          <MetadataRow
            icon={Shield}
            label="Confidence"
            value={`${(event.confidence * 100).toFixed(1)}%`}
          />
          <MetadataRow
            icon={Crosshair}
            label="Detection"
            value={event.detectionMethod === 'line_crossing' ? 'Line Crossing' : event.detectionMethod === 'heuristic' ? 'Heuristic' : 'N/A'}
          />
          {event.journeyId && (
            <MetadataRow
              icon={Route}
              label="Journey ID"
              value={event.journeyId.slice(0, 8) + '…'}
            />
          )}
          {event.zoneId && (
            <MetadataRow
              icon={MapPin}
              label="Zone ID"
              value={event.zoneId.slice(0, 8) + '…'}
            />
          )}
          {event.telegramSent && (
            <MetadataRow
              icon={Send}
              label="Telegram"
              value={event.telegramSentAt ? `Sent ${formatFullTimestamp(event.telegramSentAt)}` : 'Sent'}
            />
          )}
          {event.bbox && (
            <MetadataRow
              icon={Crosshair}
              label="Bounding Box"
              value={`(${event.bbox.x1.toFixed(0)}, ${event.bbox.y1.toFixed(0)}) → (${event.bbox.x2.toFixed(0)}, ${event.bbox.y2.toFixed(0)})`}
            />
          )}
        </div>

        {/* Event ID */}
        <div className="mt-4 border-t border-neutral-800 pt-3">
          <span className="text-[10px] font-mono text-neutral-600">ID: {event.id}</span>
        </div>
      </div>
    </div>
  );
}

function MetadataRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Camera;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="mt-0.5 shrink-0 text-neutral-500" />
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</div>
        <div className="text-xs text-neutral-200">{value}</div>
      </div>
    </div>
  );
}
