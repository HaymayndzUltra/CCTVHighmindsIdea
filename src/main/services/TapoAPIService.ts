import crypto from 'crypto';
import https from 'https';

// ============================================================
// TapoAPIService — HTTP API client for TP-Link Tapo cameras
// Handles authentication, PTZ control, and camera info queries
// Protocol based on reverse-engineered Tapo camera local HTTP API
// ============================================================

interface TapoSession {
  stok: string;
  cameraIp: string;
  createdAt: number;
  expiresAt: number;
}

interface TapoCredentials {
  username: string;
  password: string;
}

interface TapoPreset {
  id: string;
  name: string;
}

interface TapoDeviceInfo {
  deviceModel: string;
  firmwareVersion: string;
  hardwareVersion: string;
  macAddress: string;
  deviceName: string;
}

interface TapoMotionDetectionConfig {
  enabled: boolean;
  sensitivity: string;
}

interface TapoSDCardInfo {
  totalSpace: number;
  freeSpace: number;
  status: string;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes — Tapo tokens expire ~15min
const REQUEST_TIMEOUT_MS = 8000;

class TapoAPIService {
  private sessions: Map<string, TapoSession> = new Map();
  private credentials: Map<string, TapoCredentials> = new Map();
  private connectionStatuses: Map<string, ConnectionStatus> = new Map();
  private httpsAgent: https.Agent;

  constructor() {
    // Tapo cameras use self-signed certificates
    this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }

  // --- Authentication ---

  setCredentials(cameraId: string, cameraIp: string, username: string, password: string): void {
    this.credentials.set(cameraId, { username, password });
    // Store ip → cameraId mapping is handled by callers via the cameraIp param
    console.log(`[TapoAPI] Credentials set for camera ${cameraId} (${cameraIp})`);
  }

  getConnectionStatus(cameraId: string): ConnectionStatus {
    return this.connectionStatuses.get(cameraId) ?? 'disconnected';
  }

  private hashCredential(value: string): string {
    return crypto.createHash('md5').update(value).digest('hex').toUpperCase();
  }

  async authenticate(cameraId: string, cameraIp: string): Promise<string> {
    const creds = this.credentials.get(cameraId);
    if (!creds) {
      throw new Error(`[TapoAPI] No credentials configured for camera ${cameraId}`);
    }

    // Check for valid existing session
    const existing = this.sessions.get(cameraId);
    if (existing && Date.now() < existing.expiresAt) {
      return existing.stok;
    }

    this.connectionStatuses.set(cameraId, 'connecting');

    try {
      const hashedPassword = this.hashCredential(creds.password);

      const loginPayload = {
        method: 'login',
        params: {
          hashed: true,
          password: hashedPassword,
          username: creds.username,
        },
      };

      const response = await this.rawHttpPost(cameraIp, '/', loginPayload);

      if (response.error_code !== 0) {
        this.connectionStatuses.set(cameraId, 'error');
        throw new Error(
          `[TapoAPI] Authentication failed for ${cameraId}: error_code=${response.error_code}`
        );
      }

      const resultObj = response.result as Record<string, unknown> | undefined;
      const stok = resultObj?.stok as string | undefined;
      if (!stok) {
        this.connectionStatuses.set(cameraId, 'error');
        throw new Error(`[TapoAPI] No stok token in auth response for ${cameraId}`);
      }

      const session: TapoSession = {
        stok,
        cameraIp,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS,
      };

      this.sessions.set(cameraId, session);
      this.connectionStatuses.set(cameraId, 'connected');
      console.log(`[TapoAPI] Authenticated with camera ${cameraId} (${cameraIp})`);

      return stok;
    } catch (error) {
      this.connectionStatuses.set(cameraId, 'error');
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TapoAPI] Authentication error for ${cameraId}: ${message}`);
      throw error;
    }
  }

  private invalidateSession(cameraId: string): void {
    this.sessions.delete(cameraId);
    this.connectionStatuses.set(cameraId, 'disconnected');
  }

  // --- Core HTTP Transport ---

  private async rawHttpPost(
    cameraIp: string,
    urlPath: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(body);

      const options: https.RequestOptions = {
        hostname: cameraIp,
        port: 443,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        agent: this.httpsAgent,
        timeout: REQUEST_TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            resolve(parsed);
          } catch (parseError) {
            reject(new Error(`[TapoAPI] Failed to parse response: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`[TapoAPI] Request to ${cameraIp}${urlPath} timed out`));
      });

      req.on('error', (error) => {
        reject(new Error(`[TapoAPI] HTTP error for ${cameraIp}: ${error.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  private async performRequest(
    cameraId: string,
    cameraIp: string,
    payload: Record<string, unknown>,
    retryOnAuthFailure = true
  ): Promise<Record<string, unknown>> {
    const stok = await this.authenticate(cameraId, cameraIp);
    const urlPath = `/stok=${stok}/ds`;

    try {
      const response = await this.rawHttpPost(cameraIp, urlPath, payload);

      // error_code -40401 means stok expired
      if (
        (response.error_code === -40401 || response.error_code === -40210) &&
        retryOnAuthFailure
      ) {
        console.warn(`[TapoAPI] Session expired for ${cameraId}, re-authenticating...`);
        this.invalidateSession(cameraId);
        return this.performRequest(cameraId, cameraIp, payload, false);
      }

      if (response.error_code !== 0) {
        throw new Error(
          `[TapoAPI] Request failed for ${cameraId}: error_code=${response.error_code}`
        );
      }

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TapoAPI] Request error for ${cameraId}: ${message}`);
      throw error;
    }
  }

  // --- PTZ Commands (Task 3.1.2) ---

  async move(
    cameraId: string,
    cameraIp: string,
    direction: 'up' | 'down' | 'left' | 'right',
    speed: number = 50
  ): Promise<void> {
    if (!direction || !cameraId) {
      throw new Error('[TapoAPI] move() requires cameraId and direction');
    }

    const clampedSpeed = Math.max(1, Math.min(100, speed));

    const coordMap: Record<string, { x: string; y: string }> = {
      up: { x: '0', y: String(clampedSpeed) },
      down: { x: '0', y: String(-clampedSpeed) },
      left: { x: String(-clampedSpeed), y: '0' },
      right: { x: String(clampedSpeed), y: '0' },
    };

    const coords = coordMap[direction];

    const payload = {
      method: 'do',
      motor: {
        move: {
          x_coord: coords.x,
          y_coord: coords.y,
        },
      },
    };

    await this.performRequest(cameraId, cameraIp, payload);
    console.log(`[TapoAPI] PTZ move ${direction} (speed=${clampedSpeed}) on ${cameraId}`);
  }

  async stop(cameraId: string, cameraIp: string): Promise<void> {
    if (!cameraId) {
      throw new Error('[TapoAPI] stop() requires cameraId');
    }

    const payload = {
      method: 'do',
      motor: {
        stop: 'null',
      },
    };

    await this.performRequest(cameraId, cameraIp, payload);
    console.log(`[TapoAPI] PTZ stop on ${cameraId}`);
  }

  async setPreset(cameraId: string, cameraIp: string, name: string): Promise<void> {
    if (!cameraId || !name) {
      throw new Error('[TapoAPI] setPreset() requires cameraId and name');
    }

    const payload = {
      method: 'do',
      preset: {
        set_preset: {
          name,
          save_ptz: '1',
        },
      },
    };

    await this.performRequest(cameraId, cameraIp, payload);
    console.log(`[TapoAPI] Preset "${name}" saved on ${cameraId}`);
  }

  async goToPreset(cameraId: string, cameraIp: string, presetId: string): Promise<void> {
    if (!cameraId || !presetId) {
      throw new Error('[TapoAPI] goToPreset() requires cameraId and presetId');
    }

    const payload = {
      method: 'do',
      preset: {
        goto_preset: {
          id: presetId,
        },
      },
    };

    await this.performRequest(cameraId, cameraIp, payload);
    console.log(`[TapoAPI] Go to preset ${presetId} on ${cameraId}`);
  }

  async getPresets(cameraId: string, cameraIp: string): Promise<TapoPreset[]> {
    if (!cameraId) {
      throw new Error('[TapoAPI] getPresets() requires cameraId');
    }

    const payload = {
      method: 'get',
      preset: {
        name: ['preset'],
      },
    };

    try {
      const response = await this.performRequest(cameraId, cameraIp, payload);
      const presetData = response.result as Record<string, unknown> | undefined;
      const presetInfo = presetData?.preset as Record<string, unknown> | undefined;
      const presetList = presetInfo?.preset as Record<string, unknown> | undefined;

      if (!presetList || !presetList.id || !presetList.name) {
        return [];
      }

      const ids = presetList.id as string[];
      const names = presetList.name as string[];

      return ids.map((id, index) => ({
        id,
        name: names[index] ?? `Preset ${id}`,
      }));
    } catch (error) {
      console.error(`[TapoAPI] Failed to get presets for ${cameraId}:`, error);
      return [];
    }
  }

  // --- Camera Info Queries (Task 3.1.3) ---

  async getDeviceInfo(cameraId: string, cameraIp: string): Promise<TapoDeviceInfo> {
    if (!cameraId) {
      throw new Error('[TapoAPI] getDeviceInfo() requires cameraId');
    }

    const payload = {
      method: 'get',
      device_info: {
        name: ['basic_info'],
      },
    };

    const response = await this.performRequest(cameraId, cameraIp, payload);
    const result = response.result as Record<string, unknown> | undefined;
    const deviceInfo = result?.device_info as Record<string, unknown> | undefined;
    const basicInfo = deviceInfo?.basic_info as Record<string, string> | undefined;

    return {
      deviceModel: basicInfo?.device_model ?? 'Unknown',
      firmwareVersion: basicInfo?.sw_version ?? 'Unknown',
      hardwareVersion: basicInfo?.hw_version ?? 'Unknown',
      macAddress: basicInfo?.mac ?? 'Unknown',
      deviceName: basicInfo?.device_name ?? 'Unknown',
    };
  }

  async getMotionDetectionConfig(
    cameraId: string,
    cameraIp: string
  ): Promise<TapoMotionDetectionConfig> {
    if (!cameraId) {
      throw new Error('[TapoAPI] getMotionDetectionConfig() requires cameraId');
    }

    const payload = {
      method: 'get',
      msg_alarm: {
        name: ['chn1_msg_alarm_info'],
      },
    };

    try {
      const response = await this.performRequest(cameraId, cameraIp, payload);
      const result = response.result as Record<string, unknown> | undefined;
      const msgAlarm = result?.msg_alarm as Record<string, unknown> | undefined;
      const alarmInfo = msgAlarm?.chn1_msg_alarm_info as Record<string, unknown> | undefined;

      return {
        enabled: alarmInfo?.enabled === 'on',
        sensitivity: (alarmInfo?.alarm_type as string) ?? 'medium',
      };
    } catch (error) {
      console.error(`[TapoAPI] Failed to get motion config for ${cameraId}:`, error);
      return { enabled: false, sensitivity: 'medium' };
    }
  }

  async getSDCardInfo(cameraId: string, cameraIp: string): Promise<TapoSDCardInfo> {
    if (!cameraId) {
      throw new Error('[TapoAPI] getSDCardInfo() requires cameraId');
    }

    const payload = {
      method: 'get',
      harddisk_manage: {
        name: ['harddisk'],
      },
    };

    try {
      const response = await this.performRequest(cameraId, cameraIp, payload);
      const result = response.result as Record<string, unknown> | undefined;
      const hdManage = result?.harddisk_manage as Record<string, unknown> | undefined;
      const hdInfo = hdManage?.harddisk as Record<string, unknown>[] | undefined;

      if (!hdInfo || hdInfo.length === 0) {
        return { totalSpace: 0, freeSpace: 0, status: 'not_installed' };
      }

      const disk = hdInfo[0];
      return {
        totalSpace: Number(disk.total_space ?? 0),
        freeSpace: Number(disk.free_space ?? 0),
        status: (disk.status as string) ?? 'unknown',
      };
    } catch (error) {
      console.error(`[TapoAPI] Failed to get SD card info for ${cameraId}:`, error);
      return { totalSpace: 0, freeSpace: 0, status: 'error' };
    }
  }

  // --- Connection Management (Task 3.1.4) ---

  async reconnect(cameraId: string, cameraIp: string): Promise<boolean> {
    this.invalidateSession(cameraId);

    try {
      await this.authenticate(cameraId, cameraIp);
      return true;
    } catch (error) {
      console.error(`[TapoAPI] Reconnection failed for ${cameraId}:`, error);
      return false;
    }
  }

  disconnect(cameraId: string): void {
    this.invalidateSession(cameraId);
    this.credentials.delete(cameraId);
    console.log(`[TapoAPI] Disconnected camera ${cameraId}`);
  }

  disconnectAll(): void {
    for (const cameraId of this.sessions.keys()) {
      this.invalidateSession(cameraId);
    }
    this.credentials.clear();
    console.log('[TapoAPI] All camera sessions disconnected.');
  }

  isConnected(cameraId: string): boolean {
    const session = this.sessions.get(cameraId);
    return session !== undefined && Date.now() < session.expiresAt;
  }
}

export const tapoAPIService = new TapoAPIService();
export type { TapoPreset, TapoDeviceInfo, TapoMotionDetectionConfig, TapoSDCardInfo };
