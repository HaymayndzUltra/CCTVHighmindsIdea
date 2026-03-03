import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  // Stream management (AI sub-stream via FFmpeg)
  stream: {
    start: (cameraId: string) => ipcRenderer.invoke('stream:start', { cameraId }),
    stop: (cameraId: string) => ipcRenderer.invoke('stream:stop', { cameraId }),
    go2rtcStatus: () => ipcRenderer.invoke('stream:go2rtc_status'),
    onFrame: (callback: (data: { cameraId: string; frameBuffer: Buffer; timestamp: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { cameraId: string; frameBuffer: Buffer; timestamp: number }) => callback(data);
      ipcRenderer.on('stream:frame', listener);
      return () => ipcRenderer.removeListener('stream:frame', listener);
    },
  },

  // WebRTC streaming (display path via go2rtc)
  webrtc: {
    start: (cameraId: string) =>
      ipcRenderer.invoke('webrtc:start', { cameraId }) as Promise<{
        success: boolean;
        signalingUrl: string;
        streamName: string;
        subStreamUrl: string | null;
        go2rtcApiBase: string;
      }>,
    signal: (cameraId: string, sdpOffer: string) =>
      ipcRenderer.invoke('webrtc:signal', { cameraId, sdpOffer }) as Promise<{
        success: boolean;
        sdpAnswer: string;
      }>,
    stop: (cameraId: string) => ipcRenderer.invoke('webrtc:stop', { cameraId }),
    state: (cameraId: string) =>
      ipcRenderer.invoke('webrtc:state', { cameraId }) as Promise<{
        state: 'idle' | 'negotiating' | 'connected' | 'failed' | 'stopped';
        useFallback: boolean;
        negotiationAttempts: number;
        lastError: string | null;
      }>,
  },

  // Recording management
  recording: {
    start: (cameraId: string, mode?: string) =>
      ipcRenderer.invoke('recording:start', { cameraId, mode }) as Promise<{ success: boolean }>,
    stop: (cameraId: string) =>
      ipcRenderer.invoke('recording:stop', { cameraId }) as Promise<{ success: boolean }>,
    status: (cameraId?: string) =>
      ipcRenderer.invoke('recording:status', cameraId ? { cameraId } : undefined),
    segments: (cameraId: string, from: string, to: string) =>
      ipcRenderer.invoke('recording:segments', { cameraId, from, to }) as Promise<{
        segments: Array<{
          id: string;
          camera_id: string;
          file_path: string;
          start_time: string;
          end_time: string;
          duration_sec: number;
          file_size_bytes: number | null;
          format: string;
          recording_mode: string;
        }>;
      }>,
    playback: (segmentId: string) =>
      ipcRenderer.invoke('recording:playback', { segmentId }) as Promise<{ filePath: string }>,
    diskUsage: () =>
      ipcRenderer.invoke('recording:disk-usage') as Promise<{
        totalBytes: number;
        perCamera: Record<string, number>;
      }>,
  },

  // Sound events
  sound: {
    onEvent: (callback: (data: {
      cameraId: string;
      events: Array<{ sound_class: string; confidence: number; start_ms: number; end_ms: number }>;
      timestamp: number;
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as Parameters<typeof callback>[0]);
      ipcRenderer.on('sound:event', listener);
      return () => ipcRenderer.removeListener('sound:event', listener);
    },
  },

  // LLM (Ollama)
  llm: {
    status: () =>
      ipcRenderer.invoke('llm:status') as Promise<{
        status: 'unknown' | 'running' | 'stopped' | 'error';
        modelLoaded: boolean;
        modelName: string;
        lastError: string | null;
      }>,
    summary: (date: string, generate?: boolean) =>
      ipcRenderer.invoke('llm:summary', { date, generate }) as Promise<{
        summary: {
          id: string;
          summaryDate: string;
          summaryText: string;
          modelUsed: string | null;
          eventCount: number | null;
          generatedAt: string;
          telegramSent: boolean;
        } | null;
        fromCache: boolean;
      }>,
  },

  // Analytics
  analytics: {
    heatmap: (cameraId: string, from: string, to: string) =>
      ipcRenderer.invoke('analytics:heatmap', { cameraId, from, to }) as Promise<{
        cells: Array<{ row: number; col: number; count: number }>;
      }>,
    activity: (from: string, to: string, cameraId?: string) =>
      ipcRenderer.invoke('analytics:activity', { from, to, cameraId }) as Promise<{
        data: Array<{
          date: string;
          hour: number;
          cameraId: string | null;
          detectionCount: number;
          personCount: number;
          knownCount: number;
          unknownCount: number;
        }>;
      }>,
    presence: (from: string, to: string, personId?: string) =>
      ipcRenderer.invoke('analytics:presence', { from, to, personId }) as Promise<{
        segments: Array<{
          personId: string;
          personName: string;
          state: string;
          startTime: string;
          endTime: string | null;
        }>;
      }>,
    zoneTraffic: (from: string, to: string, zoneId?: string) =>
      ipcRenderer.invoke('analytics:zoneTraffic', { from, to, zoneId }) as Promise<{
        data: Array<{
          zoneId: string;
          zoneName: string;
          enterCount: number;
          exitCount: number;
          loiterCount: number;
        }>;
      }>,
  },

  // PTZ control
  ptz: {
    command: (cameraId: string, action: string, params: Record<string, unknown>) =>
      ipcRenderer.invoke('ptz:command', { cameraId, action, params }),
    presets: (cameraId: string) => ipcRenderer.invoke('ptz:presets', { cameraId }),
    autotrackStart: (cameraId: string, trackId: number) =>
      ipcRenderer.invoke('ptz:autotrack:start', { cameraId, trackId }) as Promise<{ success: boolean }>,
    autotrackStop: (cameraId: string) =>
      ipcRenderer.invoke('ptz:autotrack:stop', { cameraId }) as Promise<{ success: boolean }>,
    patrolStart: (cameraId: string, dwellTimeMs?: number) =>
      ipcRenderer.invoke('ptz:patrol:start', { cameraId, dwellTimeMs }) as Promise<{ success: boolean }>,
    patrolStop: (cameraId: string) =>
      ipcRenderer.invoke('ptz:patrol:stop', { cameraId }) as Promise<{ success: boolean }>,
    zoomTo: (cameraId: string, bbox: { x1: number; y1: number; x2: number; y2: number }) =>
      ipcRenderer.invoke('ptz:zoom:to', { cameraId, bbox }) as Promise<{ success: boolean }>,
    status: (cameraId: string) =>
      ipcRenderer.invoke('ptz:status', { cameraId }) as Promise<{
        capabilities: { canPan: boolean; canTilt: boolean; canZoom: boolean; hasPresets: boolean; ptzType: string };
        isAutoTracking: boolean;
        autoTrackInfo: { trackId: number; isActive: boolean } | null;
        isPatrolling: boolean;
      }>,
  },

  // AI detection results
  ai: {
    onDetection: (callback: (data: { cameraId: string; faces: unknown[]; timestamp: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { cameraId: string; faces: unknown[]; timestamp: number }) => callback(data);
      ipcRenderer.on('ai:detection', listener);
      return () => ipcRenderer.removeListener('ai:detection', listener);
    },
    onObjects: (callback: (data: { cameraId: string; objects: unknown[]; timestamp: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { cameraId: string; objects: unknown[]; timestamp: number }) => callback(data);
      ipcRenderer.on('ai:objects', listener);
      return () => ipcRenderer.removeListener('ai:objects', listener);
    },
    pipelineStatus: () => ipcRenderer.invoke('ai:pipeline-status') as Promise<{ isRunning: boolean }>,
  },

  // Events
  events: {
    list: (filters: Record<string, unknown>) => ipcRenderer.invoke('event:list', { filters }),
    onNew: (callback: (data: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('event:new', listener);
      return () => ipcRenderer.removeListener('event:new', listener);
    },
  },

  // Person management
  person: {
    enroll: (data: { personName: string; label?: string; imageData: string[]; source: string }) =>
      ipcRenderer.invoke('person:enroll', data),
    list: () => ipcRenderer.invoke('person:list'),
    delete: (personId: string) => ipcRenderer.invoke('person:delete', { personId }),
    toggle: (personId: string, enabled: boolean) =>
      ipcRenderer.invoke('person:toggle', { personId, enabled }),
    negativeAdd: (personId: string, cropBase64: string, sourceEventId?: string) =>
      ipcRenderer.invoke('person:negative-add', { personId, cropBase64, sourceEventId }),
    negativeList: (personId: string) =>
      ipcRenderer.invoke('person:negative-list', { personId }),
    negativeDelete: (negativeId: string) =>
      ipcRenderer.invoke('person:negative-delete', { negativeId }),
  },

  // Camera management
  camera: {
    list: () => ipcRenderer.invoke('camera:list'),
    update: (cameraId: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('camera:update', { cameraId, data }),
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', { key }),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', { key, value }),
  },

  // Telegram
  telegram: {
    test: (token: string, chatId: string) => ipcRenderer.invoke('telegram:test', { token, chatId }),
  },

  // Zone management
  zone: {
    save: (data: {
      cameraId: string;
      name: string;
      zoneType: string;
      geometry: unknown;
      color?: string;
      alertEnabled?: boolean;
      loiterThresholdSec?: number;
      loiterCooldownSec?: number;
      loiterMovementRadius?: number;
      id?: string;
    }) => ipcRenderer.invoke('zone:save', data),
    list: (cameraId: string) => ipcRenderer.invoke('zone:list', { cameraId }),
    get: (zoneId: string) => ipcRenderer.invoke('zone:get', { zoneId }),
    update: (zoneId: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('zone:update', { zoneId, data }),
    delete: (zoneId: string) => ipcRenderer.invoke('zone:delete', { zoneId }),
    onEvent: (callback: (data: { cameraId: string; events: unknown[]; timestamp: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { cameraId: string; events: unknown[]; timestamp: number }) => callback(data);
      ipcRenderer.on('zone:event', listener);
      return () => ipcRenderer.removeListener('zone:event', listener);
    },
  },

  // Line crossing
  line: {
    save: (cameraId: string, lineCoords: { x1: number; y1: number; x2: number; y2: number }, direction: string) =>
      ipcRenderer.invoke('line:save', { cameraId, lineCoords, direction }),
    get: (cameraId: string) => ipcRenderer.invoke('line:get', { cameraId }),
  },

  // System status
  system: {
    onStatus: (callback: (data: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('system:status', listener);
      return () => ipcRenderer.removeListener('system:status', listener);
    },
    getStatus: () => ipcRenderer.invoke('system:status'),
  },

  // Privacy
  privacy: {
    purgeAllFaces: () => ipcRenderer.invoke('privacy:purge-all-faces'),
    purgeOldEvents: () => ipcRenderer.invoke('privacy:purge-old-events'),
  },

  // Journey tracking
  journey: {
    list: (personId?: string) =>
      ipcRenderer.invoke('journey:list', personId ? { personId } : undefined) as Promise<{
        journeys: Array<{
          id: string;
          personId: string | null;
          personName: string | null;
          globalPersonId: string | null;
          status: string;
          startedAt: string;
          completedAt: string | null;
          totalDurationSec: number | null;
          path: Array<{ cameraId: string; timestamp: number; action: string }>;
          createdAt: string;
        }>;
      }>,
    active: () =>
      ipcRenderer.invoke('journey:active') as Promise<{
        journeys: Array<{
          id: string;
          personId: string;
          personName: string;
          globalPersonId: string | null;
          status: string;
          steps: Array<{ cameraId: string; timestamp: number; action: string }>;
          lastCameraId: string;
          summary: string;
          startedAt: string;
          durationSec: number;
        }>;
      }>,
    onUpdate: (callback: (data: {
      journeyId: string;
      personId: string;
      personName: string;
      status: string;
      steps: Array<{ cameraId: string; timestamp: number; action: string }>;
      totalDurationSec: number | null;
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as Parameters<typeof callback>[0]);
      ipcRenderer.on('journey:update', listener);
      return () => ipcRenderer.removeListener('journey:update', listener);
    },
  },

  // Floor plan
  floorplan: {
    get: () => ipcRenderer.invoke('floorplan:get') as Promise<{
      imagePath: string | null;
      imageWidth: number | null;
      imageHeight: number | null;
      scaleMetersPerPixel: number | null;
      cameras: Array<{
        id: string;
        label: string;
        floorX: number | null;
        floorY: number | null;
        fovDeg: number | null;
        rotationDeg: number | null;
      }>;
    } | null>,
    save: (data: Record<string, unknown>) =>
      ipcRenderer.invoke('floorplan:save', data) as Promise<{ success: boolean }>,
    positions: () =>
      ipcRenderer.invoke('floorplan:positions') as Promise<{
        persons: Array<{
          globalPersonId: string;
          personId: string | null;
          cameraId: string;
          timestamp: number;
        }>;
      }>,
  },

  // Topology management
  topology: {
    get: () =>
      ipcRenderer.invoke('topology:get') as Promise<Array<{
        id: string;
        fromCameraId: string;
        toCameraId: string;
        transitMinSec: number;
        transitMaxSec: number;
        direction: string;
        enabled: boolean;
      }>>,
    save: (edges: Array<Record<string, unknown>>) =>
      ipcRenderer.invoke('topology:save', edges) as Promise<{ success: boolean; count: number }>,
    onAnomaly: (callback: (data: {
      type: string;
      globalPersonId: string;
      personId: string | null;
      fromCameraId: string;
      toCameraId: string | null;
      elapsedSec: number;
      expectedMinSec: number | null;
      expectedMaxSec: number | null;
      skippedCameraId: string | null;
      description: string;
      timestamp: number;
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as Parameters<typeof callback>[0]);
      ipcRenderer.on('topology:anomaly', listener);
      return () => ipcRenderer.removeListener('topology:anomaly', listener);
    },
  },

  // Presence tracking
  presence: {
    list: () =>
      ipcRenderer.invoke('presence:list') as Promise<{
        presences: Array<{
          personId: string;
          personName: string;
          state: string;
          lastCameraId: string | null;
          lastSeenAt: string | null;
          stateChangedAt: string | null;
        }>;
      }>,
    history: (personId: string, limit?: number) =>
      ipcRenderer.invoke('presence:history', { personId, limit }) as Promise<{
        history: Array<{
          id: string;
          personId: string;
          state: string;
          previousState: string | null;
          triggerCameraId: string | null;
          triggerReason: string | null;
          createdAt: string;
        }>;
      }>,
    onUpdate: (callback: (data: {
      personId: string;
      personName: string;
      state: string;
      previousState: string;
      triggerCameraId: string | null;
      triggerReason: string;
      timestamp: number;
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as Parameters<typeof callback>[0]);
      ipcRenderer.on('presence:update', listener);
      return () => ipcRenderer.removeListener('presence:update', listener);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
