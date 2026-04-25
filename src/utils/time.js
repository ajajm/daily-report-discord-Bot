// src/utils/time.js
// Timezone-aware date/time helpers — extended with flexible parsing

import moment from 'moment-timezone';
import { Settings } from '../database/db.js';

export function getGuildTimezone(guildId) {
  return Settings.get(guildId, 'timezone', process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata');
}

export function nowInGuild(guildId) {
  return moment().tz(getGuildTimezone(guildId));
}

export function todayStr(guildId) {
  return nowInGuild(guildId).format('YYYY-MM-DD');
}

// ── Simple HH:MM / h:mmAM parse ──────────────────────────────
export function parseTime(timeStr) {
  const m24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return { hour: parseInt(m24[1]), minute: parseInt(m24[2]) };
  const m12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = parseInt(m12[1]);
    const min = parseInt(m12[2]);
    if (m12[3].toUpperCase() === 'PM' && h < 12) h += 12;
    if (m12[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return { hour: h, minute: min };
  }
  return null;
}

// ── Flexible time parser → moment object (in server timezone) ─
// Supports:
//   "7:00PM", "19:00"
//   "2h 30m", "1d", "30m", "2d 3h 15m"
//   "30/04 9pm", "04/30 21:00"
//   "monday 3pm", "tuesday 14:00"
//   "tomorrow 9am"
export function parseFlexibleTime(input, timezone = 'Asia/Kolkata') {
  if (!input) return null;
  const str = input.trim().toLowerCase();
  const tz = timezone;
  const now = moment().tz(tz);

  // ── Relative duration: "2d 3h 15m 30s"
  const relMatch = str.match(/^[\d\s\w]+$/);
  if (/\d+(d|h|m|s)/.test(str)) {
    const parts = { d: 0, h: 0, m: 0, s: 0 };
    str.replace(/(\d+)(d|h|m|s)/g, (_, n, u) => { parts[u] = parseInt(n); });
    if (parts.d || parts.h || parts.m || parts.s) {
      return moment(now).add(parts.d, 'days').add(parts.h, 'hours').add(parts.m, 'minutes').add(parts.s, 'seconds');
    }
  }

  // ── "tomorrow 9am" or "tomorrow 21:00"
  if (str.startsWith('tomorrow')) {
    const timePart = str.replace('tomorrow', '').trim();
    const t = parseSimpleTimeStr(timePart);
    if (t) return moment(now).add(1, 'day').hour(t.h).minute(t.m).second(0);
  }

  // ── Weekday: "monday 3pm", "tuesday 14:00"
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < weekdays.length; i++) {
    if (str.startsWith(weekdays[i])) {
      const timePart = str.replace(weekdays[i], '').trim();
      const t = parseSimpleTimeStr(timePart);
      if (t) {
        let target = moment(now).day(i).hour(t.h).minute(t.m).second(0);
        if (target.isBefore(now)) target.add(7, 'days');
        return target;
      }
    }
  }

  // ── Date: "30/04 9pm", "04/30 21:00", "30/04/2026 21:00"
  const dateMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s+(.+)$/);
  if (dateMatch) {
    const [, a, b, yr, timePart] = dateMatch;
    const year = yr ? (yr.length === 2 ? 2000 + parseInt(yr) : parseInt(yr)) : now.year();
    // Try DD/MM then MM/DD
    const t = parseSimpleTimeStr(timePart);
    if (t) {
      let target = moment.tz(`${year}-${b.padStart(2,'0')}-${a.padStart(2,'0')} ${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}`, 'YYYY-MM-DD HH:mm', tz);
      if (!target.isValid()) target = moment.tz(`${year}-${a.padStart(2,'0')}-${b.padStart(2,'0')} ${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}`, 'YYYY-MM-DD HH:mm', tz);
      if (target.isValid()) return target;
    }
  }

  // ── Simple time: "7:00PM", "19:00", "3pm", "9am"
  const t = parseSimpleTimeStr(str);
  if (t) {
    let target = moment(now).hour(t.h).minute(t.m).second(0);
    if (target.isBefore(now)) target.add(1, 'day');
    return target;
  }

  return null;
}

function parseSimpleTimeStr(s) {
  if (!s) return null;
  // 7:30PM
  const m12c = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m12c) {
    let h = parseInt(m12c[1]); const m = parseInt(m12c[2]);
    if (m12c[3].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m12c[3].toLowerCase() === 'am' && h === 12) h = 0;
    return { h, m };
  }
  // 19:30
  const m24c = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24c) return { h: parseInt(m24c[1]), m: parseInt(m24c[2]) };
  // 3pm / 9am
  const mShort = s.match(/^(\d{1,2})\s*(am|pm)$/i);
  if (mShort) {
    let h = parseInt(mShort[1]);
    if (mShort[2].toLowerCase() === 'pm' && h < 12) h += 12;
    if (mShort[2].toLowerCase() === 'am' && h === 12) h = 0;
    return { h, m: 0 };
  }
  return null;
}

// ── Interval parser: "daily"→86400, "2h"→7200, "30m"→1800 ──
export function parseInterval(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  const presets = {
    '30m': 1800,
    'hourly': 3600,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '6h': 21600,
    '12h': 43200,
    'daily': 86400,
    '1d': 86400,
    'weekly': 604800,
    '7d': 604800,
    'monthly': 2592000,
    '30d': 2592000,
    'yearly': 31536000,
  };
  if (presets[s]) return presets[s];

  // Parse "2d 3h 15m"
  let total = 0;
  const matches = [...s.matchAll(/(\d+)\s*(d|h|m|s)/g)];
  if (matches.length) {
    const mult = { d: 86400, h: 3600, m: 60, s: 1 };
    for (const [, n, u] of matches) total += parseInt(n) * mult[u];
    return total || null;
  }
  return null;
}

// ── Seconds to human ─────────────────────────────────────────
export function secondsToHuman(secs) {
  if (!secs) return '?';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ') || `${secs}s`;
}

export function formatTime(timeStr) {
  const t = parseTime(timeStr);
  if (!t) return timeStr;
  return moment().hour(t.hour).minute(t.minute).format('h:mm A');
}

export function isAfterDeadline(guildId) {
  const deadline = Settings.get(guildId, 'deadline', process.env.DEFAULT_DEADLINE || '21:00');
  const now = nowInGuild(guildId);
  const t = parseTime(deadline);
  if (!t) return false;
  const deadlineMoment = nowInGuild(guildId).hour(t.hour).minute(t.minute).second(0);
  return now.isAfter(deadlineMoment);
}

export function getDeadlineStr(guildId) {
  const deadline = Settings.get(guildId, 'deadline', process.env.DEFAULT_DEADLINE || '21:00');
  return formatTime(deadline);
}

export function msUntilTime(timeStr, timezone) {
  const t = parseTime(timeStr);
  if (!t) return null;
  const now = moment().tz(timezone);
  let target = moment().tz(timezone).hour(t.hour).minute(t.minute).second(0).millisecond(0);
  if (target.isBefore(now)) target.add(1, 'day');
  return target.diff(now);
}
