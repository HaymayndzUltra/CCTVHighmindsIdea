import { ipcMain } from 'electron';
import { telegramService } from '../services/TelegramService';

export function registerTelegramHandlers(): void {
  ipcMain.handle(
    'telegram:test',
    async (_event, payload: { token: string; chatId: string }) => {
      if (!payload || !payload.token || !payload.chatId) {
        console.error('[IPC][telegram:test] Missing token or chatId in payload.');
        throw new Error('Bot token and chat ID are required.');
      }

      try {
        const result = await telegramService.sendTestMessage(payload.token, payload.chatId);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[IPC][telegram:test] Error: ${message}`);
        return { success: false, message: `Test failed: ${message}` };
      }
    }
  );

  console.log('[IPC] Telegram handlers registered.');
}
