import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { app } from 'electron';
import { encryptEmbedding, decryptEmbedding } from './CryptoService';
import type { EventFilters } from '../../shared/types';

let db: Database.Database | null = null;

function getDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'tapo-cctv.db');
}

function getSchemaPath(): string {
  return path.join(__dirname, '..', 'database', 'schema.sql');
}

function getMigrationsDir(): string {
  return path.join(__dirname, '..', 'database', 'migrations');
}

export function initDatabase(): void {
  if (db) {
    return;
  }

  const dbPath = getDatabasePath();
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = getSchemaPath();
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  console.log(`[DatabaseService] Database initialized at: ${dbPath}`);

  runMigrations();
}

function getSchemaVersion(): string {
  try {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    return row?.value ?? '1.0';
  } catch {
    return '1.0';
  }
}

function runMigrations(): void {
  let currentVersion = getSchemaVersion();
  console.log(`[DatabaseService] Current schema version: ${currentVersion}`);

  // Integrity check: if version claims 2.0 but v2.0 columns are missing, force re-migration
  if (currentVersion === '2.0') {
    try {
      getDb().prepare('SELECT stream_protocol FROM cameras LIMIT 0');
      getDb().prepare('SELECT global_person_id FROM persons LIMIT 0');
    } catch {
      console.warn('[DatabaseService] Schema version is 2.0 but v2.0 columns missing — forcing re-migration.');
      getDb().prepare("UPDATE settings SET value = '1.0' WHERE key = 'schema_version'").run();
      currentVersion = '1.0';
    }
  }

  const migrationsDir = getMigrationsDir();
  if (!fs.existsSync(migrationsDir)) {
    console.log('[DatabaseService] No migrations directory found, skipping.');
    return;
  }

  const pendingMigrations: Array<{ version: string; file: string }> = [
    { version: '2.0', file: 'v2.0.sql' },
  ];

  for (const migration of pendingMigrations) {
    if (compareVersions(migration.version, currentVersion) > 0) {
      const migrationPath = path.join(migrationsDir, migration.file);
      if (!fs.existsSync(migrationPath)) {
        console.warn(`[DatabaseService] Migration file not found: ${migrationPath}`);
        continue;
      }

      console.log(`[DatabaseService] Running migration: ${migration.file} (${currentVersion} → ${migration.version})`);

      try {
        const sql = fs.readFileSync(migrationPath, 'utf-8');
        // Run each statement individually to handle partial migrations gracefully.
        // ALTER TABLE ADD COLUMN will fail if column already exists (no IF NOT EXISTS in SQLite).
        const statements = sql
          .split(';')
          .map((s) => s.trim())
          .filter((s) => {
            // Check if chunk contains any actual SQL (not just comments/whitespace)
            const lines = s.split('\n');
            return lines.some((line) => {
              const trimmed = line.trim();
              return trimmed.length > 0 && !trimmed.startsWith('--');
            });
          });
        for (const stmt of statements) {
          try {
            getDb().exec(stmt + ';');
          } catch (stmtErr) {
            const stmtMsg = stmtErr instanceof Error ? stmtErr.message : String(stmtErr);
            if (stmtMsg.includes('duplicate column') || stmtMsg.includes('already exists')) {
              // Column already exists from a prior partial migration — safe to skip
              continue;
            }
            throw stmtErr;
          }
        }
        console.log(`[DatabaseService] Migration ${migration.version} applied successfully.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[DatabaseService] Migration ${migration.version} FAILED: ${message}`);
        throw new Error(`Schema migration to v${migration.version} failed: ${message}`);
      }
    }
  }

  const finalVersion = getSchemaVersion();
  console.log(`[DatabaseService] Schema version after migrations: ${finalVersion}`);
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('[DatabaseService] Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[DatabaseService] Database connection closed.');
  }
}

// --- Settings CRUD ---

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value);
}

// --- Seed Functions ---

export function seedDefaultSettings(): void {
  const defaults: Record<string, string> = {
    // --- Inherited from v1.0 ---
    telegram_bot_token: '',
    telegram_chat_id: '',
    telegram_enabled: 'false',
    retention_days: '90',
    auto_purge_enabled: 'true',
    default_layout: '2x2',
    mini_ptz_enabled: 'false',
    recognition_threshold: '0.6',
    detection_threshold: '0.5',
    gpu_enabled: 'true',
    motion_sensitivity_default: '50',
    // --- v2.0: AI / Detection ---
    yolo_enabled: 'true',
    yolo_confidence: '0.5',
    yolo_classes: 'person,car,truck,dog,cat',
    bytetrack_enabled: 'true',
    // --- v2.0: Face Quality Gate ---
    quality_gate_enabled: 'true',
    quality_max_yaw_deg: '40.0',
    quality_max_pitch_deg: '30.0',
    quality_min_blur_score: '60.0',
    quality_min_det_score: '0.72',
    quality_confirm_frames: '3',
    quality_embedding_ema_alpha: '0.4',
    // --- v2.0: Night Enhancement ---
    night_enhance_enabled: 'true',
    night_luminance_threshold: '80.0',
    // --- v2.0: Auto-Enrollment ---
    auto_enroll_enabled: 'true',
    auto_enroll_min_similarity: '0.55',
    auto_enroll_max_per_person: '5',
    auto_enroll_min_quality: '80.0',
    auto_enroll_expiry_days: '30',
    // --- v2.0: Adaptive Threshold ---
    adaptive_threshold_enabled: 'true',
    adaptive_min_threshold: '0.45',
    adaptive_max_threshold: '0.65',
    adaptive_min_margin: '0.08',
    // --- v2.0: Re-ID ---
    reid_enabled: 'true',
    reid_gallery_ttl_sec: '300',
    reid_face_weight: '0.7',
    reid_body_weight: '0.3',
    // --- v2.0: Gait ---
    gait_enabled: 'false',
    gait_min_frames: '30',
    // --- v2.0: Liveness ---
    liveness_enabled: 'true',
    liveness_threshold: '0.5',
    // --- v2.0: Sound ---
    sound_detection_enabled: 'false',
    sound_events: 'glass_break,gunshot,scream',
    sound_confidence_threshold: '0.7',
    // --- v2.0: Zones ---
    zone_default_loiter_sec: '15',
    zone_default_cooldown_sec: '180',
    // --- v2.0: PTZ ---
    ptz_autotrack_enabled: 'false',
    ptz_autotrack_dead_zone: '0.1',
    ptz_autotrack_priority: 'unknown_first',
    ptz_patrol_mode: 'manual',
    // --- v2.0: Recording ---
    recording_mode: 'event_triggered',
    recording_retention_days: '30',
    recording_storage_path: '',
    recording_segment_duration_min: '15',
    // --- v2.0: WebRTC ---
    webrtc_enabled: 'true',
    // --- v2.0: LLM ---
    llm_enabled: 'false',
    llm_ollama_endpoint: 'http://localhost:11434',
    llm_model: 'llama3.2:7b',
    llm_summary_time: '23:00',
    llm_telegram_delivery: 'false',
    // --- v2.0: Topology ---
    topology_blind_spot_max_sec: '60',
    // --- v2.0: Presence ---
    presence_away_timeout_min: '30',
    // --- v2.0: Burst Capture ---
    burst_capture_enabled: 'false',
  };

  const insertStmt = getDb().prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`
  );

  const seedTransaction = getDb().transaction(() => {
    for (const [key, value] of Object.entries(defaults)) {
      insertStmt.run(key, value);
    }
  });

  seedTransaction();
  console.log('[DatabaseService] Default settings seeded.');
}

export function seedDefaultCameras(): void {
  const cameras = [
    {
      id: 'CAM-1',
      label: 'SALA (Indoor)',
      ip_address: '192.168.100.213',
      model: 'Tapo C520WS',
      type: 'indoor',
      rtsp_url: 'rtsp://127.0.0.1:8554/cam1_main',
      rtsp_main_url: 'rtsp://127.0.0.1:8554/cam1_main',
      rtsp_sub_url: 'rtsp://127.0.0.1:8554/cam1_sub',
      has_ptz: 1,
      ptz_type: 'tapo',
      camera_group_id: null,
      heuristic_direction: 'INSIDE',
      motion_sensitivity: 50,
      enabled: 1,
      stream_protocol: 'tapo',
      stream_username: null,
      stream_password: 'Magandaako03291993',
      recording_mode: 'off',
    },
    {
      id: 'CAM-2A',
      label: 'Front Gate (Wide)',
      ip_address: '192.168.100.214',
      model: 'Tapo C246D HW1.0',
      type: 'outdoor',
      rtsp_url: 'rtsp://127.0.0.1:8554/cam2a_sub',
      rtsp_main_url: 'rtsp://127.0.0.1:8554/cam2a_sub',
      rtsp_sub_url: 'rtsp://127.0.0.1:8554/cam2a_sub',
      has_ptz: 0,
      ptz_type: null,
      camera_group_id: 'GATE_GROUP',
      heuristic_direction: 'ENTER',
      motion_sensitivity: 50,
      enabled: 1,
      stream_protocol: 'rtsp',
      stream_username: 'Rehj2026',
      stream_password: 'Rehj2026',
      recording_mode: 'off',
    },
    {
      id: 'CAM-2B',
      label: 'Front Gate (Telephoto)',
      ip_address: '192.168.100.214',
      model: 'Tapo C246D HW1.0',
      type: 'outdoor',
      rtsp_url: 'rtsp://127.0.0.1:8554/cam2b_main',
      rtsp_main_url: 'rtsp://127.0.0.1:8554/cam2b_main',
      rtsp_sub_url: 'rtsp://127.0.0.1:8554/cam2b_main',
      has_ptz: 1,
      ptz_type: 'tapo',
      camera_group_id: 'GATE_GROUP',
      heuristic_direction: 'ENTER',
      motion_sensitivity: 50,
      enabled: 1,
      stream_protocol: 'rtsp',
      stream_username: 'Rehj2026',
      stream_password: 'Rehj2026',
      recording_mode: 'off',
    },
    {
      id: 'CAM-3',
      label: 'Garden → Gate',
      ip_address: '192.168.100.228',
      model: 'Tapo C520WS',
      type: 'outdoor',
      rtsp_url: 'rtsp://127.0.0.1:8554/cam3_main',
      rtsp_main_url: 'rtsp://127.0.0.1:8554/cam3_main',
      rtsp_sub_url: 'rtsp://127.0.0.1:8554/cam3_sub',
      has_ptz: 1,
      ptz_type: 'tapo',
      camera_group_id: null,
      heuristic_direction: 'ENTER',
      motion_sensitivity: 50,
      enabled: 1,
      stream_protocol: 'tapo',
      stream_username: null,
      stream_password: 'Magandaako03291993',
      recording_mode: 'off',
    },
  ];

  const insertStmt = getDb().prepare(
    `INSERT OR IGNORE INTO cameras (id, label, ip_address, model, type, rtsp_url, rtsp_main_url, rtsp_sub_url, has_ptz, ptz_type, camera_group_id, heuristic_direction, motion_sensitivity, enabled, stream_protocol, stream_username, stream_password, recording_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  );

  const updateStmt = getDb().prepare(
    `UPDATE cameras SET label = ?, model = ?, rtsp_main_url = ?, rtsp_sub_url = ?, has_ptz = ?, ptz_type = ?, camera_group_id = ?,
     stream_protocol = ?, stream_username = COALESCE(stream_username, ?), stream_password = COALESCE(stream_password, ?),
     updated_at = datetime('now') WHERE id = ?`
  );

  const seedTransaction = getDb().transaction(() => {
    for (const cam of cameras) {
      insertStmt.run(
        cam.id,
        cam.label,
        cam.ip_address,
        cam.model,
        cam.type,
        cam.rtsp_url,
        cam.rtsp_main_url,
        cam.rtsp_sub_url,
        cam.has_ptz,
        cam.ptz_type,
        cam.camera_group_id,
        cam.heuristic_direction,
        cam.motion_sensitivity,
        cam.enabled,
        cam.stream_protocol,
        cam.stream_username,
        cam.stream_password,
        cam.recording_mode
      );
      updateStmt.run(
        cam.label,
        cam.model,
        cam.rtsp_main_url,
        cam.rtsp_sub_url,
        cam.has_ptz,
        cam.ptz_type,
        cam.camera_group_id,
        cam.stream_protocol,
        cam.stream_username,
        cam.stream_password,
        cam.id
      );
    }
  });

  seedTransaction();
  console.log('[DatabaseService] Default cameras seeded (v2.0: 4 logical cameras).');
}

// --- Expose DB path for sidecar ---

export function getDbPath(): string {
  return getDatabasePath();
}

// --- Person CRUD ---

export interface PersonRow {
  id: string;
  name: string;
  label: string | null;
  enabled: number;
  telegram_notify: string;
  created_at: string;
  updated_at: string;
  embeddings_count: number;
  presence_state: string | null;
  last_seen_camera_id: string | null;
  last_seen_at: string | null;
  auto_enroll_count: number;
  auto_enroll_enabled: number;
  adaptive_threshold: number | null;
  global_person_id: string | null;
}

export function createPerson(name: string, label?: string): string {
  if (!name || name.trim().length === 0) {
    throw new Error('Person name is required.');
  }

  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO persons (id, name, label, enabled, telegram_notify, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'silent_log', datetime('now'), datetime('now'))`
    )
    .run(id, name.trim(), label?.trim() || null);

  console.log(`[DatabaseService] Created person: ${id} (${name})`);
  return id;
}

export function getPersons(): PersonRow[] {
  const rows = getDb()
    .prepare(
      `SELECT
        p.id, p.name, p.label, p.enabled, p.telegram_notify,
        p.created_at, p.updated_at,
        p.presence_state, p.last_seen_camera_id, p.last_seen_at,
        p.auto_enroll_count, p.auto_enroll_enabled, p.adaptive_threshold,
        p.global_person_id,
        COUNT(fe.id) AS embeddings_count
      FROM persons p
      LEFT JOIN face_embeddings fe ON p.id = fe.person_id
      GROUP BY p.id
      ORDER BY p.name ASC`
    )
    .all() as PersonRow[];
  return rows;
}

export function getPerson(id: string): PersonRow | null {
  if (!id) {
    throw new Error('Person ID is required.');
  }

  const row = getDb()
    .prepare(
      `SELECT
        p.id, p.name, p.label, p.enabled, p.telegram_notify,
        p.created_at, p.updated_at,
        p.presence_state, p.last_seen_camera_id, p.last_seen_at,
        p.auto_enroll_count, p.auto_enroll_enabled, p.adaptive_threshold,
        p.global_person_id,
        COUNT(fe.id) AS embeddings_count
      FROM persons p
      LEFT JOIN face_embeddings fe ON p.id = fe.person_id
      WHERE p.id = ?
      GROUP BY p.id`
    )
    .get(id) as PersonRow | undefined;

  return row ?? null;
}

export function updatePerson(
  id: string,
  data: { name?: string; label?: string; enabled?: boolean; telegramNotify?: string }
): void {
  if (!id) {
    throw new Error('Person ID is required.');
  }

  const existing = getDb().prepare('SELECT id FROM persons WHERE id = ?').get(id);
  if (!existing) {
    throw new Error(`Person '${id}' not found.`);
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    params.push(data.name.trim());
  }
  if (data.label !== undefined) {
    updates.push('label = ?');
    params.push(data.label.trim() || '');
  }
  if (data.enabled !== undefined) {
    updates.push('enabled = ?');
    params.push(data.enabled ? 1 : 0);
  }
  if (data.telegramNotify !== undefined) {
    updates.push('telegram_notify = ?');
    params.push(data.telegramNotify);
  }

  if (updates.length === 0) {
    return;
  }

  updates.push("updated_at = datetime('now')");
  params.push(id);

  getDb()
    .prepare(`UPDATE persons SET ${updates.join(', ')} WHERE id = ?`)
    .run(...params);

  console.log(`[DatabaseService] Updated person: ${id}`);
}

export function deletePerson(id: string): void {
  if (!id) {
    throw new Error('Person ID is required.');
  }

  const existing = getDb().prepare('SELECT id FROM persons WHERE id = ?').get(id);
  if (!existing) {
    throw new Error(`Person '${id}' not found.`);
  }

  const deleteTransaction = getDb().transaction(() => {
    getDb().prepare('DELETE FROM face_embeddings WHERE person_id = ?').run(id);
    getDb().prepare('DELETE FROM persons WHERE id = ?').run(id);
  });

  deleteTransaction();
  console.log(`[DatabaseService] Deleted person: ${id} (and associated embeddings)`);
}

// --- Face Embedding Storage ---

export interface EmbeddingRow {
  id: string;
  person_id: string;
  embedding_encrypted: Buffer;
  iv: Buffer;
  source_type: string;
  source_reference: string | null;
  created_at: string;
}

export function storeEmbedding(
  personId: string,
  embedding: number[],
  sourceType: string,
  sourceRef?: string
): string {
  if (!personId) {
    throw new Error('Person ID is required.');
  }
  if (!embedding || embedding.length === 0) {
    throw new Error('Embedding data is required.');
  }

  const { encrypted, iv } = encryptEmbedding(embedding);
  const id = crypto.randomUUID();

  getDb()
    .prepare(
      `INSERT INTO face_embeddings (id, person_id, embedding_encrypted, iv, source_type, source_reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(id, personId, encrypted, iv, sourceType, sourceRef || null);

  console.log(`[DatabaseService] Stored embedding ${id} for person ${personId}`);
  return id;
}

export function getEmbeddingsByPerson(personId: string): Array<{ id: string; embedding: number[]; sourceType: string; createdAt: string }> {
  if (!personId) {
    throw new Error('Person ID is required.');
  }

  const rows = getDb()
    .prepare(
      `SELECT id, embedding_encrypted, iv, source_type, created_at
       FROM face_embeddings
       WHERE person_id = ?
       ORDER BY created_at ASC`
    )
    .all(personId) as EmbeddingRow[];

  const results: Array<{ id: string; embedding: number[]; sourceType: string; createdAt: string }> = [];

  for (const row of rows) {
    try {
      const embedding = decryptEmbedding(row.embedding_encrypted, row.iv);
      results.push({
        id: row.id,
        embedding,
        sourceType: row.source_type,
        createdAt: row.created_at,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DatabaseService] Failed to decrypt embedding ${row.id}: ${message}`);
    }
  }

  return results;
}

export function getAllEmbeddings(): Array<{ personId: string; personName: string; embedding: number[] }> {
  const rows = getDb()
    .prepare(
      `SELECT fe.id, fe.person_id, fe.embedding_encrypted, fe.iv, p.name AS person_name
       FROM face_embeddings fe
       JOIN persons p ON fe.person_id = p.id
       WHERE p.enabled = 1`
    )
    .all() as (EmbeddingRow & { person_name: string })[];

  const results: Array<{ personId: string; personName: string; embedding: number[] }> = [];

  for (const row of rows) {
    try {
      const embedding = decryptEmbedding(row.embedding_encrypted, row.iv);
      results.push({
        personId: row.person_id,
        personName: row.person_name,
        embedding,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DatabaseService] Failed to decrypt embedding ${row.id}: ${message}`);
    }
  }

  return results;
}

// --- Event CRUD ---

export interface EventRow {
  id: string;
  camera_id: string;
  person_id: string | null;
  person_name: string | null;
  is_known: number;
  direction: string | null;
  detection_method: string | null;
  confidence: number | null;
  bbox: string | null;
  snapshot_path: string | null;
  clip_path: string | null;
  telegram_sent: number;
  telegram_sent_at: string | null;
  created_at: string;
  event_type: string | null;
  track_id: number | null;
  global_person_id: string | null;
  zone_id: string | null;
  journey_id: string | null;
  behavior_type: string | null;
  sound_event_type: string | null;
  sound_confidence: number | null;
  liveness_score: number | null;
  is_live: number | null;
  identity_method: string | null;
  identity_fusion_score: number | null;
}

export interface CreateEventData {
  id: string;
  cameraId: string;
  personId: string | null;
  personName: string;
  isKnown: boolean;
  direction: 'ENTER' | 'EXIT' | 'INSIDE' | null;
  detectionMethod: 'line_crossing' | 'heuristic' | 'zone' | 'tripwire' | null;
  confidence: number;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  snapshotPath: string | null;
  clipPath: string | null;
}

export function createEvent(data: CreateEventData): string {
  if (!data.id) {
    throw new Error('Event ID is required.');
  }
  if (!data.cameraId) {
    throw new Error('Camera ID is required.');
  }

  const bboxJson = data.bbox ? JSON.stringify(data.bbox) : null;

  getDb()
    .prepare(
      `INSERT INTO events (id, camera_id, person_id, person_name, is_known, direction, detection_method, confidence, bbox, snapshot_path, clip_path, telegram_sent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`
    )
    .run(
      data.id,
      data.cameraId,
      data.personId,
      data.personName,
      data.isKnown ? 1 : 0,
      data.direction,
      data.detectionMethod,
      data.confidence,
      bboxJson,
      data.snapshotPath,
      data.clipPath
    );

  console.log(`[DatabaseService] Created event: ${data.id} (${data.cameraId}, ${data.personName})`);
  return data.id;
}

export function getEvents(filters: EventFilters): EventRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.cameraId) {
    conditions.push('camera_id = ?');
    params.push(filters.cameraId);
  }
  if (filters.personId) {
    conditions.push('person_id = ?');
    params.push(filters.personId);
  }
  if (filters.isKnown !== undefined) {
    conditions.push('is_known = ?');
    params.push(filters.isKnown ? 1 : 0);
  }
  if (filters.direction) {
    conditions.push('direction = ?');
    params.push(filters.direction);
  }
  if (filters.dateFrom) {
    conditions.push('created_at >= ?');
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push('created_at <= ?');
    params.push(filters.dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const sql = `SELECT * FROM events ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  try {
    return getDb().prepare(sql).all(...params) as EventRow[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] getEvents failed: ${message}`);
    return [];
  }
}

export function getEvent(id: string): EventRow | null {
  if (!id) {
    throw new Error('Event ID is required.');
  }

  const row = getDb()
    .prepare('SELECT * FROM events WHERE id = ?')
    .get(id) as EventRow | undefined;

  return row ?? null;
}

export function deleteEventsOlderThan(days: number): number {
  if (days < 1) {
    throw new Error('Days must be at least 1.');
  }

  try {
    const result = getDb()
      .prepare(
        `DELETE FROM events WHERE created_at < datetime('now', '-' || ? || ' days')`
      )
      .run(days);

    console.log(`[DatabaseService] Purged ${result.changes} events older than ${days} days.`);
    return result.changes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] deleteEventsOlderThan failed: ${message}`);
    return 0;
  }
}

export function updateEventTelegram(eventId: string, sent: boolean): void {
  if (!eventId) {
    throw new Error('Event ID is required.');
  }

  getDb()
    .prepare(
      `UPDATE events SET telegram_sent = ?, telegram_sent_at = datetime('now') WHERE id = ?`
    )
    .run(sent ? 1 : 0, eventId);
}

export function deleteEmbeddingsByPerson(personId: string): number {
  if (!personId) {
    throw new Error('Person ID is required.');
  }

  const result = getDb()
    .prepare('DELETE FROM face_embeddings WHERE person_id = ?')
    .run(personId);

  console.log(`[DatabaseService] Deleted ${result.changes} embeddings for person ${personId}`);
  return result.changes;
}

// --- Privacy: Purge All Faces ---

export function purgeAllFaces(): { personsDeleted: number; embeddingsDeleted: number } {
  try {
    const purgeTransaction = getDb().transaction(() => {
      const embResult = getDb().prepare('DELETE FROM face_embeddings').run();
      const persResult = getDb().prepare('DELETE FROM persons').run();
      return { personsDeleted: persResult.changes, embeddingsDeleted: embResult.changes };
    });

    const result = purgeTransaction();
    console.log(
      `[DatabaseService] Purged ALL faces: ${result.personsDeleted} persons, ${result.embeddingsDeleted} embeddings`
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] purgeAllFaces failed: ${message}`);
    throw new Error(`Failed to purge face data: ${message}`);
  }
}

// --- Auto-Purge ---

export function getSnapshotPathsOlderThan(days: number): string[] {
  if (days < 1) {
    return [];
  }

  try {
    const rows = getDb()
      .prepare(
        `SELECT snapshot_path FROM events
         WHERE snapshot_path IS NOT NULL
         AND created_at < datetime('now', '-' || ? || ' days')`
      )
      .all(days) as { snapshot_path: string }[];

    return rows.map((r) => r.snapshot_path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] getSnapshotPathsOlderThan failed: ${message}`);
    return [];
  }
}

export function runAutoPurge(): { deletedEvents: number; freedFiles: number } {
  try {
    const autoPurgeEnabled = getSetting('auto_purge_enabled');
    if (autoPurgeEnabled !== 'true') {
      console.log('[DatabaseService] Auto-purge disabled, skipping.');
      return { deletedEvents: 0, freedFiles: 0 };
    }

    const retentionDaysStr = getSetting('retention_days');
    const retentionDays = parseInt(retentionDaysStr || '90', 10);

    if (retentionDays <= 0) {
      console.log('[DatabaseService] Retention set to unlimited, skipping auto-purge.');
      return { deletedEvents: 0, freedFiles: 0 };
    }

    const snapshotPaths = getSnapshotPathsOlderThan(retentionDays);
    let freedFiles = 0;
    for (const snapshotPath of snapshotPaths) {
      try {
        if (fs.existsSync(snapshotPath)) {
          fs.unlinkSync(snapshotPath);
          freedFiles++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[DatabaseService] Failed to delete snapshot ${snapshotPath}: ${msg}`);
      }
    }

    const deletedEvents = deleteEventsOlderThan(retentionDays);

    console.log(
      `[DatabaseService] Auto-purge complete: ${deletedEvents} events deleted, ${freedFiles} snapshot files removed.`
    );
    return { deletedEvents, freedFiles };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] runAutoPurge failed: ${message}`);
    return { deletedEvents: 0, freedFiles: 0 };
  }
}

// --- System Info Helpers ---

export function getEventsCount(): number {
  try {
    const row = getDb().prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number };
    return row.count;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] getEventsCount failed: ${message}`);
    return 0;
  }
}

export function getDatabaseFileSize(): number {
  try {
    const dbPath = getDatabasePath();
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      return stats.size;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] getDatabaseFileSize failed: ${message}`);
    return 0;
  }
}

export function getCamerasConnectedCount(): number {
  try {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS count FROM cameras WHERE enabled = 1')
      .get() as { count: number };
    return row.count;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] getCamerasConnectedCount failed: ${message}`);
    return 0;
  }
}

// --- v2.0 Camera Helpers ---

export function getCamerasByGroup(groupId: string): Array<{ id: string; label: string }> {
  if (!groupId) return [];
  try {
    return getDb()
      .prepare('SELECT id, label FROM cameras WHERE camera_group_id = ? AND enabled = 1')
      .all(groupId) as Array<{ id: string; label: string }>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] getCamerasByGroup failed: ${message}`);
    return [];
  }
}

export function getCameraSubStreamUrl(cameraId: string): string | null {
  if (!cameraId) return null;
  try {
    const row = getDb()
      .prepare('SELECT rtsp_sub_url FROM cameras WHERE id = ?')
      .get(cameraId) as { rtsp_sub_url: string | null } | undefined;
    return row?.rtsp_sub_url ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] getCameraSubStreamUrl failed: ${message}`);
    return null;
  }
}

// --- Zone CRUD ---

export function createZone(data: {
  id: string;
  cameraId: string;
  name: string;
  zoneType: string;
  geometry: string;
  color?: string;
  alertEnabled?: boolean;
  loiterThresholdSec?: number;
  loiterCooldownSec?: number;
  loiterMovementRadius?: number;
}): string {
  if (!data.id || !data.cameraId || !data.name || !data.zoneType || !data.geometry) {
    throw new Error('Zone id, cameraId, name, zoneType, and geometry are required.');
  }
  getDb()
    .prepare(
      `INSERT INTO zones (id, camera_id, name, zone_type, geometry, color, alert_enabled, loiter_threshold_sec, loiter_cooldown_sec, loiter_movement_radius, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(
      data.id, data.cameraId, data.name, data.zoneType, data.geometry,
      data.color ?? '#FF0000', data.alertEnabled !== false ? 1 : 0,
      data.loiterThresholdSec ?? 15, data.loiterCooldownSec ?? 180,
      data.loiterMovementRadius ?? 80.0
    );
  return data.id;
}

export function getZonesByCamera(cameraId: string): unknown[] {
  if (!cameraId) return [];
  return getDb().prepare('SELECT * FROM zones WHERE camera_id = ? AND enabled = 1').all(cameraId);
}

export function getZone(id: string): unknown | null {
  if (!id) return null;
  return getDb().prepare('SELECT * FROM zones WHERE id = ?').get(id) ?? null;
}

export function updateZone(id: string, data: Record<string, unknown>): void {
  if (!id) throw new Error('Zone ID is required.');
  const updates: string[] = [];
  const params: unknown[] = [];
  const allowedFields: Record<string, string> = {
    name: 'name', zoneType: 'zone_type', geometry: 'geometry', color: 'color',
    alertEnabled: 'alert_enabled', loiterThresholdSec: 'loiter_threshold_sec',
    loiterCooldownSec: 'loiter_cooldown_sec', loiterMovementRadius: 'loiter_movement_radius',
    enabled: 'enabled', enterCount: 'enter_count', exitCount: 'exit_count',
  };
  for (const [key, col] of Object.entries(allowedFields)) {
    if (data[key] !== undefined) {
      updates.push(`${col} = ?`);
      params.push(typeof data[key] === 'boolean' ? (data[key] ? 1 : 0) : data[key]);
    }
  }
  if (updates.length === 0) return;
  updates.push("updated_at = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE zones SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteZone(id: string): void {
  if (!id) throw new Error('Zone ID is required.');
  getDb().prepare('DELETE FROM zones WHERE id = ?').run(id);
}

// --- Journey CRUD ---

export function createJourney(data: {
  id: string;
  personId: string | null;
  personName: string | null;
  globalPersonId?: string | null;
  startedAt: string;
  path: string;
}): string {
  if (!data.id || !data.startedAt || !data.path) {
    throw new Error('Journey id, startedAt, and path are required.');
  }
  getDb()
    .prepare(
      `INSERT INTO journeys (id, person_id, person_name, global_person_id, status, started_at, path, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, datetime('now'))`
    )
    .run(data.id, data.personId, data.personName, data.globalPersonId ?? null, data.startedAt, data.path);
  return data.id;
}

export function updateJourney(id: string, data: {
  status?: string;
  completedAt?: string;
  totalDurationSec?: number;
  path?: string;
}): void {
  if (!id) throw new Error('Journey ID is required.');
  const updates: string[] = [];
  const params: unknown[] = [];
  if (data.status !== undefined) { updates.push('status = ?'); params.push(data.status); }
  if (data.completedAt !== undefined) { updates.push('completed_at = ?'); params.push(data.completedAt); }
  if (data.totalDurationSec !== undefined) { updates.push('total_duration_sec = ?'); params.push(data.totalDurationSec); }
  if (data.path !== undefined) { updates.push('path = ?'); params.push(data.path); }
  if (updates.length === 0) return;
  params.push(id);
  getDb().prepare(`UPDATE journeys SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function getActiveJourneys(): unknown[] {
  return getDb().prepare("SELECT * FROM journeys WHERE status = 'active' ORDER BY started_at DESC").all();
}

export function getJourneysByPerson(personId: string, limit = 20): unknown[] {
  if (!personId) return [];
  return getDb()
    .prepare('SELECT * FROM journeys WHERE person_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(personId, limit);
}

// --- Presence History CRUD ---

export function createPresenceEntry(data: {
  id: string;
  personId: string;
  state: string;
  previousState?: string | null;
  triggerCameraId?: string | null;
  triggerReason?: string | null;
}): string {
  if (!data.id || !data.personId || !data.state) {
    throw new Error('Presence entry id, personId, and state are required.');
  }
  getDb()
    .prepare(
      `INSERT INTO presence_history (id, person_id, state, previous_state, trigger_camera_id, trigger_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(data.id, data.personId, data.state, data.previousState ?? null, data.triggerCameraId ?? null, data.triggerReason ?? null);
  return data.id;
}

export function getPresenceHistory(personId: string, limit = 50): unknown[] {
  if (!personId) return [];
  return getDb()
    .prepare('SELECT * FROM presence_history WHERE person_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(personId, limit);
}

export function updatePersonPresence(personId: string, state: string, cameraId: string | null): void {
  if (!personId || !state) throw new Error('personId and state are required.');
  getDb()
    .prepare(
      `UPDATE persons SET presence_state = ?, presence_updated_at = datetime('now'), last_seen_camera_id = ?, last_seen_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    )
    .run(state, cameraId, personId);
}

// --- Topology Edge CRUD ---

export function createTopologyEdge(data: {
  id: string;
  fromCameraId: string;
  toCameraId: string;
  transitMinSec: number;
  transitMaxSec: number;
  direction?: string | null;
}): string {
  if (!data.id || !data.fromCameraId || !data.toCameraId) {
    throw new Error('Topology edge id, fromCameraId, and toCameraId are required.');
  }
  getDb()
    .prepare(
      `INSERT INTO topology_edges (id, from_camera_id, to_camera_id, transit_min_sec, transit_max_sec, direction, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(data.id, data.fromCameraId, data.toCameraId, data.transitMinSec, data.transitMaxSec, data.direction ?? null);
  return data.id;
}

export function getTopologyEdges(): unknown[] {
  return getDb().prepare('SELECT * FROM topology_edges WHERE enabled = 1').all();
}

export function deleteTopologyEdge(id: string): void {
  if (!id) throw new Error('Topology edge ID is required.');
  getDb().prepare('DELETE FROM topology_edges WHERE id = ?').run(id);
}

// --- Recording Segments CRUD ---

export function createRecordingSegment(data: {
  id: string;
  cameraId: string;
  filePath: string;
  startTime: string;
  endTime: string;
  durationSec: number;
  fileSizeBytes?: number;
  format?: string;
  recordingMode?: string;
}): string {
  if (!data.id || !data.cameraId || !data.filePath || !data.startTime || !data.endTime) {
    throw new Error('Recording segment id, cameraId, filePath, startTime, and endTime are required.');
  }
  getDb()
    .prepare(
      `INSERT INTO recording_segments (id, camera_id, file_path, start_time, end_time, duration_sec, file_size_bytes, format, recording_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      data.id, data.cameraId, data.filePath, data.startTime, data.endTime,
      data.durationSec, data.fileSizeBytes ?? null, data.format ?? 'mp4',
      data.recordingMode ?? 'continuous'
    );
  return data.id;
}

export function getRecordingSegments(cameraId: string, from: string, to: string): unknown[] {
  if (!cameraId || !from || !to) return [];
  return getDb()
    .prepare(
      `SELECT * FROM recording_segments WHERE camera_id = ? AND start_time >= ? AND end_time <= ? ORDER BY start_time ASC`
    )
    .all(cameraId, from, to);
}

// --- Negative Gallery CRUD ---

export function addNegativeGalleryEntry(data: {
  id: string;
  personId: string;
  embedding: number[];
  cropThumbnail?: Buffer;
  sourceEventId?: string;
}): string {
  if (!data.id || !data.personId || !data.embedding?.length) {
    throw new Error('Negative gallery id, personId, and embedding are required.');
  }
  const { encrypted, iv } = encryptEmbedding(data.embedding);
  getDb()
    .prepare(
      `INSERT INTO negative_gallery (id, person_id, embedding_encrypted, iv, crop_thumbnail, source_event_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(data.id, data.personId, encrypted, iv, data.cropThumbnail ?? null, data.sourceEventId ?? null);
  return data.id;
}

export function getNegativeGalleryByPerson(personId: string): Array<{ id: string; personId: string; createdAt: string }> {
  if (!personId) return [];
  return getDb()
    .prepare('SELECT id, person_id, created_at FROM negative_gallery WHERE person_id = ? ORDER BY created_at DESC')
    .all(personId) as Array<{ id: string; personId: string; createdAt: string }>;
}

export function deleteNegativeGalleryEntry(id: string): void {
  if (!id) throw new Error('Negative gallery entry ID is required.');
  getDb().prepare('DELETE FROM negative_gallery WHERE id = ?').run(id);
}

export function getNegativeEmbeddingsByPerson(personId: string): Array<{ id: string; embedding: number[] }> {
  if (!personId) return [];
  const rows = getDb()
    .prepare('SELECT id, embedding_encrypted, iv FROM negative_gallery WHERE person_id = ?')
    .all(personId) as Array<{ id: string; embedding_encrypted: Buffer; iv: Buffer }>;
  const results: Array<{ id: string; embedding: number[] }> = [];
  for (const row of rows) {
    try {
      const embedding = decryptEmbedding(row.embedding_encrypted, row.iv);
      results.push({ id: row.id, embedding });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DatabaseService] Failed to decrypt negative embedding ${row.id}: ${message}`);
    }
  }
  return results;
}

// --- PTZ Presets CRUD ---

export function createPtzPreset(data: {
  id: string;
  cameraId: string;
  presetId: number;
  name: string;
  panPosition?: number;
  tiltPosition?: number;
  zoomLevel?: number;
  dwellSec?: number;
  sortOrder?: number;
}): string {
  if (!data.id || !data.cameraId || !data.name) {
    throw new Error('PTZ preset id, cameraId, and name are required.');
  }
  getDb()
    .prepare(
      `INSERT INTO ptz_presets (id, camera_id, preset_id, name, pan_position, tilt_position, zoom_level, dwell_sec, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      data.id, data.cameraId, data.presetId, data.name,
      data.panPosition ?? null, data.tiltPosition ?? null, data.zoomLevel ?? null,
      data.dwellSec ?? 10, data.sortOrder ?? 0
    );
  return data.id;
}

export function getPtzPresetsByCamera(cameraId: string): unknown[] {
  if (!cameraId) return [];
  return getDb()
    .prepare('SELECT * FROM ptz_presets WHERE camera_id = ? ORDER BY sort_order ASC')
    .all(cameraId);
}

export function deletePtzPreset(id: string): void {
  if (!id) throw new Error('PTZ preset ID is required.');
  getDb().prepare('DELETE FROM ptz_presets WHERE id = ?').run(id);
}

// --- PTZ Patrol Schedules CRUD ---

export function createPtzPatrolSchedule(data: {
  id: string;
  cameraId: string;
  name: string;
  startTime: string;
  endTime: string;
  enabled?: boolean;
}): string {
  if (!data.id || !data.cameraId || !data.name) {
    throw new Error('Patrol schedule id, cameraId, and name are required.');
  }
  getDb()
    .prepare(
      `INSERT INTO ptz_patrol_schedules (id, camera_id, name, start_time, end_time, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(data.id, data.cameraId, data.name, data.startTime, data.endTime, data.enabled !== false ? 1 : 0);
  return data.id;
}

export function getPtzPatrolSchedulesByCamera(cameraId: string): unknown[] {
  if (!cameraId) return [];
  return getDb()
    .prepare('SELECT * FROM ptz_patrol_schedules WHERE camera_id = ? ORDER BY start_time ASC')
    .all(cameraId);
}

export function deletePtzPatrolSchedule(id: string): void {
  if (!id) throw new Error('Patrol schedule ID is required.');
  getDb().prepare('DELETE FROM ptz_patrol_schedules WHERE id = ?').run(id);
}

// --- Daily Summaries CRUD ---

export function createDailySummary(data: {
  id: string;
  summaryDate: string;
  summaryText: string;
  modelUsed?: string;
  eventCount?: number;
  generatedAt: string;
}): string {
  if (!data.id || !data.summaryDate || !data.summaryText) {
    throw new Error('Daily summary id, summaryDate, and summaryText are required.');
  }
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO daily_summaries (id, summary_date, summary_text, model_used, event_count, generated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(data.id, data.summaryDate, data.summaryText, data.modelUsed ?? null, data.eventCount ?? null, data.generatedAt);
  return data.id;
}

export function getDailySummary(date: string): unknown | null {
  if (!date) return null;
  return getDb().prepare('SELECT * FROM daily_summaries WHERE summary_date = ?').get(date) ?? null;
}

export function updateDailySummaryTelegram(id: string, sent: boolean): void {
  if (!id) throw new Error('Daily summary ID is required.');
  getDb().prepare('UPDATE daily_summaries SET telegram_sent = ? WHERE id = ?').run(sent ? 1 : 0, id);
}

// --- Analytics Rollup CRUD ---

export function upsertAnalyticsRollup(data: {
  id: string;
  cameraId?: string;
  zoneId?: string;
  rollupDate: string;
  rollupHour?: number;
  detectionCount?: number;
  personCount?: number;
  knownCount?: number;
  unknownCount?: number;
  zoneEnterCount?: number;
  zoneExitCount?: number;
  loiterCount?: number;
  behaviorCount?: number;
  soundEventCount?: number;
}): string {
  if (!data.id || !data.rollupDate) {
    throw new Error('Analytics rollup id and rollupDate are required.');
  }
  getDb()
    .prepare(
      `INSERT INTO analytics_rollup (id, camera_id, zone_id, rollup_date, rollup_hour, detection_count, person_count, known_count, unknown_count, zone_enter_count, zone_exit_count, loiter_count, behavior_count, sound_event_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET detection_count = excluded.detection_count, person_count = excluded.person_count, known_count = excluded.known_count, unknown_count = excluded.unknown_count, zone_enter_count = excluded.zone_enter_count, zone_exit_count = excluded.zone_exit_count, loiter_count = excluded.loiter_count, behavior_count = excluded.behavior_count, sound_event_count = excluded.sound_event_count`
    )
    .run(
      data.id, data.cameraId ?? null, data.zoneId ?? null, data.rollupDate, data.rollupHour ?? null,
      data.detectionCount ?? 0, data.personCount ?? 0, data.knownCount ?? 0, data.unknownCount ?? 0,
      data.zoneEnterCount ?? 0, data.zoneExitCount ?? 0, data.loiterCount ?? 0,
      data.behaviorCount ?? 0, data.soundEventCount ?? 0
    );
  return data.id;
}

export function getAnalyticsRollup(cameraId: string | null, from: string, to: string): unknown[] {
  if (!from || !to) return [];
  if (cameraId) {
    return getDb()
      .prepare('SELECT * FROM analytics_rollup WHERE camera_id = ? AND rollup_date >= ? AND rollup_date <= ? ORDER BY rollup_date ASC, rollup_hour ASC')
      .all(cameraId, from, to);
  }
  return getDb()
    .prepare('SELECT * FROM analytics_rollup WHERE rollup_date >= ? AND rollup_date <= ? ORDER BY rollup_date ASC, rollup_hour ASC')
    .all(from, to);
}

// --- Floor Plan CRUD ---

export function getFloorPlan(): unknown | null {
  return getDb().prepare("SELECT * FROM floor_plan WHERE id = 'default'").get() ?? null;
}

export function upsertFloorPlan(data: {
  imagePath?: string;
  imageWidth?: number;
  imageHeight?: number;
  scaleMetersPerPixel?: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO floor_plan (id, image_path, image_width, image_height, scale_meters_per_pixel, created_at, updated_at)
       VALUES ('default', ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(id) DO UPDATE SET image_path = excluded.image_path, image_width = excluded.image_width, image_height = excluded.image_height, scale_meters_per_pixel = excluded.scale_meters_per_pixel, updated_at = datetime('now')`
    )
    .run(data.imagePath ?? null, data.imageWidth ?? null, data.imageHeight ?? null, data.scaleMetersPerPixel ?? null);
}

// --- Re-ID Gallery CRUD ---

export function createReIDGalleryEntry(data: {
  id: string;
  cameraId: string;
  trackId: number;
  bodyEmbedding: number[];
  globalPersonId?: string;
  personId?: string;
  clothingDescriptor?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt: string;
}): string {
  if (!data.id || !data.cameraId || !data.bodyEmbedding?.length) {
    throw new Error('Re-ID gallery entry id, cameraId, and bodyEmbedding are required.');
  }
  const { encrypted, iv } = encryptEmbedding(data.bodyEmbedding);
  getDb()
    .prepare(
      `INSERT INTO reid_gallery (id, camera_id, track_id, global_person_id, person_id, body_embedding_encrypted, iv, clothing_descriptor, first_seen_at, last_seen_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      data.id, data.cameraId, data.trackId, data.globalPersonId ?? null, data.personId ?? null,
      encrypted, iv, data.clothingDescriptor ?? null,
      data.firstSeenAt, data.lastSeenAt, data.expiresAt
    );
  return data.id;
}

export function getActiveReIDEntries(): Array<{ id: string; cameraId: string; trackId: number; globalPersonId: string | null; personId: string | null; embedding: number[]; lastSeenAt: string }> {
  const rows = getDb()
    .prepare("SELECT id, camera_id, track_id, global_person_id, person_id, body_embedding_encrypted, iv, last_seen_at FROM reid_gallery WHERE expires_at > datetime('now')")
    .all() as Array<{ id: string; camera_id: string; track_id: number; global_person_id: string | null; person_id: string | null; body_embedding_encrypted: Buffer; iv: Buffer; last_seen_at: string }>;
  const results: Array<{ id: string; cameraId: string; trackId: number; globalPersonId: string | null; personId: string | null; embedding: number[]; lastSeenAt: string }> = [];
  for (const row of rows) {
    try {
      const embedding = decryptEmbedding(row.body_embedding_encrypted, row.iv);
      results.push({
        id: row.id, cameraId: row.camera_id, trackId: row.track_id,
        globalPersonId: row.global_person_id, personId: row.person_id,
        embedding, lastSeenAt: row.last_seen_at,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DatabaseService] Failed to decrypt Re-ID embedding ${row.id}: ${message}`);
    }
  }
  return results;
}

export function purgeExpiredReIDEntries(): number {
  try {
    const result = getDb()
      .prepare("DELETE FROM reid_gallery WHERE expires_at <= datetime('now')")
      .run();
    return result.changes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] purgeExpiredReIDEntries failed: ${message}`);
    return 0;
  }
}

// --- Gait Profile CRUD ---

export function createGaitProfile(data: {
  personId: string;
  gaitEmbedding: number[];
  sourceCameraId?: string;
  qualityScore?: number;
}): string {
  if (!data.personId || !data.gaitEmbedding?.length) {
    throw new Error('Gait profile personId and gaitEmbedding are required.');
  }
  const { encrypted, iv } = encryptEmbedding(data.gaitEmbedding);
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO gait_profiles (id, person_id, gait_embedding_encrypted, iv, source_camera_id, quality_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(id, data.personId, encrypted, iv, data.sourceCameraId ?? null, data.qualityScore ?? null);
  return id;
}

// --- Expired Auto-Enrollment Purge ---

export function purgeExpiredAutoEnrollments(): number {
  try {
    const result = getDb()
      .prepare("DELETE FROM face_embeddings WHERE is_auto_enrolled = 1 AND auto_enroll_expires_at IS NOT NULL AND auto_enroll_expires_at <= datetime('now')")
      .run();
    if (result.changes > 0) {
      console.log(`[DatabaseService] Purged ${result.changes} expired auto-enrolled embeddings.`);
    }
    return result.changes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DatabaseService] purgeExpiredAutoEnrollments failed: ${message}`);
    return 0;
  }
}
