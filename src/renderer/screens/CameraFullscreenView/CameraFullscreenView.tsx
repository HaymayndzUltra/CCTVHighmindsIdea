import { useEffect, useRef, useCallback, useState } from 'react';
import { ArrowLeft, Wifi, WifiOff, Video, VideoOff, Maximize2, Eye, EyeOff, Box, Play, Pause, SkipForward, SkipBack } from 'lucide-react';
import { useWebRTCStream, WebRTCConnectionStatus } from '../../hooks/useWebRTCStream';
import { useStreamFrame, ConnectionStatus } from '../../hooks/useStreamFrame';
import PTZControls from '../../components/PTZControls/PTZControls';
import DetectionOverlay from '../../components/DetectionOverlay/DetectionOverlay';
import OverlayContextMenu, { ContextMenuAction } from '../../components/DetectionOverlay/OverlayContextMenu';
import RecordingIndicator from '../../components/RecordingIndicator/RecordingIndicator';
import TimelineScrubber from '../../components/TimelineScrubber/TimelineScrubber';
import type { Zone } from '../../../shared/types';

interface CameraFullscreenViewProps {
  cameraId: string;
  cameraLabel: string;
  cameraModel: string;
  hasPtz: boolean;
  onBack: () => void;
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
  connected: 'text-emerald-400',
  connecting: 'text-amber-400',
  disconnected: 'text-red-400',
};

const STATUS_LABELS: Record<DisplayStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting...',
  disconnected: 'Offline',
};

export default function CameraFullscreenView({
  cameraId,
  cameraLabel,
  cameraModel,
  hasPtz,
  onBack,
}: CameraFullscreenViewProps) {
  // WebRTC primary path
  const { videoRef, connectionStatus: webrtcStatus } = useWebRTCStream(cameraId);
  const isFallback = webrtcStatus === 'fallback';

  // Legacy canvas fallback path (only active when WebRTC fails)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const { frameRef, connectionStatus: legacyStatus } = useStreamFrame(isFallback ? cameraId : '');

  const [zones, setZones] = useState<Zone[]>([]);
  const [showZones, setShowZones] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);

  // Playback state
  const [isPlaybackMode, setIsPlaybackMode] = useState(false);
  const [playbackDate, setPlaybackDate] = useState(new Date());
  const [playbackPosition, setPlaybackPosition] = useState<Date | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackVideoRef = useRef<HTMLVideoElement>(null);
  const [timelineEvents, setTimelineEvents] = useState<Array<{ id: string; timestamp: string; eventType: string }>>([]);
  const [timelineSegments, setTimelineSegments] = useState<Array<{ id: string; start_time: string; end_time: string }>>([]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    trackId: number;
    objectClass: string;
    personId: string | null;
  } | null>(null);

  // Load zones for this camera
  useEffect(() => {
    window.electronAPI.zone.list(cameraId).then((result) => {
      setZones(result.zones);
    }).catch((err) => {
      console.error('[CameraFullscreen] Failed to load zones:', err);
    });
  }, [cameraId]);

  // Load timeline data when timeline is shown
  useEffect(() => {
    if (!showTimeline) return;

    const dayStart = new Date(playbackDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const fromStr = dayStart.toISOString();
    const toStr = dayEnd.toISOString();

    // Fetch events for the day
    window.electronAPI.events
      .list({ cameraId, dateFrom: fromStr, dateTo: toStr, limit: 500 })
      .then((events) => {
        setTimelineEvents(
          (events as Array<{ id: string; createdAt: string; eventType: string }>).map((e) => ({
            id: e.id,
            timestamp: e.createdAt,
            eventType: e.eventType,
          }))
        );
      })
      .catch(() => setTimelineEvents([]));

    // Fetch recording segments for the day
    if (window.electronAPI.recording?.segments) {
      window.electronAPI.recording
        .segments(cameraId, fromStr, toStr)
        .then((result) => {
          setTimelineSegments(result.segments);
        })
        .catch(() => setTimelineSegments([]));
    }
  }, [cameraId, playbackDate, showTimeline]);

  const handleTimeSelect = useCallback(
    async (timestamp: Date) => {
      setPlaybackPosition(timestamp);
      setIsPlaybackMode(true);
      console.log(`[CameraFullscreen] Playback requested at ${timestamp.toISOString()}`);
      // Find matching segment and load for playback
      const ts = timestamp.getTime();
      const matchingSegment = timelineSegments.find((seg: { id: string; start_time: string; end_time: string }) => {
        const start = new Date(seg.start_time).getTime();
        const end = new Date(seg.end_time).getTime();
        return ts >= start && ts <= end;
      });
      if (matchingSegment && window.electronAPI.recording?.playback) {
        try {
          const result = await window.electronAPI.recording.playback(matchingSegment.id) as { filePath?: string } | null;
          if (result?.filePath && playbackVideoRef.current) {
            playbackVideoRef.current.src = `file://${result.filePath}`;
            // Seek to the offset within the segment
            const segStart = new Date(matchingSegment.start_time).getTime();
            const offsetSec = (ts - segStart) / 1000;
            playbackVideoRef.current.currentTime = Math.max(0, offsetSec);
            playbackVideoRef.current.play();
            setIsPlaying(true);
          }
        } catch (err) {
          console.error('[CameraFullscreen] Playback load failed:', err);
        }
      } else {
        console.warn('[CameraFullscreen] No matching recording segment found for timestamp');
      }
    },
    []
  );

  const togglePlayback = useCallback(() => {
    if (playbackVideoRef.current) {
      if (isPlaying) {
        playbackVideoRef.current.pause();
      } else {
        playbackVideoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const exitPlaybackMode = useCallback(() => {
    setIsPlaybackMode(false);
    setPlaybackPosition(null);
    setIsPlaying(false);
    if (playbackVideoRef.current) {
      playbackVideoRef.current.pause();
      playbackVideoRef.current.src = '';
    }
  }, []);

  const cyclePlaybackSpeed = useCallback(() => {
    const speeds = [1, 2, 4, 8];
    const currentIdx = speeds.indexOf(playbackSpeed);
    const nextSpeed = speeds[(currentIdx + 1) % speeds.length];
    setPlaybackSpeed(nextSpeed);
    if (playbackVideoRef.current) {
      playbackVideoRef.current.playbackRate = nextSpeed;
    }
  }, [playbackSpeed]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
        } else {
          e.preventDefault();
          onBack();
        }
      }
      // Toggle overlay with 'O' key
      if (e.key === 'o' || e.key === 'O') {
        setShowOverlay((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack, contextMenu]);

  const handleBoxClick = useCallback(
    (trackId: number, objectClass: string, personId: string | null) => {
      console.log(`[CameraFullscreen] Box clicked: track=${trackId}, class=${objectClass}, person=${personId}`);
      // Navigate to person detail if a known person was clicked
      if (personId && objectClass === 'person') {
        // Emit custom event for the app to handle navigation to PersonDirectory with selected person
        window.dispatchEvent(new CustomEvent('navigate:person', { detail: { personId } }));
      }
    },
    []
  );

  const handleBoxContextMenu = useCallback(
    (
      event: React.MouseEvent,
      trackId: number,
      objectClass: string,
      personId: string | null,
    ) => {
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        trackId,
        objectClass,
        personId,
      });
    },
    []
  );

  const handleContextMenuAction = useCallback(
    async (action: ContextMenuAction) => {
      console.log(`[CameraFullscreen] Context menu action: ${action.type}`, action);
      // Dispatch enrollment, false positive, or PTZ tracking actions
      try {
        if (action.type === 'enroll') {
          // Trigger face enrollment — user will need to provide a name via dialog
          console.log(`[CameraFullscreen] Enrollment requested for track ${action.trackId}`);
          // Dispatch navigation to person enrollment screen
          window.dispatchEvent(new CustomEvent('navigate:enroll', { detail: { trackId: action.trackId, cameraId } }));
        } else if (action.type === 'false_positive' && action.personId) {
          // Mark detection as false positive via negative gallery IPC
          await window.electronAPI.person.delete(action.personId);
          console.log('[CameraFullscreen] False positive reported');
        } else if (action.type === 'track' && action.trackId != null) {
          // Start PTZ auto-tracking via ptz:command IPC
          await window.electronAPI.ptz.command(cameraId, 'autotrack:start', { trackId: action.trackId });
          console.log(`[CameraFullscreen] PTZ auto-track started for track ${action.trackId}`);
        }
      } catch (err) {
        console.error('[CameraFullscreen] Context menu action failed:', err);
      }
    },
    [cameraId]
  );

  // Determine effective display status
  const displayStatus: DisplayStatus = isFallback
    ? mapLegacyStatus(legacyStatus)
    : mapWebRTCStatus(webrtcStatus);

  const isConnected = displayStatus === 'connected';
  const isOffline = displayStatus === 'disconnected';

  return (
    <div className="flex h-full flex-col bg-black">
      {/* Camera info header */}
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/90 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
            aria-label="Back to dashboard"
            title="Back to dashboard (Esc)"
          >
            <ArrowLeft size={18} strokeWidth={1.5} />
            <span>Back</span>
          </button>

          <div className="h-5 w-px bg-neutral-700" />

          <div className="flex items-center gap-2">
            <Maximize2 size={16} className="text-neutral-500" />
            <span className="text-sm font-semibold text-neutral-100">{cameraId}</span>
            <span className="text-sm text-neutral-400">{cameraLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-neutral-500">{cameraModel}</span>

          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              showTimeline
                ? 'bg-blue-600/20 text-blue-400'
                : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'
            }`}
            title={showTimeline ? 'Hide timeline' : 'Show timeline'}
          >
            Timeline
          </button>

          <div className="flex items-center gap-1.5">
            {isConnected ? (
              <Wifi size={14} className="text-emerald-400" />
            ) : (
              <WifiOff size={14} className="text-red-400" />
            )}
            <span className={`text-xs font-medium ${STATUS_COLORS[displayStatus]}`}>
              {STATUS_LABELS[displayStatus]}
            </span>
          </div>
        </div>
      </div>

      {/* Full-window video display */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {/* WebRTC video element (primary path) */}
        {!isFallback && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`max-h-full max-w-full object-contain ${isConnected ? 'block' : 'hidden'}`}
          />
        )}

        {/* Legacy canvas fallback */}
        {isFallback && isConnected && (
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full object-contain"
          />
        )}

        {!isConnected && isOffline && (
          <div className="flex flex-col items-center justify-center gap-3 text-neutral-500">
            <VideoOff className="h-16 w-16" />
            <span className="text-lg font-medium">Camera Offline</span>
            <span className="text-sm text-neutral-600">
              Check connection or camera settings
            </span>
          </div>
        )}

        {!isConnected && !isOffline && (
          <div className="flex flex-col items-center justify-center gap-3 text-neutral-500">
            <Video className="h-16 w-16 animate-pulse" />
            <span className="text-lg font-medium">Connecting...</span>
          </div>
        )}

        {/* Zone overlay — semi-transparent polygons/tripwires */}
        {showZones && zones.length > 0 && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
          >
            {zones.map((zone) => {
              try {
                const geom = typeof zone.geometry === 'string' ? JSON.parse(zone.geometry) : zone.geometry;
                if (zone.zoneType === 'TRIPWIRE' && geom && 'x1' in geom) {
                  return (
                    <line
                      key={zone.id}
                      x1={geom.x1}
                      y1={geom.y1}
                      x2={geom.x2}
                      y2={geom.y2}
                      stroke={zone.color}
                      strokeWidth={0.004}
                      strokeOpacity={0.7}
                    />
                  );
                }
                if (geom && 'points' in geom && Array.isArray(geom.points) && geom.points.length >= 3) {
                  const pointsStr = geom.points.map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(' ');
                  return (
                    <g key={zone.id}>
                      <polygon
                        points={pointsStr}
                        fill={zone.color}
                        fillOpacity={0.12}
                        stroke={zone.color}
                        strokeWidth={0.003}
                        strokeOpacity={0.6}
                      />
                      {/* Zone label at centroid */}
                      <text
                        x={geom.points.reduce((s: number, p: { x: number }) => s + p.x, 0) / geom.points.length}
                        y={geom.points.reduce((s: number, p: { y: number }) => s + p.y, 0) / geom.points.length}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={zone.color}
                        fontSize={0.018}
                        fontWeight="600"
                        opacity={0.8}
                      >
                        {zone.name}
                      </text>
                    </g>
                  );
                }
              } catch { /* ignore parse errors */ }
              return null;
            })}
          </svg>
        )}

        {/* Detection overlay — bounding boxes, labels, trails, interactions */}
        {isConnected && (
          <DetectionOverlay
            cameraId={cameraId}
            visible={showOverlay}
            onBoxClick={handleBoxClick}
            onBoxContextMenu={handleBoxContextMenu}
          />
        )}

        {/* Overlay toggle buttons */}
        <div className="absolute left-4 top-4 flex items-center gap-2">
          {zones.length > 0 && (
            <button
              onClick={() => setShowZones(!showZones)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium backdrop-blur-sm transition-colors ${
                showZones
                  ? 'bg-primary-600/30 text-primary-300'
                  : 'bg-neutral-900/60 text-neutral-500'
              }`}
              title={showZones ? 'Hide zones' : 'Show zones'}
            >
              {showZones ? <Eye size={13} /> : <EyeOff size={13} />}
              Zones
            </button>
          )}
          <button
            onClick={() => setShowOverlay(!showOverlay)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium backdrop-blur-sm transition-colors ${
              showOverlay
                ? 'bg-emerald-600/30 text-emerald-300'
                : 'bg-neutral-900/60 text-neutral-500'
            }`}
            title={showOverlay ? 'Hide detections (O)' : 'Show detections (O)'}
          >
            <Box size={13} />
            Detections
          </button>
        </div>

        {/* Recording indicator (top-right, below status) */}
        <div className="absolute right-4 top-4">
          <RecordingIndicator cameraId={cameraId} compact />
        </div>

        {/* Playback video element (hidden during live, shown during playback) */}
        {isPlaybackMode && (
          <video
            ref={playbackVideoRef}
            className="max-h-full max-w-full object-contain"
            controls={false}
          />
        )}

        {/* Playback controls overlay */}
        {isPlaybackMode && (
          <div className="absolute bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-black/80 px-4 py-2 backdrop-blur-sm">
            <button
              onClick={exitPlaybackMode}
              className="text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
            >
              ← Live
            </button>
            <div className="h-4 w-px bg-neutral-700" />
            <button
              onClick={() => {
                if (playbackVideoRef.current) playbackVideoRef.current.currentTime -= 10;
              }}
              className="text-neutral-400 transition-colors hover:text-neutral-200"
              title="Skip back 10s"
            >
              <SkipBack size={16} />
            </button>
            <button
              onClick={togglePlayback}
              className="rounded-full bg-neutral-700 p-1.5 text-neutral-200 transition-colors hover:bg-neutral-600"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={() => {
                if (playbackVideoRef.current) playbackVideoRef.current.currentTime += 10;
              }}
              className="text-neutral-400 transition-colors hover:text-neutral-200"
              title="Skip forward 10s"
            >
              <SkipForward size={16} />
            </button>
            <button
              onClick={cyclePlaybackSpeed}
              className="rounded-md px-1.5 py-0.5 text-xs font-bold text-neutral-300 transition-colors hover:bg-neutral-700"
              title="Playback speed"
            >
              {playbackSpeed}x
            </button>
          </div>
        )}

        {/* PTZ Controls overlay — only rendered for PTZ cameras */}
        {hasPtz && !isPlaybackMode && (
          <div className="absolute bottom-4 right-4">
            <PTZControls cameraId={cameraId} />
          </div>
        )}
      </div>

      {/* Timeline scrubber */}
      {showTimeline && (
        <TimelineScrubber
          events={timelineEvents}
          segments={timelineSegments}
          date={playbackDate}
          onDateChange={setPlaybackDate}
          onTimeSelect={handleTimeSelect}
          playbackPosition={playbackPosition}
          isLive={!isPlaybackMode}
        />
      )}

      {/* Context menu for detection box right-click actions */}
      {contextMenu && (
        <OverlayContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          trackId={contextMenu.trackId}
          objectClass={contextMenu.objectClass}
          personId={contextMenu.personId}
          onAction={handleContextMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
