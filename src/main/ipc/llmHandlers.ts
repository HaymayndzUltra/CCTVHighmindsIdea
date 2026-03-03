import { ipcMain } from 'electron';
import {
  checkOllamaHealth,
  getOllamaStatus,
  generateDailySummary,
  getExistingSummary,
} from '../services/OllamaService';

export function registerLlmHandlers(): void {
  /**
   * llm:status — Get Ollama status (running, model loaded, etc.).
   */
  ipcMain.handle('llm:status', async () => {
    await checkOllamaHealth();
    return getOllamaStatus();
  });

  /**
   * llm:summary — Get or generate daily summary for a date.
   * If `generate` is true, forces re-generation even if one exists.
   */
  ipcMain.handle(
    'llm:summary',
    async (_event, payload: { date: string; generate?: boolean }) => {
      if (!payload || !payload.date) {
        throw new Error('date is required.');
      }

      // Check for existing summary first
      if (!payload.generate) {
        const existing = getExistingSummary(payload.date);
        if (existing) {
          return { summary: existing, fromCache: true };
        }
      }

      // Generate new summary
      try {
        const result = await generateDailySummary(payload.date);
        const summary = getExistingSummary(payload.date);
        return { summary, fromCache: false };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[IPC][llm:summary] Generation failed: ${msg}`);
        throw new Error(`Failed to generate summary: ${msg}`);
      }
    }
  );

  console.log('[IPC] LLM handlers registered.');
}
