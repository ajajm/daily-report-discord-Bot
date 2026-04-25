// src/database/schema.js
// Complete database schema — SQLite with PostgreSQL-compatible design

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- SETTINGS: Server-wide dynamic configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, key)
);

-- ============================================================
-- DEPARTMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT DEFAULT '#5865F2',
  icon        TEXT DEFAULT '🏢',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, name)
);

-- ============================================================
-- USERS: Tracked team members
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  discord_id      TEXT NOT NULL,
  username        TEXT NOT NULL,
  display_name    TEXT,
  department_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  report_channel  TEXT,
  is_active       INTEGER DEFAULT 1,
  is_exempt       INTEGER DEFAULT 0,
  joined_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, discord_id)
);

-- ============================================================
-- REPORT FORMAT: Dynamic customizable fields per guild
-- ============================================================
CREATE TABLE IF NOT EXISTS report_fields (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  field_key     TEXT NOT NULL,
  label         TEXT NOT NULL,
  placeholder   TEXT,
  field_type    TEXT DEFAULT 'paragraph',  -- short, paragraph, number, score
  is_required   INTEGER DEFAULT 1,
  max_length    INTEGER DEFAULT 1000,
  sort_order    INTEGER DEFAULT 0,
  is_active     INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, field_key, department_id)
);

-- ============================================================
-- REPORTS: Daily submissions
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discord_id    TEXT NOT NULL,
  report_date   TEXT NOT NULL,            -- YYYY-MM-DD
  submitted_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  deadline      TEXT NOT NULL,            -- HH:MM
  is_late       INTEGER DEFAULT 0,
  is_edited     INTEGER DEFAULT 0,
  edit_count    INTEGER DEFAULT 0,
  quality_score INTEGER,                  -- auto-scored 1-10
  manager_score INTEGER,                  -- manually set by manager
  word_count    INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'submitted', -- submitted, flagged, praised, reviewed
  department_id INTEGER REFERENCES departments(id),
  summary_posted INTEGER DEFAULT 0,
  UNIQUE(guild_id, discord_id, report_date)
);

-- ============================================================
-- REPORT CONTENT: Field-by-field storage
-- ============================================================
CREATE TABLE IF NOT EXISTS report_content (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  field_key   TEXT NOT NULL,
  field_label TEXT NOT NULL,
  value       TEXT,
  UNIQUE(report_id, field_key)
);

-- ============================================================
-- REMINDERS: Full-featured scheduler (one-time + recurring)
-- ============================================================
CREATE TABLE IF NOT EXISTS reminders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  channel_id      TEXT,                    -- target channel (null = user's assigned ch)
  user_id         TEXT,                    -- specific user to ping (null = all pending)
  ping_content    TEXT,                    -- @here / @role / @user mention string
  -- Schedule
  fire_at         DATETIME,               -- next fire time (ISO8601 UTC)
  interval_secs   INTEGER,                -- repeat every N seconds (null = one-time)
  skip_days       TEXT DEFAULT '[]',      -- JSON array of day names to skip e.g ["saturday","sunday"]
  expires_at      DATETIME,               -- stop recurring after this datetime
  -- Type / behaviour
  type            TEXT DEFAULT 'standard', -- standard, escalation, dm, report
  is_paused       INTEGER DEFAULT 0,
  is_active       INTEGER DEFAULT 1,
  delete_previous INTEGER DEFAULT 0,      -- delete last message before sending new one
  last_message_id TEXT,                   -- for delete_previous feature
  -- Rich embed customisation
  title           TEXT,
  reason          TEXT,                   -- reminder message / body
  color           TEXT,                   -- hex e.g #5865F2
  image_url       TEXT,
  thumbnail_url   TEXT,
  footer_text     TEXT,
  show_timestamp  INTEGER DEFAULT 1,
  -- Legacy / simple scheduling
  reminder_time   TEXT,                   -- HH:MM (for report-deadline reminders)
  message         TEXT,                   -- JSON meta for report reminders
  department_id   INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  created_by      TEXT,                   -- discord_id of creator
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- STAFF ROLES: Non-admin roles that can manage reminders
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  role_name   TEXT,
  added_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, role_id)
);


-- ============================================================
-- SUMMARY CHANNELS: Where bot posts digests
-- ============================================================
CREATE TABLE IF NOT EXISTS summary_channels (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  channel_name    TEXT,
  department_id   INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  type            TEXT DEFAULT 'daily',   -- daily, weekly, monthly, alerts
  is_active       INTEGER DEFAULT 1,
  UNIQUE(guild_id, channel_id)
);

-- ============================================================
-- STREAKS: Per-user streak tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS streaks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  discord_id      TEXT NOT NULL,
  current_streak  INTEGER DEFAULT 0,
  longest_streak  INTEGER DEFAULT 0,
  last_submit_date TEXT,
  UNIQUE(guild_id, discord_id)
);

-- ============================================================
-- MANAGER FEEDBACK: Reviews, scores, praise, flags
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  target_id       TEXT NOT NULL,          -- target user discord_id
  manager_id      TEXT NOT NULL,          -- manager discord_id
  type            TEXT NOT NULL,          -- feedback, score, praise, flag
  content         TEXT,
  score           INTEGER,
  report_id       INTEGER REFERENCES reports(id),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- MISSED REPORTS: For escalation tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS missed_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  discord_id      TEXT NOT NULL,
  miss_date       TEXT NOT NULL,          -- YYYY-MM-DD
  notified        INTEGER DEFAULT 0,      -- manager notified?
  escalated       INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, discord_id, miss_date)
);

-- ============================================================
-- SMART REMINDER STATE: Per-user adaptive behavior
-- ============================================================
CREATE TABLE IF NOT EXISTS smart_reminder_state (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id            TEXT NOT NULL,
  discord_id          TEXT NOT NULL,
  avg_submit_hour     REAL,               -- typical submission hour
  late_count_30d      INTEGER DEFAULT 0,
  consecutive_low_confidence INTEGER DEFAULT 0,
  early_reminder_sent  INTEGER DEFAULT 0,  -- reset daily
  last_updated        DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, discord_id)
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_reports_guild_date ON reports(guild_id, report_date);
CREATE INDEX IF NOT EXISTS idx_reports_discord_date ON reports(discord_id, report_date);
CREATE INDEX IF NOT EXISTS idx_users_guild ON users(guild_id);
CREATE INDEX IF NOT EXISTS idx_missed_guild_discord ON missed_reports(guild_id, discord_id);
CREATE INDEX IF NOT EXISTS idx_feedback_target ON feedback(guild_id, target_id);
CREATE INDEX IF NOT EXISTS idx_streaks_guild ON streaks(guild_id);
`;

export const DEFAULT_REPORT_FIELDS = [
  {
    field_key:  'daily_report',
    label:      'Daily Report',
    placeholder: '1. \n2. \n3. ',
    field_type: 'paragraph',
    is_required: 1,
    max_length:  1000,
    sort_order:  1,
  },
  {
    field_key:  'todo_tomorrow',
    label:      'To-Do List (Tomorrow)',
    placeholder: '1. \n2. \n3. ',
    field_type: 'paragraph',
    is_required: 1,
    max_length:  1000,
    sort_order:  2,
  },
  {
    field_key:  'meeting_todo',
    label:      'Meeting To-Do (if meeting day)',
    placeholder: '1. \n2. \n3. ',
    field_type: 'paragraph',
    is_required: 0,
    max_length:  1000,
    sort_order:  3,
  },
];
