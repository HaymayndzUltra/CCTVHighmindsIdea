/**
 * OllamaService — manages Ollama LLM integration for daily security summaries.
 *
 * Responsibilities:
 * - Ollama process health checking (assumes Ollama is installed and running externally)
 * - Generate text via Ollama HTTP API (POST http://localhost:11434/api/generate)
 * - Build daily summary prompts from event data
 * - Scheduled daily summary generation at configured time
 * - Store summaries in `daily_summaries` table
 * - Optionally deliver via Telegram
 */

import crypto from 'crypto';
import {
  getSetting,
  getDb,
  createDailySummary,
  getDailySummary,
  updateDailySummaryTelegram,
} from './DatabaseService';
import { telegramService } from './TelegramService';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const GENERATE_TIMEOUT_MS = 120_000; // 2 min for LLM generation
const HEALTH_TIMEOUT_MS = 5_000;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastScheduledHour = -1;

export type OllamaStatus = 'unknown' | 'running' | 'stopped' | 'error';

interface OllamaState {
  status: OllamaStatus;
  modelLoaded: boolean;
  lastError: string | null;
}

const state: OllamaState = {
  status: 'unknown',
  modelLoaded: false,
  lastError: null,
};

function getModelName(): string {
  return getSetting('llm_model_name') || 'llama3.2';
}

function getSummaryTime(): { hour: number; minute: number } {
  const timeStr = getSetting('llm_summary_time') || '23:00';
  const parts = timeStr.split(':');
  return {
    hour: parseInt(parts[0] || '23', 10),
    minute: parseInt(parts[1] || '0', 10),
  };
}

function isTelegramDeliveryEnabled(): boolean {
  return getSetting('llm_telegram_delivery') === 'true';
}

/**
 * Check if Ollama is running and responsive.
 */
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const resp = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      state.status = 'running';
      const data = await resp.json() as { models?: Array<{ name: string }> };
      const modelName = getModelName();
      state.modelLoaded = data.models?.some((m) => m.name.startsWith(modelName)) ?? false;
      state.lastError = null;
      return true;
    }

    state.status = 'error';
    state.lastError = `Ollama responded with status ${resp.status}`;
    return false;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    state.status = 'stopped';
    state.lastError = msg;
    return false;
  }
}

/**
 * Get current Ollama status.
 */
export function getOllamaStatus(): {
  status: OllamaStatus;
  modelLoaded: boolean;
  modelName: string;
  lastError: string | null;
} {
  return {
    status: state.status,
    modelLoaded: state.modelLoaded,
    modelName: getModelName(),
    lastError: state.lastError,
  };
}

/**
 * Generate text from Ollama LLM.
 */
export async function generate(prompt: string): Promise<string> {
  const modelName = getModelName();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

    const resp = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 1024,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Ollama generate failed (${resp.status}): ${errText}`);
    }

    const data = await resp.json() as { response: string };
    return data.response?.trim() ?? '';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    state.lastError = msg;
    throw new Error(`Ollama generation failed: ${msg}`);
  }
}

/**
 * Build a daily summary prompt from event data for a specific date.
 */
export function buildDailySummaryPrompt(date: string): string {
  const db = getDb();
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  // Count events by type
  const eventCounts = db
    .prepare(
      `SELECT event_type, COUNT(*) as count
       FROM events
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY event_type`
    )
    .all(dayStart, dayEnd) as Array<{ event_type: string; count: number }>;

  // Person arrivals/departures
  const personActivity = db
    .prepare(
      `SELECT p.name, e.event_type, e.direction, COUNT(*) as count
       FROM events e
       LEFT JOIN persons p ON p.id = e.person_id
       WHERE e.created_at >= ? AND e.created_at <= ?
         AND e.person_id IS NOT NULL
       GROUP BY p.name, e.event_type, e.direction
       ORDER BY count DESC
       LIMIT 20`
    )
    .all(dayStart, dayEnd) as Array<{ name: string; event_type: string; direction: string | null; count: number }>;

  // Unknown person detections
  const unknownCount = db
    .prepare(
      `SELECT COUNT(*) as count FROM events
       WHERE created_at >= ? AND created_at <= ?
         AND event_type = 'detection' AND is_known = 0`
    )
    .get(dayStart, dayEnd) as { count: number };

  // Zone activity
  const zoneActivity = db
    .prepare(
      `SELECT z.name as zone_name, e.event_type, COUNT(*) as count
       FROM events e
       JOIN zones z ON z.id = e.zone_id
       WHERE e.created_at >= ? AND e.created_at <= ? AND e.zone_id IS NOT NULL
       GROUP BY z.name, e.event_type
       ORDER BY count DESC
       LIMIT 15`
    )
    .all(dayStart, dayEnd) as Array<{ zone_name: string; event_type: string; count: number }>;

  // Sound events
  const soundEvents = db
    .prepare(
      `SELECT sound_event_type, COUNT(*) as count
       FROM events
       WHERE created_at >= ? AND created_at <= ? AND sound_event_type IS NOT NULL
       GROUP BY sound_event_type`
    )
    .all(dayStart, dayEnd) as Array<{ sound_event_type: string; count: number }>;

  // Build structured prompt
  const totalEvents = eventCounts.reduce((s, e) => s + e.count, 0);

  let prompt = `You are a professional security analyst AI assistant. Generate a concise daily security summary report for ${date}.

## Event Data for ${date}

**Total events:** ${totalEvents}

### Event breakdown:
${eventCounts.map((e) => `- ${e.event_type}: ${e.count}`).join('\n') || '- No events recorded'}

### Known person activity:
${personActivity.map((p) => `- ${p.name}: ${p.event_type}${p.direction ? ` (${p.direction})` : ''} × ${p.count}`).join('\n') || '- No known person activity'}

### Unknown persons: ${unknownCount.count} detections

### Zone activity:
${zoneActivity.map((z) => `- ${z.zone_name}: ${z.event_type} × ${z.count}`).join('\n') || '- No zone activity'}

### Sound events:
${soundEvents.map((s) => `- ${s.sound_event_type}: ${s.count}`).join('\n') || '- None detected'}

## Instructions:
Write a concise security summary (3-5 paragraphs) that includes:
1. Overall activity level assessment
2. Notable arrivals/departures of known persons with approximate times
3. Unknown person alerts and any concerning patterns
4. Zone intrusion or loitering incidents
5. Sound events or anomalies (if any)
6. Recommendations for the property owner

Keep the tone professional but friendly. Be specific about patterns and timing. Format as plain text, not markdown.`;

  return prompt;
}

/**
 * Generate a daily summary for a specific date.
 */
export async function generateDailySummary(date: string): Promise<{
  id: string;
  summaryText: string;
  eventCount: number;
}> {
  const prompt = buildDailySummaryPrompt(date);

  // Check if Ollama is available
  const isHealthy = await checkOllamaHealth();
  if (!isHealthy) {
    throw new Error(`Ollama is not available (status: ${state.status}). Ensure Ollama is running.`);
  }

  console.log(`[OllamaService] Generating daily summary for ${date}...`);
  const summaryText = await generate(prompt);

  const db = getDb();
  const eventCount = (db
    .prepare(
      `SELECT COUNT(*) as count FROM events
       WHERE created_at >= ? AND created_at <= ?`
    )
    .get(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`) as { count: number }).count;

  const summaryId = crypto.randomUUID();
  createDailySummary({
    id: summaryId,
    summaryDate: date,
    summaryText,
    modelUsed: getModelName(),
    eventCount,
    generatedAt: new Date().toISOString(),
  });

  console.log(`[OllamaService] Summary generated and stored: ${summaryId} (${summaryText.length} chars)`);

  // Send via Telegram if enabled
  if (isTelegramDeliveryEnabled()) {
    try {
      const header = `📋 Daily Security Summary — ${date}`;
      const message = `${header}\n\n${summaryText}`;
      await telegramService.sendTextMessage(message);
      updateDailySummaryTelegram(summaryId, true);
      console.log(`[OllamaService] Summary sent via Telegram.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[OllamaService] Failed to send summary via Telegram: ${msg}`);
    }
  }

  return { id: summaryId, summaryText, eventCount };
}

/**
 * Get existing daily summary for a date (from DB).
 */
export function getExistingSummary(date: string): {
  id: string;
  summaryDate: string;
  summaryText: string;
  modelUsed: string | null;
  eventCount: number | null;
  generatedAt: string;
  telegramSent: boolean;
} | null {
  const row = getDailySummary(date) as {
    id: string;
    summary_date: string;
    summary_text: string;
    model_used: string | null;
    event_count: number | null;
    generated_at: string;
    telegram_sent: number;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    summaryDate: row.summary_date,
    summaryText: row.summary_text,
    modelUsed: row.model_used,
    eventCount: row.event_count,
    generatedAt: row.generated_at,
    telegramSent: row.telegram_sent === 1,
  };
}

/**
 * Start the daily summary scheduler.
 * Checks every minute if it's time to generate the summary.
 */
export function startSummaryScheduler(): void {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(() => {
    const now = new Date();
    const { hour, minute } = getSummaryTime();

    if (now.getHours() === hour && now.getMinutes() === minute && lastScheduledHour !== hour) {
      lastScheduledHour = hour;
      const dateStr = now.toISOString().split('T')[0];

      console.log(`[OllamaService] Scheduled summary generation triggered for ${dateStr}`);

      generateDailySummary(dateStr).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[OllamaService] Scheduled summary generation failed: ${msg}`);
      });
    }

    // Reset the hour tracker at the start of the next hour
    if (now.getMinutes() !== lastScheduledHour) {
      // This allows re-triggering if the app was restarted
    }
  }, 60_000); // Check every minute

  console.log(`[OllamaService] Summary scheduler started (scheduled at ${getSummaryTime().hour}:${String(getSummaryTime().minute).padStart(2, '0')}).`);
}

/**
 * Stop the summary scheduler.
 */
export function stopSummaryScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
