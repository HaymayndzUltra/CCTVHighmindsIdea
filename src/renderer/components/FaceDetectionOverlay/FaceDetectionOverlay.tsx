import { useRef, useEffect, useCallback } from 'react';
import { useDetectionOverlay, OverlayFace } from '../../hooks/useDetectionOverlay';

interface FaceDetectionOverlayProps {
  cameraId: string;
  /** Native detection resolution width (default: 1920) */
  detectionWidth?: number;
  /** Native detection resolution height (default: 1080) */
  detectionHeight?: number;
}

// --- Constants ---

const KNOWN_BOX_COLOR = '#22c55e';   // green-500
const UNKNOWN_BOX_COLOR = '#ef4444'; // red-500
const KNOWN_TEXT_BG = 'rgba(34, 197, 94, 0.85)';
const UNKNOWN_TEXT_BG = 'rgba(239, 68, 68, 0.85)';
const BOX_LINE_WIDTH = 2;
const FONT_SIZE = 12;
const LABEL_PADDING_X = 6;
const LABEL_PADDING_Y = 3;

/**
 * Transparent canvas overlay on CameraTile that draws bounding boxes and labels
 * from ai:detection IPC data.
 *
 * - Green box + name for known persons
 * - Red box + "Unknown" for unknown persons
 * - Confidence score displayed below the label
 * - Scales bbox coordinates from detection resolution to display canvas size
 */
export default function FaceDetectionOverlay({
  cameraId,
  detectionWidth = 1920,
  detectionHeight = 1080,
}: FaceDetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const { faces } = useDetectionOverlay(cameraId);
  const facesRef = useRef<OverlayFace[]>(faces);

  // Keep facesRef in sync to avoid re-creating the render loop
  useEffect(() => {
    facesRef.current = faces;
  }, [faces]);

  const renderOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      animationFrameRef.current = requestAnimationFrame(renderOverlay);
      return;
    }

    const displayWidth = container.clientWidth;
    const displayHeight = container.clientHeight;

    // Match canvas internal resolution to display size
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      animationFrameRef.current = requestAnimationFrame(renderOverlay);
      return;
    }

    // Clear previous frame
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const currentFaces = facesRef.current;
    if (currentFaces.length === 0) {
      animationFrameRef.current = requestAnimationFrame(renderOverlay);
      return;
    }

    // Scale factors: detection resolution → display resolution
    const scaleX = displayWidth / detectionWidth;
    const scaleY = displayHeight / detectionHeight;

    for (const face of currentFaces) {
      drawFaceBox(ctx, face, scaleX, scaleY);
    }

    animationFrameRef.current = requestAnimationFrame(renderOverlay);
  }, [detectionWidth, detectionHeight]);

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(renderOverlay);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderOverlay]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full"
      />
    </div>
  );
}

// --- Drawing Helpers ---

function drawFaceBox(
  ctx: CanvasRenderingContext2D,
  face: OverlayFace,
  scaleX: number,
  scaleY: number,
): void {
  const { bbox, label, confidence, isKnown } = face;

  // Scale bbox coordinates from detection space to display space
  const x1 = bbox.x1 * scaleX;
  const y1 = bbox.y1 * scaleY;
  const x2 = bbox.x2 * scaleX;
  const y2 = bbox.y2 * scaleY;
  const boxWidth = x2 - x1;
  const boxHeight = y2 - y1;

  if (boxWidth <= 0 || boxHeight <= 0) {
    return;
  }

  const boxColor = isKnown ? KNOWN_BOX_COLOR : UNKNOWN_BOX_COLOR;
  const textBg = isKnown ? KNOWN_TEXT_BG : UNKNOWN_TEXT_BG;

  // Draw bounding box
  ctx.strokeStyle = boxColor;
  ctx.lineWidth = BOX_LINE_WIDTH;
  ctx.strokeRect(x1, y1, boxWidth, boxHeight);

  // Draw label background + text
  ctx.font = `bold ${FONT_SIZE}px Inter, system-ui, sans-serif`;
  const displayLabel = label || (isKnown ? 'Known' : 'Unknown');
  const confidenceText = `${Math.round(confidence * 100)}%`;
  const fullText = `${displayLabel} ${confidenceText}`;

  const textMetrics = ctx.measureText(fullText);
  const textWidth = textMetrics.width;
  const labelHeight = FONT_SIZE + LABEL_PADDING_Y * 2;

  // Position label above the box, or inside if no room above
  const labelY = y1 - labelHeight > 0 ? y1 - labelHeight : y1;
  const labelX = x1;

  // Label background
  ctx.fillStyle = textBg;
  ctx.fillRect(labelX, labelY, textWidth + LABEL_PADDING_X * 2, labelHeight);

  // Label text
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(fullText, labelX + LABEL_PADDING_X, labelY + labelHeight / 2);
}
