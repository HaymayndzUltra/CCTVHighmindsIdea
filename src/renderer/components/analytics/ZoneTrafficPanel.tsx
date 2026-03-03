import { useEffect, useState } from 'react';

/**
 * ZoneTrafficPanel — per-zone enter/exit/loiter counts as horizontal bar chart.
 */

interface ZoneTrafficData {
  zoneId: string;
  zoneName: string;
  enterCount: number;
  exitCount: number;
  loiterCount: number;
}

interface ZoneTrafficPanelProps {
  from: string;
  to: string;
  zoneId?: string;
}

const COLORS = {
  enter: '#3b82f6',
  exit: '#8b5cf6',
  loiter: '#f59e0b',
};

export default function ZoneTrafficPanel({ from, to, zoneId }: ZoneTrafficPanelProps) {
  const [data, setData] = useState<ZoneTrafficData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    setIsLoading(true);

    const fetchData = async () => {
      try {
        if (!window.electronAPI?.analytics?.zoneTraffic) {
          setIsLoading(false);
          return;
        }
        const result = await window.electronAPI.analytics.zoneTraffic(from, to, zoneId);
        setData(result.data);
      } catch {
        setData([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [from, to, zoneId]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-500">
        Loading zone traffic...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-xs text-neutral-500">No zone traffic data for this period</p>
        <p className="max-w-xs text-[10px] text-neutral-600">Define zones in the Zone Editor and run the AI pipeline to generate zone entry/exit events.</p>
      </div>
    );
  }

  const maxCount = Math.max(1, ...data.flatMap((d) => [d.enterCount, d.exitCount, d.loiterCount]));

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      {data.map((zone) => (
        <div key={zone.zoneId} className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-300">{zone.zoneName}</span>
          <div className="flex flex-col gap-0.5">
            {/* Enter bar */}
            <div className="flex items-center gap-2">
              <span className="w-10 text-right text-[10px] text-neutral-500">Enter</span>
              <div className="relative h-3 flex-1 rounded-sm bg-neutral-800">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${(zone.enterCount / maxCount) * 100}%`,
                    backgroundColor: COLORS.enter,
                    opacity: 0.8,
                  }}
                />
              </div>
              <span className="w-8 text-right text-[10px] font-medium text-neutral-400">
                {zone.enterCount}
              </span>
            </div>
            {/* Exit bar */}
            <div className="flex items-center gap-2">
              <span className="w-10 text-right text-[10px] text-neutral-500">Exit</span>
              <div className="relative h-3 flex-1 rounded-sm bg-neutral-800">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${(zone.exitCount / maxCount) * 100}%`,
                    backgroundColor: COLORS.exit,
                    opacity: 0.8,
                  }}
                />
              </div>
              <span className="w-8 text-right text-[10px] font-medium text-neutral-400">
                {zone.exitCount}
              </span>
            </div>
            {/* Loiter bar */}
            {zone.loiterCount > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-10 text-right text-[10px] text-neutral-500">Loiter</span>
                <div className="relative h-3 flex-1 rounded-sm bg-neutral-800">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${(zone.loiterCount / maxCount) * 100}%`,
                      backgroundColor: COLORS.loiter,
                      opacity: 0.8,
                    }}
                  />
                </div>
                <span className="w-8 text-right text-[10px] font-medium text-neutral-400">
                  {zone.loiterCount}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="flex items-center gap-3 pt-1 text-[10px] text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.enter }} />
          Enter
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.exit }} />
          Exit
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.loiter }} />
          Loiter
        </span>
      </div>
    </div>
  );
}
