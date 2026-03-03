/**
 * TelegramService — Sends alerts via node-telegram-bot-api.
 *
 * Responsibilities:
 * - Format messages per PRD Section 6.1 (emoji-prefixed structured messages)
 * - Attach snapshot images to alerts
 * - Apply alert priority (Unknown = ALERT, Known = INFO/silent)
 * - Throttle alerts: per-camera cooldown (30s), per-person cooldown (60s)
 * - Bundle window: multiple detections on same camera within 5s → single alert
 */

import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import { getSetting } from './DatabaseService';

// --- Types ---

export interface TelegramAlertEvent {
  id: string;
  cameraId: string;
  cameraLabel: string;
  personId: string | null;
  personName: string;
  isKnown: boolean;
  direction: 'ENTER' | 'EXIT' | 'INSIDE' | null;
  confidence: number;
  snapshotPath: string | null;
  createdAt: string;
  journeyContext?: string | null;
  presenceState?: string | null;
  isGroupDedup?: boolean;
}

export interface TelegramPresenceEvent {
  personId: string;
  personName: string;
  state: string;
  previousState: string;
  triggerCameraId: string | null;
  triggerCameraLabel?: string | null;
  triggerReason: string;
  timestamp: number;
}

export interface TelegramJourneyEvent {
  journeyId: string;
  personId: string;
  personName: string;
  status: 'completed' | 'expired';
  pathSummary: string;
  totalDurationSec: number | null;
}

interface BundleEntry {
  events: TelegramAlertEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

// --- Constants ---

const CAMERA_COOLDOWN_MS = 30_000;
const PERSON_COOLDOWN_MS = 60_000;
const BUNDLE_WINDOW_MS = 5_000;
const RETRY_DELAY_MS = 30_000;

// --- TelegramService Class ---

class TelegramService {
  private bot: TelegramBot | null = null;
  private chatId: string = '';
  private isEnabled: boolean = false;

  // Cooldown tracking
  private lastCameraAlert: Map<string, number> = new Map();
  private lastPersonAlert: Map<string, number> = new Map();

  // Bundle window tracking: Map<cameraId, BundleEntry>
  private bundleWindows: Map<string, BundleEntry> = new Map();

  // Callback for send result tracking (event ID, success)
  private sendResultCallback: ((eventId: string, success: boolean) => void) | null = null;

  /**
   * Initialize the bot with current settings from the database.
   */
  initialize(): void {
    try {
      const token = getSetting('telegram_bot_token') ?? '';
      const chatId = getSetting('telegram_chat_id') ?? '';
      const enabled = getSetting('telegram_enabled') === 'true';

      this.chatId = chatId;
      this.isEnabled = enabled;

      if (this.bot) {
        this.bot.stopPolling();
        this.bot = null;
      }

      if (!token || !chatId || !enabled) {
        console.log('[TelegramService] Not configured or disabled. Skipping initialization.');
        return;
      }

      this.bot = new TelegramBot(token, { polling: false });
      console.log('[TelegramService] Initialized successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TelegramService] Initialization failed: ${message}`);
      this.bot = null;
    }
  }

  /**
   * Check if the service is properly configured and enabled.
   */
  isConfigured(): boolean {
    return this.isEnabled && this.bot !== null && this.chatId.length > 0;
  }

  /**
   * Send a test notification to verify configuration.
   */
  async sendTestMessage(token: string, chatId: string): Promise<{ success: boolean; message: string }> {
    if (!token || !chatId) {
      return { success: false, message: 'Bot token and chat ID are required.' };
    }

    let testBot: TelegramBot | null = null;
    try {
      testBot = new TelegramBot(token, { polling: false });
      const testMessage =
        '✅ Tapo CCTV Desktop — Test Notification\n\n' +
        'Your Telegram integration is working correctly.\n' +
        `🕐 Time: ${new Date().toLocaleString()}`;

      await testBot.sendMessage(chatId, testMessage, { parse_mode: 'HTML' });
      return { success: true, message: 'Test notification sent successfully.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TelegramService] Test message failed: ${message}`);
      return { success: false, message: `Failed to send test notification: ${message}` };
    }
  }

  /**
   * Register a callback to be notified of send results per event.
   */
  onSendResult(callback: (eventId: string, success: boolean) => void): void {
    this.sendResultCallback = callback;
  }

  /**
   * Send an alert for a detection event.
   * Applies throttling rules before sending.
   * Returns true if the alert was sent (or queued for bundling).
   */
  async sendAlert(event: TelegramAlertEvent): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    // Known persons: only send if they have journey context or presence state
    if (event.isKnown && !event.journeyContext && !event.presenceState) {
      return false;
    }

    // Check per-camera cooldown
    if (this.isCameraCooldownActive(event.cameraId)) {
      console.log(`[TelegramService] Camera cooldown active for ${event.cameraId}. Skipping.`);
      return false;
    }

    // Check per-person cooldown
    const personKey = event.personId ?? '__unknown__';
    if (this.isPersonCooldownActive(personKey)) {
      console.log(`[TelegramService] Person cooldown active for ${personKey}. Skipping.`);
      return false;
    }

    // Add to bundle window
    this.addToBundleWindow(event);
    return true;
  }

  // --- Throttling ---

  private isCameraCooldownActive(cameraId: string): boolean {
    const lastAlert = this.lastCameraAlert.get(cameraId);
    if (!lastAlert) return false;
    return Date.now() - lastAlert < CAMERA_COOLDOWN_MS;
  }

  private isPersonCooldownActive(personKey: string): boolean {
    const lastAlert = this.lastPersonAlert.get(personKey);
    if (!lastAlert) return false;
    return Date.now() - lastAlert < PERSON_COOLDOWN_MS;
  }

  private recordCooldowns(event: TelegramAlertEvent): void {
    const now = Date.now();
    this.lastCameraAlert.set(event.cameraId, now);
    const personKey = event.personId ?? '__unknown__';
    this.lastPersonAlert.set(personKey, now);
  }

  // --- Bundle Window ---

  private addToBundleWindow(event: TelegramAlertEvent): void {
    const existing = this.bundleWindows.get(event.cameraId);

    if (existing) {
      existing.events.push(event);
      return;
    }

    const bundle: BundleEntry = {
      events: [event],
      timer: setTimeout(() => {
        this.flushBundle(event.cameraId);
      }, BUNDLE_WINDOW_MS),
    };

    this.bundleWindows.set(event.cameraId, bundle);
  }

  private async flushBundle(cameraId: string): Promise<void> {
    const bundle = this.bundleWindows.get(cameraId);
    this.bundleWindows.delete(cameraId);

    if (!bundle || bundle.events.length === 0) {
      return;
    }

    if (bundle.timer) {
      clearTimeout(bundle.timer);
    }

    const primaryEvent = bundle.events[0]!;
    const count = bundle.events.length;

    try {
      if (count === 1) {
        await this.sendSingleAlert(primaryEvent);
      } else {
        await this.sendBundledAlert(primaryEvent, count);
      }

      // Record cooldowns for all events in the bundle
      for (const event of bundle.events) {
        this.recordCooldowns(event);
        if (this.sendResultCallback) {
          this.sendResultCallback(event.id, true);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TelegramService] Failed to flush bundle for ${cameraId}: ${message}`);

      // Mark all events in bundle as failed
      for (const event of bundle.events) {
        if (this.sendResultCallback) {
          this.sendResultCallback(event.id, false);
        }
      }

      // Schedule retry once after 30 seconds
      this.scheduleRetry(bundle.events, count);
    }
  }

  private scheduleRetry(events: TelegramAlertEvent[], count: number): void {
    setTimeout(async () => {
      if (!this.isConfigured()) {
        return;
      }

      const primaryEvent = events[0];
      if (!primaryEvent) {
        return;
      }

      console.log(`[TelegramService] Retrying send for ${events.length} event(s)...`);

      try {
        if (count === 1) {
          await this.sendSingleAlert(primaryEvent);
        } else {
          await this.sendBundledAlert(primaryEvent, count);
        }

        for (const event of events) {
          this.recordCooldowns(event);
          if (this.sendResultCallback) {
            this.sendResultCallback(event.id, true);
          }
        }

        console.log(`[TelegramService] Retry succeeded for ${events.length} event(s).`);
      } catch (retryError) {
        const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
        console.error(`[TelegramService] Retry also failed: ${retryMsg}. Giving up.`);
      }
    }, RETRY_DELAY_MS);
  }

  // --- Message Formatting (PRD Section 6.1) ---

  private formatAlertMessage(event: TelegramAlertEvent): string {
    const prefix = event.isKnown ? 'ℹ️ [INFO] Known Person Detected' : '🚨 [ALERT] Person Detected';
    const timeStr = event.createdAt
      ? new Date(event.createdAt).toLocaleString()
      : new Date().toLocaleString();
    const directionStr = event.direction ?? 'N/A';
    const confidenceStr = event.confidence.toFixed(2);

    let message =
      `${prefix}\n\n` +
      `📷 Camera: ${event.cameraId} (${event.cameraLabel})\n` +
      `👤 Person: ${event.personName}\n` +
      `📍 Direction: ${directionStr}\n` +
      `🕐 Time: ${timeStr}\n` +
      `📊 Confidence: ${confidenceStr}`;

    if (event.journeyContext) {
      message += `\n🗺️ Journey: ${event.journeyContext}`;
    }

    if (event.presenceState) {
      message += `\n🏠 Presence: ${this.formatPresenceState(event.presenceState)}`;
    }

    if (event.isGroupDedup) {
      message += `\n📸 Source: Best quality from camera group`;
    }

    return message;
  }

  private formatBundledMessage(event: TelegramAlertEvent, count: number): string {
    const timeStr = event.createdAt
      ? new Date(event.createdAt).toLocaleString()
      : new Date().toLocaleString();

    let message =
      `🚨 [ALERT] ${count} Persons Detected\n\n` +
      `📷 Camera: ${event.cameraId} (${event.cameraLabel})\n` +
      `👤 Persons: ${count} detected within 5 seconds\n` +
      `📍 Direction: ${event.direction ?? 'N/A'}\n` +
      `🕐 Time: ${timeStr}`;

    if (event.journeyContext) {
      message += `\n🗺️ Journey: ${event.journeyContext}`;
    }

    if (event.isGroupDedup) {
      message += `\n📸 Source: Best quality from camera group`;
    }

    return message;
  }

  private formatPresenceState(state: string): string {
    const labels: Record<string, string> = {
      HOME:      'Home 🏠',
      ARRIVING:  'Arriving 🚶',
      DEPARTING: 'Departing 🚶',
      AT_GATE:   'At Gate 🚪',
      AWAY:      'Away 🌙',
      UNKNOWN:   'Unknown',
    };
    return labels[state] ?? state;
  }

  /**
   * Send a presence state change notification.
   * Only sent for significant transitions (e.g., HOME, AWAY) if enabled.
   */
  async sendPresenceAlert(event: TelegramPresenceEvent): Promise<boolean> {
    if (!this.isConfigured()) return false;

    // Only notify for notable transitions
    const notableTransitions = ['HOME', 'AWAY', 'AT_GATE'];
    if (!notableTransitions.includes(event.state)) return false;

    // Check per-person cooldown for presence alerts
    const cooldownKey = `presence:${event.personId}`;
    const lastAlert = this.lastPersonAlert.get(cooldownKey);
    if (lastAlert && Date.now() - lastAlert < PERSON_COOLDOWN_MS) return false;

    this.lastPersonAlert.set(cooldownKey, Date.now());

    const stateLabel = this.formatPresenceState(event.state);
    const prevLabel = this.formatPresenceState(event.previousState);
    const timeStr = new Date(event.timestamp).toLocaleString();
    const cameraStr = event.triggerCameraLabel
      ? `${event.triggerCameraId} (${event.triggerCameraLabel})`
      : (event.triggerCameraId ?? 'unknown');

    const message =
      `🏠 [PRESENCE] ${event.personName} is now ${stateLabel}\n\n` +
      `👤 Person: ${event.personName}\n` +
      `📍 Previous state: ${prevLabel}\n` +
      `📷 Last seen: ${cameraStr}\n` +
      `🕐 Time: ${timeStr}\n` +
      `💬 Reason: ${event.triggerReason}`;

    try {
      await this.bot!.sendMessage(this.chatId, message);
      console.log(`[TelegramService] Presence alert sent: ${event.personName} → ${event.state}`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[TelegramService] Presence alert failed: ${msg}`);
      return false;
    }
  }

  /**
   * Send a journey completion notification.
   * Only sent for multi-step journeys (≥2 cameras).
   */
  async sendJourneyAlert(event: TelegramJourneyEvent): Promise<boolean> {
    if (!this.isConfigured()) return false;
    if (!event.pathSummary) return false;
    if (event.status === 'expired') return false;

    const durationStr = event.totalDurationSec !== null
      ? `${Math.round(event.totalDurationSec)}s`
      : 'unknown duration';
    const timeStr = new Date().toLocaleString();

    const message =
      `🗺️ [JOURNEY] ${event.personName} completed a journey\n\n` +
      `👤 Person: ${event.personName}\n` +
      `🚶 Path: ${event.pathSummary}\n` +
      `⏱️ Duration: ${durationStr}\n` +
      `🕐 Time: ${timeStr}`;

    try {
      await this.bot!.sendMessage(this.chatId, message);
      console.log(`[TelegramService] Journey alert sent: ${event.personName} — ${event.pathSummary}`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[TelegramService] Journey alert failed: ${msg}`);
      return false;
    }
  }

  // --- Sending ---

  private async sendSingleAlert(event: TelegramAlertEvent): Promise<void> {
    if (!this.bot) return;

    const caption = this.formatAlertMessage(event);

    // Try to send with snapshot if available
    if (event.snapshotPath && fs.existsSync(event.snapshotPath)) {
      try {
        await this.bot.sendPhoto(this.chatId, fs.createReadStream(event.snapshotPath), {
          caption,
        });
        console.log(`[TelegramService] Alert sent with snapshot for event ${event.id}`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[TelegramService] Failed to send photo, falling back to text: ${message}`);
      }
    }

    // Fallback: send text-only message
    try {
      await this.bot.sendMessage(this.chatId, caption);
      console.log(`[TelegramService] Alert sent (text-only) for event ${event.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TelegramService] Failed to send alert for event ${event.id}: ${message}`);
      throw error;
    }
  }

  private async sendBundledAlert(primaryEvent: TelegramAlertEvent, count: number): Promise<void> {
    if (!this.bot) return;

    const caption = this.formatBundledMessage(primaryEvent, count);

    // Send with snapshot from first event if available
    if (primaryEvent.snapshotPath && fs.existsSync(primaryEvent.snapshotPath)) {
      try {
        await this.bot.sendPhoto(this.chatId, fs.createReadStream(primaryEvent.snapshotPath), {
          caption,
        });
        console.log(`[TelegramService] Bundled alert (${count} events) sent with snapshot`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[TelegramService] Failed to send bundled photo, falling back to text: ${message}`);
      }
    }

    // Fallback: text-only
    try {
      await this.bot.sendMessage(this.chatId, caption);
      console.log(`[TelegramService] Bundled alert (${count} events) sent (text-only)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TelegramService] Failed to send bundled alert: ${message}`);
      throw error;
    }
  }

  /**
   * Re-initialize the bot (called when settings are changed).
   */
  reinitialize(): void {
    console.log('[TelegramService] Reinitializing...');
    this.initialize();
  }

  /**
   * Send a plain text message via Telegram.
   * Used by OllamaService for daily summary delivery.
   */
  async sendTextMessage(text: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      await this.bot!.sendMessage(this.chatId, text);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[TelegramService] Failed to send text message: ${msg}`);
      return false;
    }
  }

  /**
   * Cleanup on shutdown.
   */
  shutdown(): void {
    // Flush any pending bundles
    for (const [cameraId] of this.bundleWindows) {
      this.flushBundle(cameraId).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[TelegramService] Shutdown flush failed for ${cameraId}: ${message}`);
      });
    }

    if (this.bot) {
      this.bot = null;
    }

    this.lastCameraAlert.clear();
    this.lastPersonAlert.clear();
    console.log('[TelegramService] Shutdown complete.');
  }
}

// Singleton export
export const telegramService = new TelegramService();
