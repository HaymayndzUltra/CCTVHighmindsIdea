import { useEffect, useRef, useCallback } from 'react';
import { Video, VideoOff, Wifi, WifiOff } from 'lucide-react';
import { useWebRTCStream, WebRTCConnectionStatus } from '../../hooks/useWebRTCStream';
import { useStreamFrame, ConnectionStatus } from '../../hooks/useStreamFrame';
import MiniPTZ from '../MiniPTZ/MiniPTZ';
import DetectionOverlay from '../DetectionOverlay/DetectionOverlay';

interface CameraTileProps {
  cameraId: string;
  label: string;
  hasPtz?: boolean;
  miniPtzEnabled?: boolean;
  onSelect?: (cameraId: string) => void;
}

type DisplayStatus = 'connected' | 'connecting' | 'disconnected';

function mapWebRTCStatus(status: WebRTCConnectionStatus): DisplayStatus {
  if (status === 'connected') return 'connected';
  if (status === 'connecting') return 'connecting';
  return 'disconnected';
}

function mapLegacyStatus(status: ConnectionStatus): DisplayStatus {
  return status;
}

const STATUS_COLORS: Record<DisplayStatus, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-red-500',
};

const STATUS_LABELS: Record<DisplayStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting...',
  disconnected: 'Offline',
};

export default function CameraTile({ cameraId, label, hasPtz, miniPtzEnabled, onSelect }: CameraTileProps) {
  // WebRTC primary path
  const { videoRef, connectionStatus: webrtcStatus } = useWebRTCStream(cameraId);
  const isFallback = webrtcStatus === 'fallback';

  // Legacy canvas fallback path (only active when WebRTC fails)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const { frameRef, connectionStatus: legacyStatus } = useStreamFrame(isFallback ? cameraId : '');

  const renderFrame = useCallback(() => {
    if (!isFallback) return;
    const canvas = canvasRef.current;
    if (!canvas) {
      animationFrameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      animationFrameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    if (frameRef.current) {
      if (canvas.width !== frameRef.current.width || canvas.height !== frameRef.current.height) {
        canvas.width = frameRef.current.width;
        canvas.height = frameRef.current.height;
      }
      ctx.putImageData(frameRef.current, 0, 0);
    }

    animationFrameRef.current = requestAnimationFrame(renderFrame);
  }, [frameRef, isFallback]);

  useEffect(() => {
    if (!isFallback) return;
    animationFrameRef.current = requestAnimationFrame(renderFrame);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderFrame, isFallback]);

  // Determine effective display status
  const displayStatus: DisplayStatus = isFallback
    ? mapLegacyStatus(legacyStatus)
    : mapWebRTCStatus(webrtcStatus);

  const handleClick = () => {
    if (onSelect) {
      onSelect(cameraId);
    }
  };

  const isConnected = displayStatus === 'connected';
  const isOffline = displayStatus === 'disconnected';

  return (
    <div
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 transition-colors hover:border-neutral-600"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={`Camera ${label} - ${STATUS_LABELS[displayStatus]}`}
    >
      {/* Video display or placeholder */}
      <div className="relative aspect-video w-full bg-black">
        {/* WebRTC video element (primary path) */}
        {!isFallback && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 h-full w-full object-cover ${isConnected ? 'block' : 'hidden'}`}
          />
        )}

        {/* Legacy canvas fallback */}
        {isFallback && (
          <canvas
            ref={canvasRef}
            className={`absolute inset-0 h-full w-full ${isConnected ? 'block' : 'hidden'}`}
          />
        )}

        {isOffline ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-neutral-500">
            <VideoOff className="h-10 w-10" />
            <span className="text-sm font-medium">Camera Offline</span>
            <span className="text-xs text-neutral-600">Check connection or camera settings</span>
          </div>
        ) : !isConnected ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-neutral-500">
            <Video className="h-10 w-10 animate-pulse" />
            <span className="text-sm font-medium">Connecting...</span>
          </div>
        ) : null}

        {/* Camera label overlay (top-left) */}
        <div className="absolute left-2 top-2 flex items-center gap-2 rounded bg-black/70 px-2 py-1 backdrop-blur-sm">
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[displayStatus]}`} />
          <span className="text-xs font-medium text-neutral-200">{cameraId}</span>
          <span className="text-xs text-neutral-400">{label}</span>
        </div>

        {/* Connection status badge (top-right) */}
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 backdrop-blur-sm">
          {isConnected ? (
            <Wifi className="h-3 w-3 text-emerald-400" />
          ) : (
            <WifiOff className="h-3 w-3 text-red-400" />
          )}
          <span className={`text-xs ${isConnected ? 'text-emerald-400' : isOffline ? 'text-red-400' : 'text-amber-400'}`}>
            {STATUS_LABELS[displayStatus]}
          </span>
        </div>

        {/* Detection overlay — bounding boxes, labels, trails */}
        {isConnected && (
          <DetectionOverlay cameraId={cameraId} />
        )}

        {/* Mini PTZ overlay — only for PTZ cameras when enabled */}
        {hasPtz && miniPtzEnabled && isConnected && (
          <div className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
            <MiniPTZ cameraId={cameraId} />
          </div>
        )}
      </div>
    </div>
  );
}
