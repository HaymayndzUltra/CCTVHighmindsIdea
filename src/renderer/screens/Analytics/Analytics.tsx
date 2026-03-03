import { useState, useEffect, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import HeatmapPanel from '../../components/analytics/HeatmapPanel';
import ActivityGraph from '../../components/analytics/ActivityGraph';
import PresenceTimeline from '../../components/analytics/PresenceTimeline';
import ZoneTrafficPanel from '../../components/analytics/ZoneTrafficPanel';

/**
 * Analytics Screen — 4-panel dashboard with date range selector.
 *
 * Panels:
 * - HeatmapPanel: per-camera detection density heatmap
 * - ActivityGraph: stacked bar chart of detections per hour
 * - PresenceTimeline: per-person home/away segments
 * - ZoneTrafficPanel: per-zone enter/exit/loiter counts
 */

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function Analytics() {
  const [date, setDate] = useState(new Date());
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');

  // Date range: full day
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const fromStr = dayStart.toISOString();
  const toStr = dayEnd.toISOString();

  // Load cameras
  useEffect(() => {
    window.electronAPI.camera.list().then((list) => {
      const cams = list.map((c) => ({ id: c.id, label: c.label }));
      setCameras(cams);
      if (cams.length > 0 && !selectedCamera) {
        setSelectedCamera(cams[0].id);
      }
    }).catch(() => setCameras([]));
  }, [selectedCamera]);

  const prevDay = useCallback(() => {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    setDate(prev);
  }, [date]);

  const nextDay = useCallback(() => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    setDate(next);
  }, [date]);

  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-6 py-3 backdrop-blur-sm">
        <h1 className="text-lg font-semibold text-neutral-100">Analytics</h1>

        <div className="flex items-center gap-3">
          {/* Camera selector */}
          <select
            value={selectedCamera}
            onChange={(e) => setSelectedCamera(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-blue-500"
          >
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id}>
                {cam.id} — {cam.label}
              </option>
            ))}
          </select>

          {/* Date navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={prevDay}
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-neutral-300">
              <Calendar size={12} />
              <span>{formatDate(date)}</span>
            </div>
            <button
              onClick={nextDay}
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            >
              <ChevronRight size={16} />
            </button>
            {!isToday && (
              <button
                onClick={() => setDate(new Date())}
                className="rounded-md px-2 py-0.5 text-[10px] font-medium text-blue-400 hover:bg-blue-500/10"
              >
                Today
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4-panel grid */}
      <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-4">
        {/* Top-left: Heatmap */}
        <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/60">
          <div className="border-b border-neutral-800 px-4 py-2">
            <h2 className="text-sm font-medium text-neutral-200">Detection Heatmap</h2>
          </div>
          <div className="flex-1 p-4">
            <HeatmapPanel cameraId={selectedCamera} from={fromStr} to={toStr} />
          </div>
        </div>

        {/* Top-right: Activity Graph */}
        <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/60">
          <div className="border-b border-neutral-800 px-4 py-2">
            <h2 className="text-sm font-medium text-neutral-200">Activity</h2>
          </div>
          <div className="flex-1 p-4">
            <ActivityGraph from={fromStr} to={toStr} cameraId={selectedCamera} />
          </div>
        </div>

        {/* Bottom-left: Presence Timeline */}
        <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/60">
          <div className="border-b border-neutral-800 px-4 py-2">
            <h2 className="text-sm font-medium text-neutral-200">Presence Timeline</h2>
          </div>
          <div className="flex-1 p-4">
            <PresenceTimeline from={fromStr} to={toStr} />
          </div>
        </div>

        {/* Bottom-right: Zone Traffic */}
        <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900/60">
          <div className="border-b border-neutral-800 px-4 py-2">
            <h2 className="text-sm font-medium text-neutral-200">Zone Traffic</h2>
          </div>
          <div className="flex-1 p-4">
            <ZoneTrafficPanel from={fromStr} to={toStr} />
          </div>
        </div>
      </div>
    </div>
  );
}
