import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

/**
 * TimelineScrubber — horizontal timeline bar with event markers for video playback.
 *
 * Features:
 * - Horizontal timeline spanning a configurable time range (default: 24h)
 * - Time labels at regular intervals
 * - Colored dots at event timestamps (click to jump)
 * - Drag to scrub through time
 * - Date picker for historical review
 * - Current time indicator (red line)
 */

interface TimelineEvent {
  id: string;
  timestamp: string;
  eventType: string;
  color?: string;
}

interface RecordingSegment {
  id: string;
  start_time: string;
  end_time: string;
}

interface TimelineScrubberProps {
  /** Events to display as markers */
  events: TimelineEvent[];
  /** Recording segments to show as filled bars */
  segments: RecordingSegment[];
  /** Currently selected date */
  date: Date;
  /** Callback when date changes */
  onDateChange: (date: Date) => void;
  /** Callback when user clicks a time position */
  onTimeSelect: (timestamp: Date) => void;
  /** Callback when user clicks an event marker */
  onEventClick?: (eventId: string) => void;
  /** Current playback position (optional) */
  playbackPosition?: Date | null;
  /** Whether the timeline is in live mode */
  isLive?: boolean;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  detection: '#22c55e',
  zone_enter: '#3b82f6',
  zone_exit: '#8b5cf6',
  loiter: '#f59e0b',
  journey: '#06b6d4',
  presence_change: '#ec4899',
  behavior: '#ef4444',
  sound: '#f97316',
};

const HOUR_WIDTH_PX = 60;
const TIMELINE_HOURS = 24;
const TIMELINE_WIDTH = HOUR_WIDTH_PX * TIMELINE_HOURS;

function formatHour(hour: number): string {
  const h = hour % 24;
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getTimeOffsetPx(date: Date, dayStart: Date): number {
  const msFromStart = date.getTime() - dayStart.getTime();
  const hoursFromStart = msFromStart / (1000 * 60 * 60);
  return Math.max(0, Math.min(TIMELINE_WIDTH, hoursFromStart * HOUR_WIDTH_PX));
}

export default function TimelineScrubber({
  events,
  segments,
  date,
  onDateChange,
  onTimeSelect,
  onEventClick,
  playbackPosition,
  isLive = false,
}: TimelineScrubberProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Day boundaries
  const dayStart = useMemo(() => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [date]);

  const dayEnd = useMemo(() => {
    const d = new Date(dayStart);
    d.setDate(d.getDate() + 1);
    return d;
  }, [dayStart]);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current && isLive) {
      const now = new Date();
      const offset = getTimeOffsetPx(now, dayStart);
      scrollRef.current.scrollLeft = Math.max(0, offset - scrollRef.current.clientWidth / 2);
    }
  }, [dayStart, isLive]);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDragging) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
      const x = e.clientX - rect.left + scrollLeft;
      const hours = x / HOUR_WIDTH_PX;
      const timestamp = new Date(dayStart.getTime() + hours * 60 * 60 * 1000);
      onTimeSelect(timestamp);
    },
    [dayStart, onTimeSelect, isDragging]
  );

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const prevDay = useCallback(() => {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    onDateChange(prev);
  }, [date, onDateChange]);

  const nextDay = useCallback(() => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    onDateChange(next);
  }, [date, onDateChange]);

  const goToToday = useCallback(() => {
    onDateChange(new Date());
  }, [onDateChange]);

  // Current time indicator position
  const now = new Date();
  const isToday =
    now.toDateString() === date.toDateString();
  const nowOffsetPx = isToday ? getTimeOffsetPx(now, dayStart) : -1;

  // Playback position indicator
  const playbackOffsetPx = playbackPosition
    ? getTimeOffsetPx(playbackPosition, dayStart)
    : -1;

  return (
    <div className="flex flex-col border-t border-neutral-800 bg-neutral-900/90">
      {/* Date navigation bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={prevDay}
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Previous day"
          >
            <ChevronLeft size={14} />
          </button>

          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800"
            aria-label="Select date"
          >
            <Calendar size={12} />
            <span>{formatDate(date)}</span>
          </button>

          <button
            onClick={nextDay}
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Next day"
          >
            <ChevronRight size={14} />
          </button>

          {!isToday && (
            <button
              onClick={goToToday}
              className="rounded-md px-2 py-0.5 text-[10px] font-medium text-blue-400 transition-colors hover:bg-blue-500/10"
            >
              Today
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 text-[10px] text-neutral-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-emerald-600/50" />
            Recording
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
            Event
          </span>
        </div>
      </div>

      {/* Date picker dropdown */}
      {showDatePicker && (
        <div className="border-b border-neutral-800 px-3 py-2">
          <input
            type="date"
            value={date.toISOString().split('T')[0]}
            onChange={(e) => {
              const newDate = new Date(e.target.value + 'T00:00:00');
              if (!isNaN(newDate.getTime())) {
                onDateChange(newDate);
                setShowDatePicker(false);
              }
            }}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Timeline track */}
      <div
        ref={scrollRef}
        className="relative overflow-x-auto"
        style={{ height: 48 }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          className="relative cursor-crosshair"
          style={{ width: TIMELINE_WIDTH, height: 48 }}
          onClick={handleTimelineClick}
        >
          {/* Hour grid lines + labels */}
          {Array.from({ length: TIMELINE_HOURS + 1 }, (_, i) => (
            <div
              key={`hour-${i}`}
              className="absolute top-0 h-full"
              style={{ left: i * HOUR_WIDTH_PX }}
            >
              <div className="h-full w-px bg-neutral-800" />
              {i < TIMELINE_HOURS && (
                <span
                  className="absolute left-1 top-1 select-none text-[9px] text-neutral-600"
                >
                  {formatHour(i)}
                </span>
              )}
            </div>
          ))}

          {/* Recording segments (green bars) */}
          {segments.map((seg) => {
            const segStart = new Date(seg.start_time);
            const segEnd = new Date(seg.end_time);
            if (segEnd < dayStart || segStart > dayEnd) return null;

            const startPx = getTimeOffsetPx(
              segStart < dayStart ? dayStart : segStart,
              dayStart
            );
            const endPx = getTimeOffsetPx(
              segEnd > dayEnd ? dayEnd : segEnd,
              dayStart
            );
            const widthPx = Math.max(2, endPx - startPx);

            return (
              <div
                key={seg.id}
                className="absolute rounded-sm bg-emerald-600/30"
                style={{
                  left: startPx,
                  width: widthPx,
                  top: 20,
                  height: 12,
                }}
                title={`${segStart.toLocaleTimeString()} - ${segEnd.toLocaleTimeString()}`}
              />
            );
          })}

          {/* Event markers */}
          {events.map((evt) => {
            const evtTime = new Date(evt.timestamp);
            if (evtTime < dayStart || evtTime > dayEnd) return null;
            const offsetPx = getTimeOffsetPx(evtTime, dayStart);
            const color = evt.color || EVENT_TYPE_COLORS[evt.eventType] || '#94a3b8';

            return (
              <button
                key={evt.id}
                className="absolute z-10 -translate-x-1/2 cursor-pointer"
                style={{ left: offsetPx, top: 34 }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onEventClick) onEventClick(evt.id);
                  onTimeSelect(evtTime);
                }}
                title={`${evt.eventType} at ${evtTime.toLocaleTimeString()}`}
              >
                <div
                  className="h-2.5 w-2.5 rounded-full border border-neutral-900 transition-transform hover:scale-150"
                  style={{ backgroundColor: color }}
                />
              </button>
            );
          })}

          {/* Current time indicator (red line) */}
          {nowOffsetPx >= 0 && (
            <div
              className="absolute top-0 z-20 h-full w-0.5 bg-red-500"
              style={{ left: nowOffsetPx }}
            >
              <div className="absolute -left-1 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
            </div>
          )}

          {/* Playback position indicator (blue line) */}
          {playbackOffsetPx >= 0 && (
            <div
              className="absolute top-0 z-20 h-full w-0.5 bg-blue-400"
              style={{ left: playbackOffsetPx }}
            >
              <div className="absolute -left-1 -top-0.5 h-2 w-2 rounded-full bg-blue-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
