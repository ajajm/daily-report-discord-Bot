// src/database/db.js
// Database manager — SQLite with WAL mode, full ORM-style helpers

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA, DEFAULT_REPORT_FIELDS } from './schema.js';
import { logger } from '../utils/logger.js';

let db;

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function initDb() {
  const dbPath = process.env.DB_PATH || './data/reports.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  db.exec(SCHEMA);

  logger.info(`✅ Database initialized at ${dbPath}`);
  return db;
}

// ============================================================
// SETTINGS
// ============================================================
export const Settings = {
  get(guildId, key, defaultValue = null) {
    const row = getDb().prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch { return row.value; }
  },
  set(guildId, key, value) {
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    getDb().prepare(`
      INSERT INTO settings(guild_id, key, value, updated_at)
      VALUES(?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id, key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
    `).run(guildId, key, v);
  },
  getAll(guildId) {
    const rows = getDb().prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildId);
    return Object.fromEntries(rows.map(r => {
      try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, r.value]; }
    }));
  }
};

// ============================================================
// USERS
// ============================================================
export const Users = {
  upsert(guildId, discordId, username, displayName, reportChannel = null, deptId = null) {
    return getDb().prepare(`
      INSERT INTO users(guild_id, discord_id, username, display_name, report_channel, department_id)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, discord_id) DO UPDATE SET
        username=excluded.username,
        display_name=excluded.display_name,
        report_channel=COALESCE(excluded.report_channel, report_channel),
        department_id=COALESCE(excluded.department_id, department_id)
    `).run(guildId, discordId, username, displayName, reportChannel, deptId);
  },
  get(guildId, discordId) {
    return getDb().prepare('SELECT * FROM users WHERE guild_id = ? AND discord_id = ?').get(guildId, discordId);
  },
  getAll(guildId, activeOnly = true) {
    const q = activeOnly
      ? 'SELECT u.*, d.name as dept_name FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.guild_id = ? AND u.is_active = 1'
      : 'SELECT u.*, d.name as dept_name FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.guild_id = ?';
    return getDb().prepare(q).all(guildId);
  },
  setChannel(guildId, discordId, channelId) {
    return getDb().prepare('UPDATE users SET report_channel = ? WHERE guild_id = ? AND discord_id = ?').run(channelId, guildId, discordId);
  },
  removeChannel(guildId, discordId) {
    return getDb().prepare('UPDATE users SET report_channel = NULL WHERE guild_id = ? AND discord_id = ?').run(guildId, discordId);
  },
  setActive(guildId, discordId, active) {
    return getDb().prepare('UPDATE users SET is_active = ? WHERE guild_id = ? AND discord_id = ?').run(active ? 1 : 0, guildId, discordId);
  },
  setDepartment(guildId, discordId, deptId) {
    return getDb().prepare('UPDATE users SET department_id = ? WHERE guild_id = ? AND discord_id = ?').run(deptId, guildId, discordId);
  },
  getByChannel(guildId, channelId) {
    return getDb().prepare('SELECT * FROM users WHERE guild_id = ? AND report_channel = ? AND is_active = 1').get(guildId, channelId);
  }
};

// ============================================================
// DEPARTMENTS
// ============================================================
export const Departments = {
  create(guildId, name, description = '', color = '#5865F2', icon = '🏢') {
    return getDb().prepare(`
      INSERT INTO departments(guild_id, name, description, color, icon)
      VALUES(?, ?, ?, ?, ?)
    `).run(guildId, name, description, color, icon);
  },
  get(guildId, name) {
    return getDb().prepare('SELECT * FROM departments WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, name);
  },
  getById(id) {
    return getDb().prepare('SELECT * FROM departments WHERE id = ?').get(id);
  },
  getAll(guildId) {
    return getDb().prepare('SELECT * FROM departments WHERE guild_id = ? ORDER BY name').all(guildId);
  },
  delete(guildId, name) {
    return getDb().prepare('DELETE FROM departments WHERE guild_id = ? AND name = ? COLLATE NOCASE').run(guildId, name);
  }
};

// ============================================================
// REPORT FIELDS
// ============================================================
export const ReportFields = {
  getForGuild(guildId, deptId = null) {
    if (deptId) {
      return getDb().prepare(`
        SELECT * FROM report_fields WHERE guild_id = ? AND department_id = ? AND is_active = 1 ORDER BY sort_order
      `).all(guildId, deptId);
    }
    // Get global fields (no department) or guild-level
    const fields = getDb().prepare(`
      SELECT * FROM report_fields WHERE guild_id = ? AND department_id IS NULL AND is_active = 1 ORDER BY sort_order
    `).all(guildId);
    return fields;
  },
  initDefaults(guildId) {
    const existing = getDb().prepare('SELECT id FROM report_fields WHERE guild_id = ? AND department_id IS NULL').all(guildId);
    if (existing.length > 0) return;
    const insert = getDb().prepare(`
      INSERT INTO report_fields(guild_id, field_key, label, placeholder, field_type, is_required, max_length, sort_order)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = getDb().transaction((fields) => {
      for (const f of fields) insert.run(guildId, f.field_key, f.label, f.placeholder, f.field_type, f.is_required, f.max_length, f.sort_order);
    });
    insertMany(DEFAULT_REPORT_FIELDS);
  },
  addField(guildId, deptId, fieldKey, label, placeholder, type, required, maxLen, order) {
    return getDb().prepare(`
      INSERT INTO report_fields(guild_id, department_id, field_key, label, placeholder, field_type, is_required, max_length, sort_order)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, deptId, fieldKey, label, placeholder, type, required ? 1 : 0, maxLen, order);
  },
  removeField(guildId, fieldKey) {
    return getDb().prepare('UPDATE report_fields SET is_active = 0 WHERE guild_id = ? AND field_key = ?').run(guildId, fieldKey);
  },
  resetToDefaults(guildId) {
    getDb().prepare('DELETE FROM report_fields WHERE guild_id = ? AND department_id IS NULL').run(guildId);
    this.initDefaults(guildId);
  }
};

// ============================================================
// REPORTS
// ============================================================
export const Reports = {
  getToday(guildId, discordId, date) {
    return getDb().prepare('SELECT * FROM reports WHERE guild_id = ? AND discord_id = ? AND report_date = ?').get(guildId, discordId, date);
  },
  create(guildId, userId, discordId, date, deadline, isLate, deptId = null) {
    return getDb().prepare(`
      INSERT INTO reports(guild_id, user_id, discord_id, report_date, deadline, is_late, department_id)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, userId, discordId, date, deadline, isLate ? 1 : 0, deptId);
  },
  saveContent(reportId, fieldKey, fieldLabel, value) {
    return getDb().prepare(`
      INSERT INTO report_content(report_id, field_key, field_label, value)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(report_id, field_key) DO UPDATE SET value=excluded.value
    `).run(reportId, fieldKey, fieldLabel, value);
  },
  getContent(reportId) {
    return getDb().prepare('SELECT * FROM report_content WHERE report_id = ? ORDER BY rowid').all(reportId);
  },
  getWithContent(reportId) {
    const report = getDb().prepare('SELECT r.*, u.display_name, u.username FROM reports r JOIN users u ON r.user_id = u.id WHERE r.id = ?').get(reportId);
    if (!report) return null;
    report.content = this.getContent(reportId);
    return report;
  },
  getTodayAll(guildId, date) {
    return getDb().prepare(`
      SELECT r.*, u.display_name, u.username, u.report_channel, d.name as dept_name
      FROM reports r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN departments d ON r.department_id = d.id
      WHERE r.guild_id = ? AND r.report_date = ?
      ORDER BY r.submitted_at
    `).all(guildId, date);
  },
  getUserStats(guildId, discordId) {
    return getDb().prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_late = 0 THEN 1 ELSE 0 END) as on_time,
        SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as late,
        AVG(CASE WHEN quality_score IS NOT NULL THEN quality_score END) as avg_quality,
        AVG(CASE WHEN manager_score IS NOT NULL THEN manager_score END) as avg_manager_score
      FROM reports WHERE guild_id = ? AND discord_id = ?
    `).get(guildId, discordId);
  },
  getRange(guildId, fromDate, toDate) {
    return getDb().prepare(`
      SELECT r.*, u.display_name, u.username
      FROM reports r JOIN users u ON r.user_id = u.id
      WHERE r.guild_id = ? AND r.report_date >= ? AND r.report_date <= ?
      ORDER BY r.report_date DESC, r.submitted_at
    `).all(guildId, fromDate, toDate);
  },
  setScore(guildId, discordId, date, score) {
    return getDb().prepare('UPDATE reports SET manager_score = ? WHERE guild_id = ? AND discord_id = ? AND report_date = ?').run(score, guildId, discordId, date);
  },
  setQualityScore(reportId, score, wordCount) {
    return getDb().prepare('UPDATE reports SET quality_score = ?, word_count = ? WHERE id = ?').run(score, wordCount, reportId);
  },
  setSummaryPosted(reportId) {
    return getDb().prepare('UPDATE reports SET summary_posted = 1 WHERE id = ?').run(reportId);
  },
  setStatus(reportId, status) {
    return getDb().prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, reportId);
  }
};

// ============================================================
// REMINDERS
// ============================================================
export const Reminders = {
  // ── Full-featured create ──────────────────────────────────
  create(data) {
    const cols = Object.keys(data);
    const vals = cols.map(() => '?').join(', ');
    return getDb().prepare(`INSERT INTO reminders(${cols.join(', ')}) VALUES(${vals})`).run(...Object.values(data));
  },

  // ── Legacy simple add (for report schedulers) ─────────────
  add(guildId, time, message = null, type = 'standard', deptId = null) {
    return getDb().prepare(`
      INSERT INTO reminders(guild_id, reminder_time, message, type, department_id, is_active)
      VALUES(?, ?, ?, ?, ?, 1)
    `).run(guildId, time, message, type, deptId);
  },

  getAll(guildId) {
    return getDb().prepare(`
      SELECT * FROM reminders WHERE guild_id = ? AND is_active = 1
      ORDER BY COALESCE(fire_at, reminder_time)
    `).all(guildId);
  },

  getById(id, guildId) {
    return getDb().prepare('SELECT * FROM reminders WHERE id = ? AND guild_id = ?').get(id, guildId);
  },

  // Get report-style reminders (HH:MM scheduled, for scheduler.js)
  getReportReminders(guildId) {
    return getDb().prepare(`
      SELECT * FROM reminders WHERE guild_id = ? AND reminder_time IS NOT NULL AND is_active = 1 AND is_paused = 0
    `).all(guildId);
  },

  // Get fire_at-based reminders due now
  getDue() {
    return getDb().prepare(`
      SELECT * FROM reminders
      WHERE is_active = 1 AND is_paused = 0 AND fire_at IS NOT NULL AND fire_at <= datetime('now')
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).all();
  },

  update(id, guildId, fields) {
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    return getDb().prepare(`UPDATE reminders SET ${sets} WHERE id = ? AND guild_id = ?`).run(...Object.values(fields), id, guildId);
  },

  remove(id, guildId) {
    return getDb().prepare('DELETE FROM reminders WHERE id = ? AND guild_id = ?').run(id, guildId);
  },

  setPaused(id, guildId, paused) {
    return getDb().prepare('UPDATE reminders SET is_paused = ? WHERE id = ? AND guild_id = ?').run(paused ? 1 : 0, id, guildId);
  },

  pauseAll(guildId, paused) {
    return getDb().prepare('UPDATE reminders SET is_paused = ? WHERE guild_id = ? AND is_active = 1').run(paused ? 1 : 0, guildId);
  },

  // After a recurring reminder fires, advance fire_at by interval
  advanceFireAt(id, intervalSecs) {
    return getDb().prepare(`
      UPDATE reminders SET fire_at = datetime(fire_at, '+${Math.round(intervalSecs)} seconds') WHERE id = ?
    `).run(id);
  },

  setLastMessage(id, messageId) {
    return getDb().prepare('UPDATE reminders SET last_message_id = ? WHERE id = ?').run(messageId, id);
  },

  initDefaults(guildId) {
    const existing = getDb().prepare('SELECT id FROM reminders WHERE guild_id = ? AND reminder_time IS NOT NULL').all(guildId);
    if (existing.length > 0) return;
    const times = (process.env.DEFAULT_REMINDER_TIMES || '18:00,19:30,20:30').split(',');
    for (const t of times) this.add(guildId, t.trim());
  },

  clearAll(guildId) {
    return getDb().prepare('DELETE FROM reminders WHERE guild_id = ?').run(guildId);
  }
};

// ============================================================
// SUMMARY CHANNELS
// ============================================================
export const SummaryChannels = {
  add(guildId, channelId, channelName, type = 'daily', deptId = null) {
    return getDb().prepare(`
      INSERT INTO summary_channels(guild_id, channel_id, channel_name, type, department_id)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, channel_id) DO UPDATE SET type=excluded.type, department_id=excluded.department_id, is_active=1
    `).run(guildId, channelId, channelName, type, deptId);
  },
  remove(guildId, channelId) {
    return getDb().prepare('UPDATE summary_channels SET is_active = 0 WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId);
  },
  getAll(guildId, type = null, deptId = null) {
    let q = 'SELECT * FROM summary_channels WHERE guild_id = ? AND is_active = 1';
    const params = [guildId];
    if (type) { q += ' AND type = ?'; params.push(type); }
    if (deptId) { q += ' AND (department_id = ? OR department_id IS NULL)'; params.push(deptId); }
    return getDb().prepare(q).all(...params);
  }
};

// ============================================================
// STREAKS
// ============================================================
export const Streaks = {
  get(guildId, discordId) {
    return getDb().prepare('SELECT * FROM streaks WHERE guild_id = ? AND discord_id = ?').get(guildId, discordId);
  },
  update(guildId, discordId, date) {
    const existing = this.get(guildId, discordId);
    if (!existing) {
      getDb().prepare('INSERT INTO streaks(guild_id, discord_id, current_streak, longest_streak, last_submit_date) VALUES(?,?,1,1,?)').run(guildId, discordId, date);
      return;
    }
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    const isConsecutive = existing.last_submit_date === yStr || existing.last_submit_date === date;
    const newStreak = isConsecutive ? existing.current_streak + (existing.last_submit_date === date ? 0 : 1) : 1;
    const longest = Math.max(newStreak, existing.longest_streak);
    getDb().prepare('UPDATE streaks SET current_streak=?, longest_streak=?, last_submit_date=? WHERE guild_id=? AND discord_id=?').run(newStreak, longest, date, guildId, discordId);
  },
  breakStreak(guildId, discordId) {
    const existing = this.get(guildId, discordId);
    if (!existing) return;
    getDb().prepare('UPDATE streaks SET current_streak=0 WHERE guild_id=? AND discord_id=?').run(guildId, discordId);
  },
  getLeaderboard(guildId) {
    return getDb().prepare(`
      SELECT s.*, u.display_name, u.username
      FROM streaks s JOIN users u ON s.guild_id = u.guild_id AND s.discord_id = u.discord_id
      WHERE s.guild_id = ? AND u.is_active = 1
      ORDER BY s.current_streak DESC LIMIT 10
    `).all(guildId);
  }
};

// ============================================================
// MISSED REPORTS
// ============================================================
export const MissedReports = {
  record(guildId, discordId, date) {
    return getDb().prepare(`
      INSERT OR IGNORE INTO missed_reports(guild_id, discord_id, miss_date) VALUES(?,?,?)
    `).run(guildId, discordId, date);
  },
  getConsecutive(guildId, discordId) {
    const rows = getDb().prepare(`
      SELECT miss_date FROM missed_reports WHERE guild_id=? AND discord_id=? ORDER BY miss_date DESC LIMIT 10
    `).all(guildId, discordId);
    if (rows.length === 0) return 0;
    let count = 1;
    for (let i = 1; i < rows.length; i++) {
      const curr = new Date(rows[i - 1].miss_date);
      const prev = new Date(rows[i].miss_date);
      const diff = (curr - prev) / (1000 * 60 * 60 * 24);
      if (diff === 1) count++;
      else break;
    }
    return count;
  },
  getMonthlyCount(guildId, discordId) {
    const from = new Date();
    from.setDate(1);
    const fromStr = from.toISOString().split('T')[0];
    return getDb().prepare(`
      SELECT COUNT(*) as cnt FROM missed_reports WHERE guild_id=? AND discord_id=? AND miss_date >= ?
    `).get(guildId, discordId, fromStr)?.cnt || 0;
  },
  markNotified(id) {
    return getDb().prepare('UPDATE missed_reports SET notified=1 WHERE id=?').run(id);
  }
};

// ============================================================
// FEEDBACK
// ============================================================
export const Feedback = {
  add(guildId, targetId, managerId, type, content, score = null, reportId = null) {
    return getDb().prepare(`
      INSERT INTO feedback(guild_id, target_id, manager_id, type, content, score, report_id)
      VALUES(?,?,?,?,?,?,?)
    `).run(guildId, targetId, managerId, type, content, score, reportId);
  },
  getForUser(guildId, discordId, limit = 20) {
    return getDb().prepare(`
      SELECT f.*, u.display_name as manager_name
      FROM feedback f
      LEFT JOIN users u ON f.guild_id = u.guild_id AND f.manager_id = u.discord_id
      WHERE f.guild_id = ? AND f.target_id = ?
      ORDER BY f.created_at DESC LIMIT ?
    `).all(guildId, discordId, limit);
  }
};

// ============================================================
// SMART REMINDERS STATE
// ============================================================
export const SmartState = {
  get(guildId, discordId) {
    return getDb().prepare('SELECT * FROM smart_reminder_state WHERE guild_id=? AND discord_id=?').get(guildId, discordId);
  },
  upsert(guildId, discordId, data) {
    const existing = this.get(guildId, discordId);
    if (!existing) {
      getDb().prepare('INSERT INTO smart_reminder_state(guild_id, discord_id, avg_submit_hour, late_count_30d, consecutive_low_confidence) VALUES(?,?,?,?,?)').run(guildId, discordId, data.avg_submit_hour ?? null, data.late_count_30d ?? 0, data.consecutive_low_confidence ?? 0);
    } else {
      getDb().prepare('UPDATE smart_reminder_state SET avg_submit_hour=?, late_count_30d=?, consecutive_low_confidence=?, last_updated=CURRENT_TIMESTAMP WHERE guild_id=? AND discord_id=?').run(data.avg_submit_hour ?? existing.avg_submit_hour, data.late_count_30d ?? existing.late_count_30d, data.consecutive_low_confidence ?? existing.consecutive_low_confidence, guildId, discordId);
    }
  },
  resetDailyFlags(guildId) {
    getDb().prepare('UPDATE smart_reminder_state SET early_reminder_sent=0 WHERE guild_id=?').run(guildId);
  }
};

// ============================================================
// STAFF ROLES — non-admin reminder managers
// ============================================================
export const StaffRoles = {
  add(guildId, roleId, roleName) {
    return getDb().prepare(`
      INSERT OR REPLACE INTO staff_roles(guild_id, role_id, role_name) VALUES(?,?,?)
    `).run(guildId, roleId, roleName);
  },
  remove(guildId, roleId) {
    return getDb().prepare('DELETE FROM staff_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
  },
  getAll(guildId) {
    return getDb().prepare('SELECT * FROM staff_roles WHERE guild_id = ?').all(guildId);
  }
};
