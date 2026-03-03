-- Tapo CCTV Desktop — SQLite Schema
-- Version: 1.0
-- Based on PRD Section 5.1

-- Camera configuration
CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    model TEXT,
    type TEXT,
    rtsp_url TEXT,
    has_ptz INTEGER DEFAULT 0,
    line_crossing_config TEXT,
    heuristic_direction TEXT,
    motion_sensitivity INTEGER DEFAULT 50,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Known persons
CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    label TEXT,
    enabled INTEGER DEFAULT 1,
    telegram_notify TEXT DEFAULT 'silent_log',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Face embeddings (encrypted at rest)
CREATE TABLE IF NOT EXISTS face_embeddings (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    embedding_encrypted BLOB NOT NULL,
    iv BLOB NOT NULL,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Detection / entry-exit events
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id),
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    person_name TEXT,
    is_known INTEGER NOT NULL DEFAULT 0,
    direction TEXT,
    detection_method TEXT,
    confidence REAL,
    bbox TEXT,
    snapshot_path TEXT,
    clip_path TEXT,
    telegram_sent INTEGER DEFAULT 0,
    telegram_sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Application settings (key-value store)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_events_camera_id ON events(camera_id);
CREATE INDEX IF NOT EXISTS idx_events_person_id ON events(person_id);
CREATE INDEX IF NOT EXISTS idx_events_is_known ON events(is_known);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_direction ON events(direction);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_person_id ON face_embeddings(person_id);

-- Composite index for common filtered+sorted query pattern
CREATE INDEX IF NOT EXISTS idx_events_camera_created ON events(camera_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_known_created ON events(is_known, created_at DESC);
