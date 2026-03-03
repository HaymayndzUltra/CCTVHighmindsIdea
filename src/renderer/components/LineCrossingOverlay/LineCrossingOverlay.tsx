import { useState, useRef, useCallback, useEffect } from 'react';
import { RotateCcw, Save, ArrowRightLeft } from 'lucide-react';

interface LineCoords {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type EnterDirection = 'enter_from_left' | 'enter_from_right';

interface LineCrossingOverlayProps {
  cameraId: string;
  isEditing?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
}

interface DrawState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function normalizeCoords(
  clientX: number,
  clientY: number,
  svgElement: SVGSVGElement
): { x: number; y: number } {
  const rect = svgElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  };
}

function getDirectionArrow(
  line: LineCoords,
  direction: EnterDirection
): { cx: number; cy: number; angle: number } {
  const midX = (line.x1 + line.x2) / 2;
  const midY = (line.y1 + line.y2) / 2;

  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;

  // Perpendicular direction (rotated 90°)
  const perpX = direction === 'enter_from_left' ? -dy : dy;
  const perpY = direction === 'enter_from_left' ? dx : -dx;

  const len = Math.sqrt(perpX * perpX + perpY * perpY);
  if (len === 0) {
    return { cx: midX, cy: midY, angle: 0 };
  }

  const normX = perpX / len;
  const normY = perpY / len;

  const arrowOffset = 5;
  const arrowX = midX + normX * arrowOffset;
  const arrowY = midY + normY * arrowOffset;

  const angleDeg = Math.atan2(normY, normX) * (180 / Math.PI);

  return { cx: arrowX, cy: arrowY, angle: angleDeg };
}

export default function LineCrossingOverlay({
  cameraId,
  isEditing = false,
  onEditingChange,
}: LineCrossingOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const [savedLine, setSavedLine] = useState<LineCoords | null>(null);
  const [direction, setDirection] = useState<EnterDirection>('enter_from_left');
  const [drawState, setDrawState] = useState<DrawState>({
    isDrawing: false,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
  });
  const [drawnLine, setDrawnLine] = useState<LineCoords | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Load existing line config on mount
  useEffect(() => {
    let isMounted = true;

    async function loadLineConfig() {
      try {
        if (window.electronAPI?.line?.get) {
          const config = await window.electronAPI.line.get(cameraId);
          if (isMounted && config) {
            setSavedLine({ x1: config.x1, y1: config.y1, x2: config.x2, y2: config.y2 });
            setDirection(config.enterDirection as EnterDirection);
          }
        }
      } catch (error) {
        console.error(`[LineCrossingOverlay] Failed to load config for ${cameraId}:`, error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadLineConfig();
    return () => { isMounted = false; };
  }, [cameraId]);

  // --- Drawing Interaction ---

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isEditing || !svgRef.current) return;
      e.preventDefault();

      const { x, y } = normalizeCoords(e.clientX, e.clientY, svgRef.current);
      setDrawState({ isDrawing: true, startX: x, startY: y, endX: x, endY: y });
      setDrawnLine(null);
    },
    [isEditing]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!drawState.isDrawing || !svgRef.current) return;
      e.preventDefault();

      const { x, y } = normalizeCoords(e.clientX, e.clientY, svgRef.current);
      setDrawState((prev) => ({ ...prev, endX: x, endY: y }));
    },
    [drawState.isDrawing]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!drawState.isDrawing || !svgRef.current) return;
      e.preventDefault();

      const { x, y } = normalizeCoords(e.clientX, e.clientY, svgRef.current);

      // Minimum line length check (at least 5% of viewport)
      const dx = x - drawState.startX;
      const dy = y - drawState.startY;
      const lineLength = Math.sqrt(dx * dx + dy * dy);

      if (lineLength >= 5) {
        setDrawnLine({
          x1: drawState.startX,
          y1: drawState.startY,
          x2: x,
          y2: y,
        });
      }

      setDrawState({ isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 });
    },
    [drawState.isDrawing, drawState.startX, drawState.startY]
  );

  // --- Direction Toggle ---

  const handleToggleDirection = useCallback(() => {
    setDirection((prev) =>
      prev === 'enter_from_left' ? 'enter_from_right' : 'enter_from_left'
    );
  }, []);

  // --- Save ---

  const handleSave = useCallback(async () => {
    const lineToSave = drawnLine ?? savedLine;
    if (!lineToSave) return;

    setIsSaving(true);
    try {
      if (window.electronAPI?.line?.save) {
        await window.electronAPI.line.save(
          cameraId,
          { ...lineToSave, enterDirection: direction },
          direction
        );
        setSavedLine(lineToSave);
        setDrawnLine(null);
        onEditingChange?.(false);
      }
    } catch (error) {
      console.error(`[LineCrossingOverlay] Failed to save config for ${cameraId}:`, error);
    } finally {
      setIsSaving(false);
    }
  }, [cameraId, drawnLine, savedLine, direction, onEditingChange]);

  // --- Clear ---

  const handleClear = useCallback(() => {
    setDrawnLine(null);
  }, []);

  // --- Render Helpers ---

  const activeLine = drawnLine ?? savedLine;
  const hasUnsavedChanges = drawnLine !== null;

  if (isLoading) {
    return null;
  }

  // When not editing, show the saved line as a non-interactive overlay
  if (!isEditing) {
    if (!savedLine) return null;

    const arrow = getDirectionArrow(savedLine, direction);

    return (
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1={savedLine.x1}
          y1={savedLine.y1}
          x2={savedLine.x2}
          y2={savedLine.y2}
          stroke="#22d3ee"
          strokeWidth="0.5"
          strokeDasharray="2 1"
          opacity={0.6}
        />
        <g
          transform={`translate(${arrow.cx}, ${arrow.cy}) rotate(${arrow.angle})`}
        >
          <polygon
            points="-1.5,-1 1.5,0 -1.5,1"
            fill="#22d3ee"
            opacity={0.6}
          />
        </g>
        <text
          x={(savedLine.x1 + savedLine.x2) / 2}
          y={Math.min(savedLine.y1, savedLine.y2) - 2}
          fill="#22d3ee"
          fontSize="2.5"
          textAnchor="middle"
          opacity={0.6}
        >
          ENTER
        </text>
      </svg>
    );
  }

  // Editing mode: interactive SVG overlay
  return (
    <div className="absolute inset-0 z-10">
      <svg
        ref={svgRef}
        className="h-full w-full cursor-crosshair"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        role="img"
        aria-label="Line crossing editor. Click and drag to draw a crossing line."
      >
        {/* Semi-transparent backdrop for edit mode */}
        <rect x="0" y="0" width="100" height="100" fill="black" opacity={0.15} />

        {/* Active line (saved or newly drawn) */}
        {activeLine && (
          <>
            <line
              x1={activeLine.x1}
              y1={activeLine.y1}
              x2={activeLine.x2}
              y2={activeLine.y2}
              stroke="#22d3ee"
              strokeWidth="0.8"
              strokeLinecap="round"
            />
            {/* Direction arrow */}
            {(() => {
              const arrow = getDirectionArrow(activeLine, direction);
              return (
                <g
                  transform={`translate(${arrow.cx}, ${arrow.cy}) rotate(${arrow.angle})`}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleDirection();
                  }}
                >
                  <circle r="2.5" fill="#22d3ee" opacity={0.3} />
                  <polygon
                    points="-1.8,-1.2 1.8,0 -1.8,1.2"
                    fill="#22d3ee"
                  />
                </g>
              );
            })()}
            {/* Direction label */}
            <text
              x={(activeLine.x1 + activeLine.x2) / 2}
              y={Math.min(activeLine.y1, activeLine.y2) - 3}
              fill="#22d3ee"
              fontSize="3"
              textAnchor="middle"
              fontWeight="bold"
            >
              ENTER ←
            </text>
          </>
        )}

        {/* Drawing in progress */}
        {drawState.isDrawing && (
          <line
            x1={drawState.startX}
            y1={drawState.startY}
            x2={drawState.endX}
            y2={drawState.endY}
            stroke="#facc15"
            strokeWidth="0.6"
            strokeDasharray="1.5 1"
            strokeLinecap="round"
          />
        )}

        {/* Instruction text if no line exists */}
        {!activeLine && !drawState.isDrawing && (
          <text
            x="50"
            y="50"
            fill="white"
            fontSize="3.5"
            textAnchor="middle"
            opacity={0.7}
          >
            Click and drag to draw a crossing line
          </text>
        )}
      </svg>

      {/* Toolbar */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2">
        <button
          onClick={handleToggleDirection}
          disabled={!activeLine}
          className="flex items-center gap-1.5 rounded-md bg-neutral-800/90 px-3 py-1.5 text-xs font-medium text-neutral-200 backdrop-blur-sm transition-colors hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Flip ENTER direction"
          aria-label="Flip enter direction"
        >
          <ArrowRightLeft size={14} />
          <span>Flip</span>
        </button>

        <button
          onClick={handleClear}
          disabled={!drawnLine}
          className="flex items-center gap-1.5 rounded-md bg-neutral-800/90 px-3 py-1.5 text-xs font-medium text-neutral-200 backdrop-blur-sm transition-colors hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Clear drawn line and redraw"
          aria-label="Clear and redraw"
        >
          <RotateCcw size={14} />
          <span>Redraw</span>
        </button>

        <button
          onClick={handleSave}
          disabled={!activeLine || isSaving}
          className="flex items-center gap-1.5 rounded-md bg-primary-600/90 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Save line configuration"
          aria-label="Save line configuration"
        >
          <Save size={14} />
          <span>{isSaving ? 'Saving...' : 'Save'}</span>
        </button>

        {hasUnsavedChanges && (
          <span className="text-[10px] text-amber-400">Unsaved</span>
        )}
      </div>
    </div>
  );
}
