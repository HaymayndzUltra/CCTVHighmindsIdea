import { useCallback, useRef, useEffect } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface MiniPTZProps {
  cameraId: string;
}

type PtzDirection = 'move_up' | 'move_down' | 'move_left' | 'move_right';

export default function MiniPTZ({ cameraId }: MiniPTZProps) {
  const activeDirectionRef = useRef<PtzDirection | null>(null);

  const sendPtzCommand = useCallback(
    async (action: string, params: Record<string, unknown> = {}) => {
      try {
        if (window.electronAPI?.ptz?.command) {
          await window.electronAPI.ptz.command(cameraId, action, params);
        }
      } catch (error) {
        console.error(`[MiniPTZ] Command ${action} failed for ${cameraId}:`, error);
      }
    },
    [cameraId]
  );

  const handleDirectionStart = useCallback(
    (e: React.MouseEvent, direction: PtzDirection) => {
      e.stopPropagation();
      if (activeDirectionRef.current === direction) {
        return;
      }
      activeDirectionRef.current = direction;
      sendPtzCommand(direction, { speed: 30 });
    },
    [sendPtzCommand]
  );

  const handleDirectionStop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (activeDirectionRef.current) {
        activeDirectionRef.current = null;
        sendPtzCommand('stop');
      }
    },
    [sendPtzCommand]
  );

  // Stop PTZ on unmount
  useEffect(() => {
    return () => {
      if (activeDirectionRef.current) {
        sendPtzCommand('stop');
      }
    };
  }, [sendPtzCommand]);

  const btnClass =
    'flex items-center justify-center rounded bg-black/60 p-1 text-neutral-300 transition-colors hover:bg-black/80 hover:text-white active:bg-primary-600';

  return (
    <div
      className="grid grid-cols-3 grid-rows-3 gap-px"
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label="PTZ mini controls"
    >
      <div />
      <button
        className={btnClass}
        onMouseDown={(e) => handleDirectionStart(e, 'move_up')}
        onMouseUp={handleDirectionStop}
        onMouseLeave={handleDirectionStop}
        aria-label="Pan up"
      >
        <ChevronUp size={12} />
      </button>
      <div />

      <button
        className={btnClass}
        onMouseDown={(e) => handleDirectionStart(e, 'move_left')}
        onMouseUp={handleDirectionStop}
        onMouseLeave={handleDirectionStop}
        aria-label="Pan left"
      >
        <ChevronLeft size={12} />
      </button>
      <div />
      <button
        className={btnClass}
        onMouseDown={(e) => handleDirectionStart(e, 'move_right')}
        onMouseUp={handleDirectionStop}
        onMouseLeave={handleDirectionStop}
        aria-label="Pan right"
      >
        <ChevronRight size={12} />
      </button>

      <div />
      <button
        className={btnClass}
        onMouseDown={(e) => handleDirectionStart(e, 'move_down')}
        onMouseUp={handleDirectionStop}
        onMouseLeave={handleDirectionStop}
        aria-label="Pan down"
      >
        <ChevronDown size={12} />
      </button>
      <div />
    </div>
  );
}
