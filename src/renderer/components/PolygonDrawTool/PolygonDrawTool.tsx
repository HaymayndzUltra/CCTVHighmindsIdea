import { useState, useCallback, useRef, useEffect } from 'react';

interface PolygonDrawToolProps {
  initialPoints?: Array<{ x: number; y: number }>;
  color?: string;
  onChange: (points: Array<{ x: number; y: number }>) => void;
}

/**
 * SVG-based polygon drawing tool overlaid on camera preview.
 *
 * Coordinates are normalized 0..1 (relative to container).
 * - Click to add vertices
 * - Double-click to close polygon
 * - In edit mode: drag vertices, right-click to delete vertex
 */
export default function PolygonDrawTool({
  initialPoints = [],
  color = '#EF4444',
  onChange,
}: PolygonDrawToolProps) {
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>(initialPoints);
  const [isClosed, setIsClosed] = useState(initialPoints.length >= 3);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Sync initial points
  useEffect(() => {
    if (initialPoints.length > 0) {
      setPoints(initialPoints);
      setIsClosed(initialPoints.length >= 3);
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
      if (isClosed || draggingIndex !== null) return;
      e.preventDefault();

      const coords = getNormalizedCoords(e);
      if (!coords) return;

      const newPoints = [...points, coords];
      setPoints(newPoints);
      onChange(newPoints);
    },
    [points, isClosed, draggingIndex, getNormalizedCoords, onChange]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (points.length >= 3) {
        setIsClosed(true);
        onChange(points);
      }
    },
    [points, onChange]
  );

  const handleVertexMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setDraggingIndex(index);
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (draggingIndex === null) return;
      const coords = getNormalizedCoords(e);
      if (!coords) return;

      const newPoints = [...points];
      newPoints[draggingIndex] = coords;
      setPoints(newPoints);
      onChange(newPoints);
    },
    [draggingIndex, points, getNormalizedCoords, onChange]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingIndex(null);
  }, []);

  const handleVertexRightClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (points.length <= 3 && isClosed) return; // Keep minimum 3 vertices
      const newPoints = points.filter((_, i) => i !== index);
      setPoints(newPoints);
      onChange(newPoints);
      if (newPoints.length < 3) {
        setIsClosed(false);
      }
    },
    [points, isClosed, onChange]
  );

  const pointsStr = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full cursor-crosshair"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Polygon fill */}
      {points.length >= 3 && isClosed && (
        <polygon
          points={pointsStr}
          fill={color}
          fillOpacity={0.2}
          stroke={color}
          strokeWidth={0.003}
          strokeOpacity={0.8}
          strokeDasharray={isClosed ? 'none' : '0.01 0.005'}
        />
      )}

      {/* Open polyline while drawing */}
      {points.length >= 2 && !isClosed && (
        <polyline
          points={pointsStr}
          fill="none"
          stroke={color}
          strokeWidth={0.003}
          strokeOpacity={0.8}
          strokeDasharray="0.01 0.005"
        />
      )}

      {/* Edge lines for closed polygon */}
      {isClosed && points.length >= 3 &&
        points.map((p, i) => {
          const next = points[(i + 1) % points.length]!;
          return (
            <line
              key={`edge-${i}`}
              x1={p.x}
              y1={p.y}
              x2={next.x}
              y2={next.y}
              stroke={color}
              strokeWidth={0.004}
              strokeOpacity={0.9}
            />
          );
        })}

      {/* Vertices */}
      {points.map((p, i) => (
        <circle
          key={`vertex-${i}`}
          cx={p.x}
          cy={p.y}
          r={0.012}
          fill={i === 0 && !isClosed && points.length >= 3 ? '#22C55E' : color}
          fillOpacity={0.9}
          stroke="#fff"
          strokeWidth={0.003}
          style={{ cursor: isClosed ? 'grab' : 'pointer' }}
          onMouseDown={(e) => handleVertexMouseDown(i, e)}
          onContextMenu={(e) => handleVertexRightClick(i, e)}
        />
      ))}

      {/* Instructions overlay */}
      {!isClosed && points.length === 0 && (
        <text
          x={0.5}
          y={0.5}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#94A3B8"
          fontSize={0.025}
        >
          Click to place vertices
        </text>
      )}

      {!isClosed && points.length >= 3 && (
        <text
          x={0.5}
          y={0.95}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#22C55E"
          fontSize={0.02}
        >
          Double-click to close polygon
        </text>
      )}
    </svg>
  );
}
