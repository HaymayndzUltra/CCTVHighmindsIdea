import { useEffect, useState } from 'react';

/**
 * HeatmapPanel — per-camera detection density heatmap.
 * Renders a grid overlay where cell color intensity = detection frequency.
 * Uses SVG rectangles with opacity mapped to count.
 */

interface HeatmapCell {
  row: number;
  col: number;
  count: number;
}

interface HeatmapPanelProps {
  cameraId: string;
  from: string;
  to: string;
}

const GRID_SIZE = 20;

export default function HeatmapPanel({ cameraId, from, to }: HeatmapPanelProps) {
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [maxCount, setMaxCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!cameraId || !from || !to) return;
    setIsLoading(true);

    const fetchData = async () => {
      try {
        if (!window.electronAPI?.analytics?.heatmap) {
          setIsLoading(false);
          return;
        }
        const result = await window.electronAPI.analytics.heatmap(cameraId, from, to);
        setCells(result.cells);
        const max = result.cells.reduce((m: number, c: { count: number }) => Math.max(m, c.count), 1);
        setMaxCount(max);
      } catch {
        setCells([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [cameraId, from, to]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-500">
        Loading heatmap...
      </div>
    );
  }

  if (cells.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-xs text-neutral-500">No detection data for this period</p>
        <p className="max-w-xs text-[10px] text-neutral-600">Detections with bounding boxes populate this view. Ensure the AI pipeline is running with cameras streaming.</p>
      </div>
    );
  }

  const cellW = 100 / GRID_SIZE;
  const cellH = 100 / GRID_SIZE;

  return (
    <div className="relative h-full w-full">
      <svg
        className="h-full w-full rounded-md bg-neutral-950"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {/* Grid cells with heat color */}
        {cells.map((cell) => {
          const intensity = cell.count / maxCount;
          const r = Math.round(255 * intensity);
          const g = Math.round(60 * (1 - intensity));
          const b = 0;
          const opacity = 0.15 + intensity * 0.7;

          return (
            <rect
              key={`${cell.row}-${cell.col}`}
              x={cell.col * cellW}
              y={cell.row * cellH}
              width={cellW}
              height={cellH}
              fill={`rgb(${r},${g},${b})`}
              fillOpacity={opacity}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={0.1}
            />
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-[10px] text-neutral-400">
        <span>Low</span>
        <div className="h-2 w-12 rounded-sm bg-gradient-to-r from-yellow-900/50 to-red-600" />
        <span>High</span>
        <span className="ml-1 text-neutral-500">(max: {maxCount})</span>
      </div>
    </div>
  );
}
