// src/database/schema.js
export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Guild timezone setting
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id  TEXT PRIMARY KEY,
  timezone  TEXT DEFAULT 'Asia/Kolkata',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- /dailyreport add — reminder configs
CREATE TABLE IF NOT EXISTS reminder_configs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  user_id       TEXT,                        -- specific user to ping (null = no specific ping)
  message       TEXT,                        -- custom reminder message
  send_time     TEXT NOT NULL,               -- HH:MM (24h, in guild timezone)
  interval_type TEXT DEFAULT 'daily',        -- daily | weekly | monthly
  last_fired    TEXT,                        -- YYYY-MM-DD last fired date
  is_active     INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- /dailyreport summarise — summary channel configs
CREATE TABLE IF NOT EXISTS summary_configs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  send_time     TEXT NOT NULL,               -- HH:MM (24h, in guild timezone)
  ping_content  TEXT,                        -- @role or @user mention string
  last_fired    TEXT,                        -- YYYY-MM-DD
  is_active     INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User submitted reports
CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  discord_id    TEXT NOT NULL,
  username      TEXT NOT NULL,
  display_name  TEXT,
  daily_report  TEXT NOT NULL,
  todo_list     TEXT NOT NULL,
  report_date   TEXT NOT NULL,               -- YYYY-MM-DD
  submitted_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  summary_sent  INTEGER DEFAULT 0            -- 0=pending, 1=sent to summary channel
);

CREATE INDEX IF NOT EXISTS idx_reports_guild_date ON reports(guild_id, report_date);
CREATE INDEX IF NOT EXISTS idx_reports_pending ON reports(guild_id, summary_sent);
`;
