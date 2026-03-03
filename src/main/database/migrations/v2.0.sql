-- =============================================================
-- Tapo CCTV Desktop — Schema Migration v2.0
-- Presidential-Level Upgrade
-- Based on PRD Section 5.1
-- =============================================================

-- -------------------------------------------------------
-- 1. ALTER EXISTING TABLES — Add new columns
-- -------------------------------------------------------

-- cameras: dual-stream, PTZ type, camera groups, floor plan placement
ALTER TABLE cameras ADD COLUMN rtsp_main_url TEXT;
ALTER TABLE cameras ADD COLUMN rtsp_sub_url TEXT;
ALTER TABLE cameras ADD COLUMN ptz_type TEXT;
ALTER TABLE cameras ADD COLUMN camera_group_id TEXT;
ALTER TABLE cameras ADD COLUMN floor_x REAL;
ALTER TABLE cameras ADD COLUMN floor_y REAL;
ALTER TABLE cameras ADD COLUMN floor_fov_deg REAL;
ALTER TABLE cameras ADD COLUMN floor_rotation_deg REAL;
ALTER TABLE cameras ADD COLUMN stream_protocol TEXT DEFAULT 'rtsp';
ALTER TABLE cameras ADD COLUMN stream_username TEXT;
ALTER TABLE cameras ADD COLUMN stream_password TEXT;
ALTER TABLE cameras ADD COLUMN recording_mode TEXT DEFAULT 'off';

-- Migrate legacy rtsp_url → rtsp_main_url for existing rows
UPDATE cameras SET rtsp_main_url = rtsp_url WHERE rtsp_main_url IS NULL AND rtsp_url IS NOT NULL;

-- persons: presence state, adaptive threshold, auto-enrollment
ALTER TABLE persons ADD COLUMN presence_state TEXT DEFAULT 'UNKNOWN';
ALTER TABLE persons ADD COLUMN presence_updated_at TEXT;
ALTER TABLE persons ADD COLUMN last_seen_camera_id TEXT;
ALTER TABLE persons ADD COLUMN last_seen_at TEXT;
ALTER TABLE persons ADD COLUMN adaptive_threshold REAL;
ALTER TABLE persons ADD COLUMN auto_enroll_enabled INTEGER DEFAULT 1;
ALTER TABLE persons ADD COLUMN auto_enroll_count INTEGER DEFAULT 0;
ALTER TABLE persons ADD COLUMN global_person_id TEXT;

-- face_embeddings: quality score, auto-enrollment metadata
ALTER TABLE face_embeddings ADD COLUMN quality_score REAL;
ALTER TABLE face_embeddings ADD COLUMN is_auto_enrolled INTEGER DEFAULT 0;
ALTER TABLE face_embeddings ADD COLUMN auto_enroll_expires_at TEXT;

-- events: expanded event types, tracking, zones, journeys, behavior, sound, liveness, identity
ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'detection';
ALTER TABLE events ADD COLUMN track_id INTEGER;
ALTER TABLE events ADD COLUMN global_person_id TEXT;
ALTER TABLE events ADD COLUMN zone_id TEXT;
ALTER TABLE events ADD COLUMN journey_id TEXT;
ALTER TABLE events ADD COLUMN behavior_type TEXT;
ALTER TABLE events ADD COLUMN behavior_details TEXT;
ALTER TABLE events ADD COLUMN sound_event_type TEXT;
ALTER TABLE events ADD COLUMN sound_confidence REAL;
ALTER TABLE events ADD COLUMN liveness_score REAL;
ALTER TABLE events ADD COLUMN is_live INTEGER;
ALTER TABLE events ADD COLUMN identity_method TEXT;
ALTER TABLE events ADD COLUMN identity_fusion_score REAL;

-- -------------------------------------------------------
-- 2. NEW TABLES
-- -------------------------------------------------------

-- Zone definitions (polygon zones + tripwires per camera)
CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    zone_type TEXT NOT NULL,
    geometry TEXT NOT NULL,
    color TEXT DEFAULT '#FF0000',
    alert_enabled INTEGER DEFAULT 1,
    loiter_threshold_sec INTEGER DEFAULT 15,
    loiter_cooldown_sec INTEGER DEFAULT 180,
    loiter_movement_radius REAL DEFAULT 80.0,
    enter_count INTEGER DEFAULT 0,
    exit_count INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Negative gallery (false positive face crops)
CREATE TABLE IF NOT EXISTS negative_gallery (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    embedding_encrypted BLOB NOT NULL,
    iv BLOB NOT NULL,
    crop_thumbnail BLOB,
    source_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Cross-camera journeys
CREATE TABLE IF NOT EXISTS journeys (
    id TEXT PRIMARY KEY,
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    person_name TEXT,
    global_person_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    total_duration_sec REAL,
    path TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Presence state history (for analytics timeline)
CREATE TABLE IF NOT EXISTS presence_history (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    previous_state TEXT,
    trigger_camera_id TEXT REFERENCES cameras(id),
    trigger_reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Camera topology edges
CREATE TABLE IF NOT EXISTS topology_edges (
    id TEXT PRIMARY KEY,
    from_camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    to_camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    transit_min_sec INTEGER NOT NULL,
    transit_max_sec INTEGER NOT NULL,
    direction TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Recording segments
CREATE TABLE IF NOT EXISTS recording_segments (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_sec REAL NOT NULL,
    file_size_bytes INTEGER,
    format TEXT DEFAULT 'mp4',
    recording_mode TEXT DEFAULT 'continuous',
    created_at TEXT DEFAULT (datetime('now'))
);

-- Body Re-ID gallery (short-term: last 5 min per track)
CREATE TABLE IF NOT EXISTS reid_gallery (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    global_person_id TEXT,
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    body_embedding_encrypted BLOB NOT NULL,
    iv BLOB NOT NULL,
    clothing_descriptor TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Gait profiles (persistent per person)
CREATE TABLE IF NOT EXISTS gait_profiles (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    gait_embedding_encrypted BLOB NOT NULL,
    iv BLOB NOT NULL,
    source_camera_id TEXT,
    quality_score REAL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- PTZ presets
CREATE TABLE IF NOT EXISTS ptz_presets (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    preset_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    pan_position REAL,
    tilt_position REAL,
    zoom_level REAL,
    dwell_sec INTEGER DEFAULT 10,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(camera_id, preset_id)
);

-- PTZ patrol schedules
CREATE TABLE IF NOT EXISTS ptz_patrol_schedules (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Daily LLM summaries (cached)
CREATE TABLE IF NOT EXISTS daily_summaries (
    id TEXT PRIMARY KEY,
    summary_date TEXT NOT NULL UNIQUE,
    summary_text TEXT NOT NULL,
    model_used TEXT,
    event_count INTEGER,
    generated_at TEXT NOT NULL,
    telegram_sent INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Analytics rollup (pre-aggregated data for dashboard)
CREATE TABLE IF NOT EXISTS analytics_rollup (
    id TEXT PRIMARY KEY,
    camera_id TEXT REFERENCES cameras(id) ON DELETE CASCADE,
    zone_id TEXT REFERENCES zones(id) ON DELETE CASCADE,
    rollup_date TEXT NOT NULL,
    rollup_hour INTEGER,
    detection_count INTEGER DEFAULT 0,
    person_count INTEGER DEFAULT 0,
    known_count INTEGER DEFAULT 0,
    unknown_count INTEGER DEFAULT 0,
    zone_enter_count INTEGER DEFAULT 0,
    zone_exit_count INTEGER DEFAULT 0,
    loiter_count INTEGER DEFAULT 0,
    behavior_count INTEGER DEFAULT 0,
    sound_event_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Floor plan configuration
CREATE TABLE IF NOT EXISTS floor_plan (
    id TEXT PRIMARY KEY DEFAULT 'default',
    image_path TEXT,
    image_width INTEGER,
    image_height INTEGER,
    scale_meters_per_pixel REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- -------------------------------------------------------
-- 3. NEW INDEXES
-- -------------------------------------------------------

-- Zones
CREATE INDEX IF NOT EXISTS idx_zones_camera_id ON zones(camera_id);

-- Journeys
CREATE INDEX IF NOT EXISTS idx_journeys_person_id ON journeys(person_id);
CREATE INDEX IF NOT EXISTS idx_journeys_status ON journeys(status);
CREATE INDEX IF NOT EXISTS idx_journeys_started_at ON journeys(started_at);

-- Presence history
CREATE INDEX IF NOT EXISTS idx_presence_history_person_id ON presence_history(person_id);
CREATE INDEX IF NOT EXISTS idx_presence_history_created_at ON presence_history(created_at);

-- Recording segments
CREATE INDEX IF NOT EXISTS idx_recording_segments_camera_id ON recording_segments(camera_id);
CREATE INDEX IF NOT EXISTS idx_recording_segments_start_time ON recording_segments(start_time);

-- Re-ID gallery
CREATE INDEX IF NOT EXISTS idx_reid_gallery_global_person_id ON reid_gallery(global_person_id);
CREATE INDEX IF NOT EXISTS idx_reid_gallery_expires_at ON reid_gallery(expires_at);

-- Events (new indexes for v2.0 columns)
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_track_id ON events(track_id);
CREATE INDEX IF NOT EXISTS idx_events_global_person_id ON events(global_person_id);
CREATE INDEX IF NOT EXISTS idx_events_journey_id ON events(journey_id);
CREATE INDEX IF NOT EXISTS idx_events_zone_id ON events(zone_id);

-- Analytics rollup
CREATE INDEX IF NOT EXISTS idx_analytics_rollup_date ON analytics_rollup(rollup_date);
CREATE INDEX IF NOT EXISTS idx_analytics_rollup_camera ON analytics_rollup(camera_id, rollup_date);

-- Negative gallery
CREATE INDEX IF NOT EXISTS idx_negative_gallery_person_id ON negative_gallery(person_id);

-- PTZ presets
CREATE INDEX IF NOT EXISTS idx_ptz_presets_camera_id ON ptz_presets(camera_id);

-- Daily summaries
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(summary_date);

-- -------------------------------------------------------
-- 4. RECORD SCHEMA VERSION
-- -------------------------------------------------------
INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('schema_version', '2.0', datetime('now'));
