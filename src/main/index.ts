import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { registerStreamHandlers } from './ipc/streamHandlers';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerCameraHandlers } from './ipc/cameraHandlers';
import { registerPtzHandlers } from './ipc/ptzHandlers';
import { registerAiHandlers } from './ipc/aiHandlers';
import { registerPersonHandlers } from './ipc/personHandlers';
import { registerLineHandlers } from './ipc/lineHandlers';
import { registerEventHandlers } from './ipc/eventHandlers';
import { registerTelegramHandlers } from './ipc/telegramHandlers';
import { registerZoneHandlers } from './ipc/zoneHandlers';
import { registerJourneyHandlers } from './ipc/journeyHandlers';
import { registerRecordingHandlers } from './ipc/recordingHandlers';
import { registerAnalyticsHandlers } from './ipc/analyticsHandlers';
import { registerLlmHandlers } from './ipc/llmHandlers';
import { registerTopologyHandlers } from './ipc/topologyHandlers';
import { registerFloorplanHandlers } from './ipc/floorplanHandlers';
import { streamManager } from './services/StreamManager';
import { initDatabase, seedDefaultSettings, seedDefaultCameras, runAutoPurge, closeDatabase, getDb } from './services/DatabaseService';
import { initCrypto } from './services/CryptoService';
import { startSidecar, stopSidecar, getSidecarStatus, startExpiryCleanup, stopExpiryCleanup, onStatusChange } from './services/ProcessManager';
import { syncEmbeddingsToSidecar } from './services/AIBridgeService';
import { startGo2Rtc, stopGo2Rtc } from './services/Go2RtcService';
import { detectionPipeline } from './services/DetectionPipeline';
import { telegramService } from './services/TelegramService';
import { journeyService } from './services/JourneyService';
import { presenceService } from './services/PresenceService';
import { topologyService } from './services/TopologyService';
import { startSoundService, stopSoundService, startAudioCapture } from './services/SoundService';
import { startRecording, stopAllRecordings, startRetentionCleanup, stopRetentionCleanup } from './services/RecordingService';
import { startAnalyticsRollup, stopAnalyticsRollup } from './services/AnalyticsService';
import { startSummaryScheduler, stopSummaryScheduler } from './services/OllamaService';

const isDev = !app.isPackaged;
const STATUS_PUSH_INTERVAL_MS = 10_000;
let statusPushInterval: ReturnType<typeof setInterval> | null = null;
let tray: Tray | null = null;

function getIconPath(): string {
  const svgPath = isDev
    ? path.join(process.cwd(), 'src', 'renderer', 'assets', 'icon.svg')
    : path.join(process.resourcesPath, 'icon.svg');

  if (fs.existsSync(svgPath)) {
    return svgPath;
  }

  return '';
}

function createTray(mainWindow: BrowserWindow): void {
  try {
    const iconPath = getIconPath();
    let trayIcon: Electron.NativeImage;

    if (iconPath && fs.existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        trayIcon = nativeImage.createEmpty();
      }
    } else {
      trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('Tapo CCTV Desktop');

    const updateTrayMenu = () => {
      const statuses = streamManager.getStatuses();
      const connectedCount = statuses.filter((s) => s.status === 'connected').length;
      const totalCount = statuses.length;
      const aiStatus = getSidecarStatus();

      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Tapo CCTV Desktop',
          enabled: false,
        },
        { type: 'separator' },
        {
          label: mainWindow.isVisible() ? 'Hide Window' : 'Show Window',
          click: () => {
            if (mainWindow.isVisible()) {
              mainWindow.hide();
            } else {
              mainWindow.show();
              mainWindow.focus();
            }
          },
        },
        { type: 'separator' },
        {
          label: `Cameras: ${connectedCount}/${totalCount} connected`,
          enabled: false,
        },
        {
          label: `AI Service: ${aiStatus}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            app.quit();
          },
        },
      ]);

      tray?.setContextMenu(contextMenu);
    };

    updateTrayMenu();

    // Update tray menu every 10 seconds alongside status push
    setInterval(updateTrayMenu, STATUS_PUSH_INTERVAL_MS);

    tray.on('double-click', () => {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    console.log('[Main] System tray created.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Main] Failed to create system tray: ${message}`);
  }
}

function emitSystemStatus(): void {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    return;
  }

  try {
    const cameraStatuses = streamManager.getStatuses().map((s) => ({
      cameraId: s.cameraId,
      status: s.status === 'connected' ? 'connected' as const
        : s.status === 'reconnecting' || s.status === 'starting' ? 'reconnecting' as const
        : 'offline' as const,
      fps: s.fps,
    }));

    const aiServiceStatus = getSidecarStatus();
    const memUsage = process.memoryUsage();

    const payload = {
      cameras: cameraStatuses,
      aiService: {
        status: aiServiceStatus,
        uptime: process.uptime(),
      },
      gpu: {
        available: false,
        name: '',
        vramMb: 0,
      },
      memoryUsage: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
    };

    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('system:status', payload);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Main] Failed to emit system status: ${message}`);
  }
}

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '..', 'preload', 'index.js');

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'Tapo CCTV Desktop',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      console.log('[Main] Vite dev server not running, loading built renderer files.');
      mainWindow.loadFile(rendererPath);
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(rendererPath);
  }

  mainWindow.on('closed', () => {
    // Window reference cleanup handled by GC
  });

  return mainWindow;
}

app.whenReady().then(() => {
  initDatabase();
  seedDefaultSettings();
  seedDefaultCameras();
  initCrypto();

  registerStreamHandlers();
  registerSettingsHandlers();
  registerCameraHandlers();
  registerPtzHandlers();
  registerAiHandlers();
  registerPersonHandlers();
  registerLineHandlers();
  registerEventHandlers();
  registerTelegramHandlers();
  registerZoneHandlers();
  registerJourneyHandlers();
  registerRecordingHandlers();
  registerAnalyticsHandlers();
  registerLlmHandlers();
  registerTopologyHandlers();
  registerFloorplanHandlers();

  telegramService.initialize();

  // Start go2rtc RTSP proxy first — cameras route through it
  startGo2Rtc().then((healthy) => {
    if (healthy) {
      console.log('[Main] go2rtc is healthy. Starting camera streams and AI pipeline.');
    } else {
      console.warn('[Main] go2rtc not yet healthy, starting pipeline anyway (will retry in background).');
    }

    // Auto-start all enabled camera streams from main process
    // Streams persist regardless of renderer navigation (Dashboard/Fullscreen/Settings)
    // Stagger starts: cameras sharing the same IP (e.g. C246D dual-lens) get a delay
    // to avoid exceeding concurrent RTSP session limits during handshake
    try {
      const rows = getDb()
        .prepare('SELECT id, ip_address FROM cameras WHERE enabled = 1 ORDER BY id')
        .all() as Array<{ id: string; ip_address: string }>;

      const seenIps = new Set<string>();
      let delay = 0;
      const STAGGER_MS = 3000; // 3s delay between cameras sharing same IP

      for (const row of rows) {
        if (seenIps.has(row.ip_address)) {
          delay += STAGGER_MS;
          const camId = row.id;
          const d = delay;
          setTimeout(() => {
            console.log(`[Main] Staggered start for ${camId} (shared IP, +${d}ms)`);
            streamManager.startStream(camId);
          }, d);
        } else {
          streamManager.startStream(row.id);
        }
        seenIps.add(row.ip_address);
      }
      console.log(`[Main] Auto-started streams for ${rows.length} enabled cameras.`);
    } catch (err) {
      console.error('[Main] Failed to auto-start camera streams:', err);
    }

    // Sync face embeddings to sidecar when it becomes healthy
    let embeddingsSynced = false;
    onStatusChange((status) => {
      if (status === 'healthy' && !embeddingsSynced) {
        embeddingsSynced = true;
        syncEmbeddingsToSidecar().catch((err) => {
          console.error('[Main] Initial embeddings sync failed:', err);
          embeddingsSynced = false; // Allow retry on next healthy transition
        });
      }
      if (status === 'stopped' || status === 'unhealthy') {
        embeddingsSynced = false; // Re-sync on next healthy transition
      }
    });

    startSidecar().then(() => {
      // Fallback: if sidecar was already healthy (external), the onStatusChange
      // callback may have fired before startSidecar resolved. Do a delayed sync
      // to ensure embeddings are always pushed.
      setTimeout(() => {
        if (!embeddingsSynced) {
          console.log('[Main] Fallback embeddings sync (delayed)');
          embeddingsSynced = true;
          syncEmbeddingsToSidecar().catch((err) => {
            console.error('[Main] Fallback embeddings sync failed:', err);
            embeddingsSynced = false;
          });
        }
      }, 5_000);
    }).catch((err) => {
      console.error('[Main] Failed to start AI sidecar:', err);
    });

    detectionPipeline.start();
    journeyService.start();
    presenceService.start();
    topologyService.startAnomalyDetection();
    startExpiryCleanup();

    // R2-C4: Start sound detection service (audio capture per camera + classification)
    startSoundService();
    try {
      const enabledCams = getDb()
        .prepare('SELECT id FROM cameras WHERE enabled = 1 ORDER BY id')
        .all() as Array<{ id: string }>;
      for (const cam of enabledCams) {
        startAudioCapture(cam.id);
      }
    } catch (soundErr) {
      console.warn('[Main] Sound audio capture auto-start failed:', soundErr);
    }

    // R2-C5: Start recording for cameras with recording enabled
    try {
      const camRows = getDb()
        .prepare("SELECT id, recording_mode FROM cameras WHERE enabled = 1 AND recording_mode != 'off'")
        .all() as Array<{ id: string; recording_mode: string }>;
      for (const cam of camRows) {
        startRecording(cam.id, cam.recording_mode as 'continuous' | 'event_triggered');
      }
      startRetentionCleanup();
      console.log(`[Main] Started recording for ${camRows.length} cameras.`);
    } catch (recErr) {
      console.warn('[Main] Recording auto-start skipped (recording_mode column may not exist yet):', recErr);
    }

    // R2-C6: Start analytics hourly rollup
    startAnalyticsRollup();

    // R2-C7: Start Ollama daily summary scheduler
    startSummaryScheduler();
  });

  // Auto-purge: run on startup and every 24 hours
  const AUTO_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  runAutoPurge();
  setInterval(() => {
    runAutoPurge();
  }, AUTO_PURGE_INTERVAL_MS);

  const mainWindow = createMainWindow();

  // System tray with context menu
  createTray(mainWindow);

  // Start periodic system status push to renderer (every 10s)
  statusPushInterval = setInterval(emitSystemStatus, STATUS_PUSH_INTERVAL_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (statusPushInterval) {
    clearInterval(statusPushInterval);
    statusPushInterval = null;
  }
  detectionPipeline.stop();
  topologyService.stopAnomalyDetection();
  stopExpiryCleanup();
  stopSoundService();
  stopAllRecordings();
  stopRetentionCleanup();
  stopAnalyticsRollup();
  stopSummaryScheduler();
  streamManager.stopAll();
  telegramService.shutdown();
  Promise.all([
    stopSidecar().catch((err) => {
      console.error('[Main] Error stopping AI sidecar:', err);
    }),
    stopGo2Rtc().catch((err) => {
      console.error('[Main] Error stopping go2rtc:', err);
    }),
  ]).finally(() => {
    closeDatabase();
    app.quit();
  });
});
