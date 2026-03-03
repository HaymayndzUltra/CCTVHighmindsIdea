import { useEffect, useState } from 'react';

/**
 * ActivityGraph — stacked bar chart of detections per hour.
 * SVG-based bar chart showing detection counts across 24 hours.
 * Bars are color-coded: known (green) vs unknown (red).
 */

interface ActivityData {
  date: string;
  hour: number;
  cameraId: string | null;
  detectionCount: number;
  personCount: number;
  knownCount: number;
  unknownCount: number;
}

interface ActivityGraphProps {
  from: string;
  to: string;
  cameraId?: string;
}

const BAR_COLORS = {
  known: '#22c55e',
  unknown: '#ef4444',
  other: '#3b82f6',
};

export default function ActivityGraph({ from, to, cameraId }: ActivityGraphProps) {
  const [data, setData] = useState<ActivityData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    setIsLoading(true);

    const fetchData = async () => {
      try {
        if (!window.electronAPI?.analytics?.activity) {
          setIsLoading(false);
          return;
        }
        const result = await window.electronAPI.analytics.activity(from, to, cameraId);
        setData(result.data);
      } catch {
        setData([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [from, to, cameraId]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-500">
        Loading activity data...
      </div>
    );
  }

  // Build hourly buckets (0-23)
  const hourlyBuckets = Array.from({ length: 24 }, (_, i) => {
    const hourData = data.filter((d) => d.hour === i);
    const known = hourData.reduce((s, d) => s + d.knownCount, 0);
    const unknown = hourData.reduce((s, d) => s + d.unknownCount, 0);
    const other = hourData.reduce((s, d) => s + Math.max(0, d.detectionCount - d.knownCount - d.unknownCount), 0);
    return { hour: i, known, unknown, other, total: known + unknown + other };
  });

  const maxTotal = Math.max(1, ...hourlyBuckets.map((b) => b.total));

  if (maxTotal <= 1 && data.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-xs text-neutral-500">No activity data for this period</p>
        <p className="max-w-xs text-[10px] text-neutral-600">Hourly rollups aggregate detection counts. Data appears after the first hour of AI pipeline operation.</p>
      </div>
    );
  }

  const chartW = 100;
  const chartH = 80;
  const barW = chartW / 24 - 0.5;

  return (
    <div className="flex h-full flex-col">
      <svg
        className="flex-1"
        viewBox={`0 0 ${chartW} ${chartH + 10}`}
        preserveAspectRatio="none"
      >
        {/* Bars */}
        {hourlyBuckets.map((bucket) => {
          const x = bucket.hour * (chartW / 24) + 0.25;
          const knownH = (bucket.known / maxTotal) * chartH;
          const unknownH = (bucket.unknown / maxTotal) * chartH;
          const otherH = (bucket.other / maxTotal) * chartH;

          return (
            <g key={bucket.hour}>
              {/* Known (green, bottom) */}
              <rect
                x={x}
                y={chartH - knownH}
                width={barW}
                height={knownH}
                fill={BAR_COLORS.known}
                fillOpacity={0.7}
                rx={0.3}
              />
              {/* Unknown (red, middle) */}
              <rect
                x={x}
                y={chartH - knownH - unknownH}
                width={barW}
                height={unknownH}
                fill={BAR_COLORS.unknown}
                fillOpacity={0.7}
                rx={0.3}
              />
              {/* Other (blue, top) */}
              {otherH > 0 && (
                <rect
                  x={x}
                  y={chartH - knownH - unknownH - otherH}
                  width={barW}
                  height={otherH}
                  fill={BAR_COLORS.other}
                  fillOpacity={0.5}
                  rx={0.3}
                />
              )}
              {/* Hour label */}
              {bucket.hour % 3 === 0 && (
                <text
                  x={x + barW / 2}
                  y={chartH + 6}
                  textAnchor="middle"
                  fill="#6b7280"
                  fontSize={2.5}
                >
                  {bucket.hour}
                </text>
              )}
            </g>
          );
        })}

        {/* Y-axis gridlines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={0}
            y1={chartH * (1 - frac)}
            x2={chartW}
            y2={chartH * (1 - frac)}
            stroke="#374151"
            strokeWidth={0.2}
            strokeDasharray="1,1"
          />
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-3 pt-2 text-[10px] text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: BAR_COLORS.known }} />
          Known
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: BAR_COLORS.unknown }} />
          Unknown
        </span>
        <span className="ml-auto">Max: {maxTotal}/hr</span>
      </div>
    </div>
  );
}
