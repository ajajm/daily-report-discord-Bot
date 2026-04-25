// dashboard/server.js
// Express API server for the web dashboard

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, Users, Reports, Streaks, Feedback, MissedReports, Departments, Settings, SummaryChannels, Reminders } from '../src/database/db.js';
import { logger } from '../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

initDb();

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Simple API Key Auth ─────────────────────────────────────
const API_SECRET = process.env.DASHBOARD_SECRET || 'changeme';
function apiAuth(req, res, next) {
  // Skip auth for static files
  if (!req.path.startsWith('/api/')) return next();
  const token = req.headers['x-api-key'] || req.query.key;
  if (token !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
app.use(apiAuth);

// ── API Routes ──────────────────────────────────────────────

// GET /api/guilds/:guildId/dashboard
app.get('/api/guilds/:guildId/dashboard', (req, res) => {
  const { guildId } = req.params;
  const today = new Date().toISOString().split('T')[0];

  const allUsers = Users.getAll(guildId);
  const todayReports = Reports.getTodayAll(guildId, today);
  const submittedIds = new Set(todayReports.map(r => r.discord_id));

  const submitted = todayReports.length;
  const total = allUsers.length;
  const pending = Math.max(0, total - submitted);
  const late = todayReports.filter(r => r.is_late).length;
  const pct = total > 0 ? Math.round((submitted / total) * 100) : 0;

  // 7-day trend
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayReports = Reports.getTodayAll(guildId, dateStr);
    trend.push({
      date: dateStr,
      submitted: dayReports.length,
      late: dayReports.filter(r => r.is_late).length,
      pct: total > 0 ? Math.round((dayReports.length / total) * 100) : 0
    });
  }

  // Streak leaderboard
  const streakLb = Streaks.getLeaderboard(guildId);

  // Pending users list
  const pendingUsers = allUsers.filter(u => !submittedIds.has(u.discord_id));

  res.json({
    today: { total, submitted, pending, late, pct },
    trend,
    streakLeaderboard: streakLb.slice(0, 5),
    pendingUsers: pendingUsers.map(u => ({ id: u.discord_id, name: u.display_name || u.username, dept: u.dept_name })),
    submittedUsers: todayReports.map(r => ({ id: r.discord_id, name: r.display_name || r.username, dept: r.dept_name, isLate: r.is_late, qualityScore: r.quality_score, managerScore: r.manager_score }))
  });
});

// GET /api/guilds/:guildId/users
app.get('/api/guilds/:guildId/users', (req, res) => {
  const { guildId } = req.params;
  const users = Users.getAll(guildId);
  const result = users.map(u => {
    const stats = Reports.getUserStats(guildId, u.discord_id);
    const streak = Streaks.get(guildId, u.discord_id);
    const missed = MissedReports.getMonthlyCount(guildId, u.discord_id);
    return {
      id: u.discord_id,
      username: u.username,
      displayName: u.display_name || u.username,
      department: u.dept_name,
      channel: u.report_channel,
      stats: {
        total: stats?.total || 0,
        onTime: stats?.on_time || 0,
        late: stats?.late || 0,
        pct: stats?.total > 0 ? Math.round(((stats.on_time || 0) / stats.total) * 100) : 0,
        avgQuality: stats?.avg_quality?.toFixed(1) || null,
        avgManagerScore: stats?.avg_manager_score?.toFixed(1) || null,
        missedThisMonth: missed,
        currentStreak: streak?.current_streak || 0,
        longestStreak: streak?.longest_streak || 0,
      }
    };
  });
  res.json(result);
});

// GET /api/guilds/:guildId/reports?date=YYYY-MM-DD&from=&to=
app.get('/api/guilds/:guildId/reports', (req, res) => {
  const { guildId } = req.params;
  const { date, from, to } = req.query;
  let reports;
  if (date) {
    reports = Reports.getTodayAll(guildId, date);
  } else {
    const today = new Date().toISOString().split('T')[0];
    const fromDate = from || (() => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]; })();
    reports = Reports.getRange(guildId, fromDate, to || today);
  }
  // Enrich with content
  const enriched = reports.map(r => {
    const content = Reports.getContent(r.id);
    return { ...r, content };
  });
  res.json(enriched);
});

// GET /api/guilds/:guildId/settings
app.get('/api/guilds/:guildId/settings', (req, res) => {
  const { guildId } = req.params;
  const settings = Settings.getAll(guildId);
  const reminders = Reminders.getAll(guildId);
  const departments = Departments.getAll(guildId);
  const summaryChannels = SummaryChannels.getAll(guildId);
  res.json({ settings, reminders, departments, summaryChannels });
});

// GET /api/guilds/:guildId/leaderboard
app.get('/api/guilds/:guildId/leaderboard', (req, res) => {
  const { guildId } = req.params;
  const users = Users.getAll(guildId);
  const result = users.map(u => {
    const stats = Reports.getUserStats(guildId, u.discord_id);
    const streak = Streaks.get(guildId, u.discord_id);
    return {
      id: u.discord_id,
      name: u.display_name || u.username,
      dept: u.dept_name,
      total: stats?.total || 0,
      pct: stats?.total > 0 ? Math.round(((stats.on_time || 0) / stats.total) * 100) : 0,
      streak: streak?.current_streak || 0,
      avgQ: stats?.avg_quality?.toFixed(1) || '—',
    };
  }).sort((a, b) => b.pct - a.pct || b.streak - a.streak);
  res.json(result);
});

// ── Serve Dashboard ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  logger.info(`📊 Dashboard running at http://localhost:${PORT}`);
});
