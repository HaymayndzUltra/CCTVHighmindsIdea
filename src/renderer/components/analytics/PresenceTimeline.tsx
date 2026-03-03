import { useEffect, useState } from 'react';

/**
 * PresenceTimeline — per-person horizontal bar with colored segments for presence states.
 * HOME=green, AWAY=gray, ARRIVING=yellow, DEPARTING=orange, AT_GATE=blue, UNKNOWN=neutral
 */

interface PresenceSegment {
  personId: string;
  personName: string;
  state: string;
  startTime: string;
  endTime: string | null;
}

interface PresenceTimelineProps {
  from: string;
  to: string;
  personId?: string;
}

const STATE_COLORS: Record<string, string> = {
  HOME: '#22c55e',
  AWAY: '#6b7280',
  ARRIVING: '#eab308',
  DEPARTING: '#f97316',
  AT_GATE: '#3b82f6',
  UNKNOWN: '#374151',
};

export default function PresenceTimeline({ from, to, personId }: PresenceTimelineProps) {
  const [segments, setSegments] = useState<PresenceSegment[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    setIsLoading(true);

    const fetchData = async () => {
      try {
        if (!window.electronAPI?.analytics?.presence) {
          setIsLoading(false);
          return;
        }
        const result = await window.electronAPI.analytics.presence(from, to, personId);
        setSegments(result.segments);
      } catch {
        setSegments([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [from, to, personId]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-500">
        Loading presence data...
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-xs text-neutral-500">No presence data for this period</p>
        <p className="max-w-xs text-[10px] text-neutral-600">Enroll persons in Person Directory and enable presence tracking to see timeline segments.</p>
      </div>
    );
  }

  // Group segments by person
  const personMap = new Map<string, { name: string; segments: PresenceSegment[] }>();
  for (const seg of segments) {
    if (!personMap.has(seg.personId)) {
      personMap.set(seg.personId, { name: seg.personName, segments: [] });
    }
    personMap.get(seg.personId)!.segments.push(seg);
  }

  const dayStart = new Date(from).getTime();
  const dayEnd = new Date(to).getTime();
  const dayDuration = dayEnd - dayStart;

  const persons = Array.from(personMap.entries());
  const rowHeight = Math.min(32, 200 / Math.max(1, persons.length));

  return (
    <div className="flex h-full flex-col gap-1 overflow-auto">
      {/* Hour labels */}
      <div className="flex items-center pl-20">
        {[0, 6, 12, 18, 24].map((h) => (
          <span
            key={h}
            className="text-[9px] text-neutral-600"
            style={{ position: 'absolute', left: `${20 + (h / 24) * 80}%` }}
          >
            {h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
          </span>
        ))}
      </div>

      {/* Person rows */}
      {persons.map(([pId, { name, segments: pSegments }]) => (
        <div key={pId} className="flex items-center gap-2" style={{ height: rowHeight }}>
          {/* Person name */}
          <div className="w-16 truncate text-right text-[10px] font-medium text-neutral-400" title={name}>
            {name}
          </div>

          {/* Timeline bar */}
          <div className="relative flex-1 rounded-sm bg-neutral-800" style={{ height: Math.max(8, rowHeight - 8) }}>
            {pSegments.map((seg, idx) => {
              const segStart = new Date(seg.startTime).getTime();
              const segEnd = seg.endTime ? new Date(seg.endTime).getTime() : dayEnd;
              const leftPct = ((segStart - dayStart) / dayDuration) * 100;
              const widthPct = ((segEnd - segStart) / dayDuration) * 100;

              return (
                <div
                  key={idx}
                  className="absolute top-0 h-full rounded-sm"
                  style={{
                    left: `${Math.max(0, leftPct)}%`,
                    width: `${Math.max(0.5, Math.min(100 - leftPct, widthPct))}%`,
                    backgroundColor: STATE_COLORS[seg.state] ?? STATE_COLORS.UNKNOWN,
                    opacity: 0.8,
                  }}
                  title={`${seg.state}: ${new Date(seg.startTime).toLocaleTimeString()} - ${seg.endTime ? new Date(seg.endTime).toLocaleTimeString() : 'now'}`}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 pt-2 text-[10px] text-neutral-500">
        {Object.entries(STATE_COLORS).map(([state, color]) => (
          <span key={state} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
            {state}
          </span>
        ))}
      </div>
    </div>
  );
}
