// src/database/db.js
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA } from './schema.js';

let db;

export function initDb() {
  const dbPath = process.env.DB_PATH || './data/reports.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  console.log(`[DB] Initialized at ${dbPath}`);
  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

// ── Guild Settings ────────────────────────────────────────────
export const GuildSettings = {
  getTimezone(guildId) {
    const row = getDb().prepare('SELECT timezone FROM guild_settings WHERE guild_id = ?').get(guildId);
    return row?.timezone || process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata';
  },
  setTimezone(guildId, timezone) {
    getDb().prepare(`
      INSERT INTO guild_settings(guild_id, timezone) VALUES(?,?)
      ON CONFLICT(guild_id) DO UPDATE SET timezone=excluded.timezone, updated_at=CURRENT_TIMESTAMP
    `).run(guildId, timezone);
  }
};

// ── Reminder Configs ──────────────────────────────────────────
export const ReminderConfigs = {
  add(guildId, channelId, userId, message, sendTime, intervalType) {
    const existing = getDb().prepare('SELECT id FROM reminder_configs WHERE guild_id = ? AND channel_id = ? AND send_time = ? AND is_active = 1').get(guildId, channelId, sendTime);
    if (existing) return { lastInsertRowid: existing.id, isDuplicate: true };

    const r = getDb().prepare(`
      INSERT INTO reminder_configs(guild_id, channel_id, user_id, message, send_time, interval_type)
      VALUES(?,?,?,?,?,?)
    `).run(guildId, channelId, userId || null, message || null, sendTime, intervalType || 'daily');
    return { lastInsertRowid: r.lastInsertRowid, isDuplicate: false };
  },
  getAll(guildId) {
    return getDb().prepare('SELECT * FROM reminder_configs WHERE guild_id = ? AND is_active = 1 ORDER BY id').all(guildId);
  },
  getById(id, guildId) {
    return getDb().prepare('SELECT * FROM reminder_configs WHERE id = ? AND guild_id = ?').get(id, guildId);
  },
  remove(id, guildId) {
    return getDb().prepare('DELETE FROM reminder_configs WHERE id = ? AND guild_id = ?').run(id, guildId);
  },
  removeAll(guildId) {
    return getDb().prepare('DELETE FROM reminder_configs WHERE guild_id = ?').run(guildId);
  },
  setLastFired(id, date) {
    return getDb().prepare('UPDATE reminder_configs SET last_fired = ? WHERE id = ?').run(date, id);
  },
  getAllActive() {
    return getDb().prepare('SELECT * FROM reminder_configs WHERE is_active = 1').all();
  }
};

// ── Summary Configs ───────────────────────────────────────────
export const SummaryConfigs = {
  add(guildId, channelId, sendTime, pingContent) {
    const existing = getDb().prepare('SELECT id FROM summary_configs WHERE guild_id = ? AND channel_id = ? AND send_time = ? AND is_active = 1').get(guildId, channelId, sendTime);
    if (existing) return { lastInsertRowid: existing.id, isDuplicate: true };

    const r = getDb().prepare(`
      INSERT INTO summary_configs(guild_id, channel_id, send_time, ping_content)
      VALUES(?,?,?,?)
    `).run(guildId, channelId, sendTime, pingContent || null);
    return { lastInsertRowid: r.lastInsertRowid, isDuplicate: false };
  },
  getAll(guildId) {
    return getDb().prepare('SELECT * FROM summary_configs WHERE guild_id = ? AND is_active = 1 ORDER BY id').all(guildId);
  },
  getById(id, guildId) {
    return getDb().prepare('SELECT * FROM summary_configs WHERE id = ? AND guild_id = ?').get(id, guildId);
  },
  remove(id, guildId) {
    return getDb().prepare('DELETE FROM summary_configs WHERE id = ? AND guild_id = ?').run(id, guildId);
  },
  removeAll(guildId) {
    return getDb().prepare('DELETE FROM summary_configs WHERE guild_id = ?').run(guildId);
  },
  setLastFired(id, date) {
    return getDb().prepare('UPDATE summary_configs SET last_fired = ? WHERE id = ?').run(date, id);
  },
  getAllActive() {
    return getDb().prepare('SELECT * FROM summary_configs WHERE is_active = 1').all();
  }
};

// ── Reports ───────────────────────────────────────────────────
export const Reports = {
  create(guildId, discordId, username, displayName, dailyReport, todoList, reportDate) {
    return getDb().prepare(`
      INSERT INTO reports(guild_id, discord_id, username, display_name, daily_report, todo_list, report_date)
      VALUES(?,?,?,?,?,?,?)
    `).run(guildId, discordId, username, displayName || username, dailyReport, todoList, reportDate);
  },
  getToday(guildId, date) {
    return getDb().prepare(`
      SELECT * FROM reports WHERE guild_id = ? AND report_date = ? ORDER BY submitted_at ASC
    `).all(guildId, date);
  },
  getTodayLatestPerUser(guildId, date) {
    return getDb().prepare(`
      SELECT * FROM reports WHERE guild_id = ? AND report_date = ?
      GROUP BY discord_id HAVING MAX(submitted_at)
      ORDER BY submitted_at ASC
    `).all(guildId, date);
  },
  getPending(guildId) {
    return getDb().prepare(`
      SELECT * FROM reports WHERE guild_id = ? AND summary_sent = 0 ORDER BY submitted_at ASC
    `).all(guildId);
  },
  markSent(ids) {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    getDb().prepare(`UPDATE reports SET summary_sent = 1 WHERE id IN (${placeholders})`).run(...ids);
  },
  remove(id, guildId) {
    return getDb().prepare('DELETE FROM reports WHERE id = ? AND guild_id = ?').run(id, guildId);
  }
};
