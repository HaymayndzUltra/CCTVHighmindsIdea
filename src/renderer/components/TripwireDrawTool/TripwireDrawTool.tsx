import { useState, useCallback, useRef, useEffect } from 'react';

interface TripwireLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  direction: string;
}

interface TripwireDrawToolProps {
  initialLine?: TripwireLine;
  color?: string;
  onChange: (line: TripwireLine) => void;
}

/**
 * SVG-based tripwire drawing tool overlaid on camera preview.
 *
 * Coordinates are normalized 0..1 (relative to container).
 * - Click start point → click end point to create line
 * - Drag endpoints to reposition
 * - Direction arrow shows IN/OUT side
 */
export default function TripwireDrawTool({
  initialLine,
  color = '#F59E0B',
  onChange,
}: TripwireDrawToolProps) {
  const [line, setLine] = useState<TripwireLine | null>(initialLine ?? null);
  const [placingStart, setPlacingStart] = useState(!initialLine);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    initialLine ? { x: initialLine.x1, y: initialLine.y1 } : null
  );
  const [draggingEndpoint, setDraggingEndpoint] = useState<'start' | 'end' | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (initialLine) {
      setLine(initialLine);
      setStartPoint({ x: initialLine.x1, y: initialLine.y1 });
      setPlacingStart(false);
    }
  }, []);

  const getNormalizedCoords = useCallback(
    (e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    },
    []
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (draggingEndpoint) return;
      const coords = getNormalizedCoords(e);
      if (!coords) return;

      if (placingStart) {
        setStartPoint(coords);
        setPlacingStart(false);
        return;
      }

      if (startPoint && !line) {
        const newLine: TripwireLine = {
          x1: startPoint.x,
          y1: startPoint.y,
          x2: coords.x,
          y2: coords.y,
          direction: 'left_to_right',
        };
        setLine(newLine);
        onChange(newLine);
      }
    },
    [placingStart, startPoint, line, draggingEndpoint, getNormalizedCoords, onChange]
  );

  const handleEndpointMouseDown = useCallback(
    (endpoint: 'start' | 'end', e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setDraggingEndpoint(endpoint);
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!draggingEndpoint || !line) return;
      const coords = getNormalizedCoords(e);
      if (!coords) return;

      const updated = { ...line };
      if (draggingEndpoint === 'start') {
        updated.x1 = coords.x;
        updated.y1 = coords.y;
      } else {
        updated.x2 = coords.x;
        updated.y2 = coords.y;
      }
      setLine(updated);
      onChange(updated);
    },
    [draggingEndpoint, line, getNormalizedCoords, onChange]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingEndpoint(null);
  }, []);

  const toggleDirection = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!line) return;
      const newDir = line.direction === 'left_to_right' ? 'right_to_left' : 'left_to_right';
      const updated = { ...line, direction: newDir };
      setLine(updated);
      onChange(updated);
    },
    [line, onChange]
  );

  // Calculate arrow direction indicator
  const getArrowPoints = (): { midX: number; midY: number; angle: number } | null => {
    if (!line) return null;
    const midX = (line.x1 + line.x2) / 2;
    const midY = (line.y1 + line.y2) / 2;
    // Perpendicular to the line — indicates the IN direction
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    // Normal vector (perpendicular)
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    // Arrow points perpendicular to line — IN side
    if (line.direction === 'left_to_right') {
      angle += 90; // Arrow pointing to the right of the line direction
    } else {
      angle -= 90; // Arrow pointing to the left
    }
    return { midX, midY, angle };
  };

  const arrow = getArrowPoints();

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full cursor-crosshair"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Tripwire line */}
      {line && (
        <>
          {/* Shadow */}
          <line
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="#000"
            strokeWidth={0.008}
            strokeOpacity={0.3}
          />
          {/* Main line */}
          <line
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={color}
            strokeWidth={0.005}
            strokeOpacity={0.9}
          />

          {/* Direction arrow at midpoint */}
          {arrow && (
            <g
              transform={`translate(${arrow.midX}, ${arrow.midY})`}
              onClick={toggleDirection}
              style={{ cursor: 'pointer' }}
            >
              {/* Arrow triangle */}
              <polygon
                points="0,-0.02 0.012,0.008 -0.012,0.008"
                fill={color}
                fillOpacity={0.9}
                stroke="#fff"
                strokeWidth={0.002}
                transform={`rotate(${arrow.angle})`}
              />
              {/* IN label */}
              <text
                x={0}
                y={-0.03}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={color}
                fontSize={0.018}
                fontWeight="bold"
                transform={`rotate(${arrow.angle}) translate(0, -0.01)`}
              >
                IN
              </text>
            </g>
          )}

          {/* Start endpoint */}
          <circle
            cx={line.x1}
            cy={line.y1}
            r={0.014}
            fill={color}
            fillOpacity={0.9}
            stroke="#fff"
            strokeWidth={0.003}
            style={{ cursor: 'grab' }}
            onMouseDown={(e) => handleEndpointMouseDown('start', e)}
          />

          {/* End endpoint */}
          <circle
            cx={line.x2}
            cy={line.y2}
            r={0.014}
            fill={color}
            fillOpacity={0.9}
            stroke="#fff"
            strokeWidth={0.003}
            style={{ cursor: 'grab' }}
            onMouseDown={(e) => handleEndpointMouseDown('end', e)}
          />
        </>
      )}

      {/* Placing start point indicator */}
      {placingStart && (
        <text
          x={0.5}
          y={0.5}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#94A3B8"
          fontSize={0.025}
        >
          Click to place start point
        </text>
      )}

      {/* Start point placed, waiting for end */}
      {startPoint && !line && !placingStart && (
        <>
          <circle
            cx={startPoint.x}
            cy={startPoint.y}
            r={0.014}
            fill={color}
            fillOpacity={0.9}
            stroke="#fff"
            strokeWidth={0.003}
          />
          <text
            x={0.5}
            y={0.95}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#F59E0B"
            fontSize={0.02}
          >
            Click to place end point
          </text>
        </>
      )}

      {/* Direction toggle hint */}
      {line && (
        <text
          x={0.5}
          y={0.95}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#94A3B8"
          fontSize={0.016}
        >
          Click arrow to toggle IN/OUT direction • Drag endpoints to reposition
        </text>
      )}
    </svg>
  );
}
