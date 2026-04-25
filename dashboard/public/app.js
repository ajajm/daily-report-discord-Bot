// dashboard/public/app.js
// ReportOS Dashboard — Frontend Logic

// ── State ─────────────────────────────────────────────────────
const state = {
  guildId: localStorage.getItem('guildId') || '',
  apiKey: localStorage.getItem('apiKey') || '',
  currentPage: 'dashboard',
  dashData: null,
  teamData: null,
  reportsData: null,
  lbData: null,
  settingsData: null,
  charts: {},
};

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('guildIdInput').value = state.guildId;
  document.getElementById('apiKeyInput').value = state.apiKey;
  updateClock();
  setInterval(updateClock, 30000);

  if (state.guildId && state.apiKey) loadData();
});

function updateClock() {
  const el = document.getElementById('topbarDate');
  const now = new Date();
  el.textContent = now.toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Navigation ─────────────────────────────────────────────────
function navigate(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(`page-${page}`).classList.remove('hidden');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  document.getElementById('pageTitle').textContent = {
    dashboard:   'Dashboard',
    team:        'Team Members',
    reports:     'Reports',
    leaderboard: 'Leaderboard',
    analytics:   'Analytics',
    settings:    'Settings',
  }[page] || page;

  // Lazy load page data
  if (page === 'team' && !state.teamData)        loadTeam();
  if (page === 'reports')                        loadReports();
  if (page === 'leaderboard' && !state.lbData)  loadLeaderboard();
  if (page === 'analytics')                      loadAnalytics();
  if (page === 'settings' && !state.settingsData) loadSettings();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ── API ────────────────────────────────────────────────────────
async function api(path) {
  const res = await fetch(path, {
    headers: { 'x-api-key': state.apiKey }
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Load All Data ──────────────────────────────────────────────
async function loadData() {
  state.guildId = document.getElementById('guildIdInput').value.trim();
  state.apiKey  = document.getElementById('apiKeyInput').value.trim();
  localStorage.setItem('guildId', state.guildId);
  localStorage.setItem('apiKey',  state.apiKey);

  if (!state.guildId) { toast('Enter a Guild ID first', 'error'); return; }
  if (!state.apiKey)  { toast('Enter your API Key', 'error'); return; }

  try {
    showShimmer();
    const data = await api(`/api/guilds/${state.guildId}/dashboard`);
    state.dashData = data;
    renderDashboard(data);
    // Reload open page
    if (state.currentPage === 'team') loadTeam();
    toast('Data refreshed', 'success');
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

// ── Dashboard Render ───────────────────────────────────────────
function renderDashboard(data) {
  const { today, trend, streakLeaderboard, pendingUsers, submittedUsers } = data;

  animateValue('kv-total',     today.total);
  animateValue('kv-submitted', today.submitted);
  animateValue('kv-pending',   today.pending);
  animateValue('kv-late',      today.late);
  document.getElementById('kv-pct').textContent = `${today.pct}%`;

  document.getElementById('progressFill').style.width = `${today.pct}%`;
  document.getElementById('progressLabel').textContent = `${today.submitted} / ${today.total}`;
  document.getElementById('pendingCount').textContent  = today.pending;
  document.getElementById('submittedCount').textContent = today.submitted;

  renderTrendChart(trend, today.total);
  renderStreakLb(streakLeaderboard);
  renderPendingList(pendingUsers);
  renderSubmittedList(submittedUsers);
}

function renderTrendChart(trend, total) {
  const ctx = document.getElementById('trendChart').getContext('2d');
  if (state.charts.trend) state.charts.trend.destroy();

  const labels = trend.map(d => {
    const dt = new Date(d.date);
    return dt.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  });

  state.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Submitted',
          data: trend.map(d => d.submitted),
          borderColor: '#5865F2',
          backgroundColor: 'rgba(88,101,242,0.12)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#5865F2',
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: 'Late',
          data: trend.map(d => d.late),
          borderColor: '#F59E0B',
          backgroundColor: 'rgba(245,158,11,0.08)',
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointBackgroundColor: '#F59E0B',
          pointRadius: 4,
          borderDash: [4, 3],
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#8B8FA8', font: { family: 'Inter', size: 12 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#555876', font: { size: 11 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#555876', stepSize: 1, font: { size: 11 } },
          min: 0,
          max: Math.max(total + 1, 5)
        }
      }
    }
  });
}

function renderStreakLb(lb) {
  const el = document.getElementById('streakLb');
  if (!lb?.length) { el.innerHTML = '<div class="empty-state" style="padding:16px">No streaks yet</div>'; return; }
  const ranks = ['gold', 'silver', 'bronze'];
  el.innerHTML = lb.map((u, i) => `
    <div class="lb-row">
      <div class="lb-rank ${ranks[i] || ''}">${i + 1}</div>
      <div class="lb-name">${esc(u.display_name || u.username)}</div>
      <div class="lb-streak">🔥 ${u.current_streak}d</div>
    </div>
  `).join('');
}

function renderPendingList(users) {
  const el = document.getElementById('pendingList');
  if (!users?.length) { el.innerHTML = '<div class="empty-state" style="padding:16px;color:var(--success)">✅ Everyone submitted!</div>'; return; }
  el.innerHTML = users.map(u => `
    <div class="user-row">
      ${avatar(u.name, '#F59E0B')}
      <div class="user-name">${esc(u.name)}</div>
      ${u.dept ? `<div class="user-dept">${esc(u.dept)}</div>` : ''}
    </div>
  `).join('');
}

function renderSubmittedList(users) {
  const el = document.getElementById('submittedList');
  if (!users?.length) { el.innerHTML = '<div class="empty-state" style="padding:16px">No submissions yet</div>'; return; }
  el.innerHTML = users.map(u => `
    <div class="user-row">
      ${avatar(u.name, '#23D18B')}
      <div class="user-name">${esc(u.name)}</div>
      <span class="user-badge ${u.isLate ? 'badge-late' : 'badge-ontime'}">${u.isLate ? 'Late' : 'On Time'}</span>
      ${u.qualityScore ? `<span class="user-badge" style="background:rgba(88,101,242,0.15);color:#818CF8">Q:${u.qualityScore}</span>` : ''}
    </div>
  `).join('');
}

// ── Team Page ──────────────────────────────────────────────────
async function loadTeam() {
  if (!state.guildId) return;
  try {
    const data = await api(`/api/guilds/${state.guildId}/users`);
    state.teamData = data;
    renderTeam(data);
  } catch (err) { toast('Team load failed: ' + err.message, 'error'); }
}

function renderTeam(users) {
  const body = document.getElementById('teamTableBody');
  if (!users?.length) { body.innerHTML = '<tr><td colspan="7" class="empty-state">No team members</td></tr>'; return; }
  body.innerHTML = users.map(u => {
    const s = u.stats;
    const pct = s.pct || 0;
    const streakColor = s.currentStreak >= 7 ? '#FF6B35' : s.currentStreak >= 3 ? '#5865F2' : '#555876';
    return `
      <tr>
        <td style="display:flex;align-items:center;gap:10px;">
          ${avatar(u.displayName)}
          <div>
            <div style="font-weight:600">${esc(u.displayName)}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:JetBrains Mono,monospace">${esc(u.username)}</div>
          </div>
        </td>
        <td>${u.department ? `<span style="font-size:11px;background:rgba(88,101,242,0.15);color:#818CF8;padding:2px 8px;border-radius:99px;font-weight:600">${esc(u.department)}</span>` : '—'}</td>
        <td><span style="font-family:JetBrains Mono,monospace;font-weight:700">${s.total}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="pct-bar"><div class="pct-fill" style="width:${pct}%"></div></div>
            <span style="font-family:JetBrains Mono,monospace;font-weight:700;color:${pct>=80?'var(--success)':pct>=50?'var(--warning)':'var(--danger)'}">${pct}%</span>
          </div>
        </td>
        <td><span style="color:${streakColor};font-weight:700;font-family:JetBrains Mono,monospace">🔥 ${s.currentStreak}</span></td>
        <td>${s.avgQuality ? `<span style="font-family:JetBrains Mono,monospace">${s.avgQuality}/10</span>` : '—'}</td>
        <td><span style="color:${s.missedThisMonth>=5?'var(--danger)':s.missedThisMonth>=2?'var(--warning)':'var(--text-secondary)'};font-weight:600">${s.missedThisMonth}</span></td>
      </tr>
    `;
  }).join('');
}

function filterTeam(query) {
  if (!state.teamData) return;
  const q = query.toLowerCase();
  const filtered = state.teamData.filter(u =>
    u.displayName.toLowerCase().includes(q) ||
    u.username.toLowerCase().includes(q) ||
    (u.department || '').toLowerCase().includes(q)
  );
  renderTeam(filtered);
}

// ── Reports Page ───────────────────────────────────────────────
async function loadReports(date = null) {
  if (!state.guildId) return;
  const dateParam = date || new Date().toISOString().split('T')[0];
  document.getElementById('reportDatePicker').value = dateParam;
  try {
    const data = await api(`/api/guilds/${state.guildId}/reports?date=${dateParam}`);
    state.reportsData = data;
    renderReports(data);
  } catch (err) { toast('Reports load failed: ' + err.message, 'error'); }
}

function renderReports(reports) {
  const grid = document.getElementById('reportsGrid');
  if (!reports?.length) { grid.innerHTML = '<div class="empty-state">No reports for this date</div>'; return; }
  grid.innerHTML = reports.map(r => {
    const contentFields = (r.content || []).filter(c => c.value?.trim());
    const conf = r.content?.find(c => c.field_key === 'confidence')?.value;
    return `
      <div class="report-card">
        <div class="report-card-header">
          <div>
            <div class="report-user">${esc(r.display_name || r.username)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(r.report_date)}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span class="score-badge" style="background:${r.is_late?'var(--warning-glow)':'var(--success-glow)'};color:${r.is_late?'var(--warning)':'var(--success)'}">${r.is_late ? '🔴 Late' : '🟢 On Time'}</span>
            ${conf ? `<span class="score-badge" style="background:rgba(88,101,242,0.15);color:#818CF8">💡 ${conf}/10</span>` : ''}
            ${r.quality_score ? `<span class="score-badge" style="background:rgba(139,92,246,0.15);color:var(--purple)">Q:${r.quality_score}</span>` : ''}
          </div>
        </div>
        <div class="report-meta">
          ${contentFields.slice(0, 4).map(c => `
            <div class="report-field">
              ${esc(c.field_label)}
              <strong>${esc(c.value.slice(0, 120))}${c.value.length > 120 ? '...' : ''}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ── Leaderboard ────────────────────────────────────────────────
async function loadLeaderboard() {
  if (!state.guildId) return;
  try {
    const data = await api(`/api/guilds/${state.guildId}/leaderboard`);
    state.lbData = data;
    renderLeaderboard(data);
  } catch (err) { toast('Leaderboard load failed: ' + err.message, 'error'); }
}

function renderLeaderboard(data) {
  const grid = document.getElementById('lbGrid');
  if (!data?.length) { grid.innerHTML = '<div class="empty-state">No data</div>'; return; }
  grid.innerHTML = data.map((u, i) => `
    <div class="lb-card">
      <div class="lb-number ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : ''}">${i + 1}</div>
      ${avatar(u.name, i === 0 ? '#F59E0B' : i === 1 ? '#94A3B8' : i === 2 ? '#CD7C2F' : undefined, 40)}
      <div class="lb-info">
        <div class="lb-info-name">${esc(u.name)}</div>
        ${u.dept ? `<div class="lb-info-dept">${esc(u.dept)}</div>` : ''}
        <div class="lb-info-stats">🔥 ${u.streak}d streak · ${u.total} reports · Q:${u.avgQ}</div>
      </div>
      <div class="lb-pct">${u.pct}%</div>
    </div>
  `).join('');
}

// ── Analytics ──────────────────────────────────────────────────
async function loadAnalytics() {
  if (!state.guildId) return;
  try {
    const data = await api(`/api/guilds/${state.guildId}/dashboard`);
    renderAnalytics(data);
  } catch (err) { toast('Analytics load failed: ' + err.message, 'error'); }
}

function renderAnalytics(data) {
  const { trend } = data;
  const totalSubmitted = trend.reduce((a, d) => a + d.submitted, 0);
  const totalLate = trend.reduce((a, d) => a + d.late, 0);
  const totalOnTime = totalSubmitted - totalLate;

  // Pie chart
  const pieCtx = document.getElementById('pieChart').getContext('2d');
  if (state.charts.pie) state.charts.pie.destroy();
  state.charts.pie = new Chart(pieCtx, {
    type: 'doughnut',
    data: {
      labels: ['On Time', 'Late', 'Missed'],
      datasets: [{
        data: [totalOnTime, totalLate, Math.max(0, (data.today.total * 7) - totalSubmitted)],
        backgroundColor: ['#23D18B', '#F59E0B', '#EF4444'],
        borderColor: '#191A2A',
        borderWidth: 3,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#8B8FA8', font: { family: 'Inter', size: 12 } } }
      },
      cutout: '70%',
    }
  });

  // Bar chart
  const barCtx = document.getElementById('barChart').getContext('2d');
  if (state.charts.bar) state.charts.bar.destroy();
  state.charts.bar = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: trend.map(d => new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })),
      datasets: [{
        label: 'Completion %',
        data: trend.map(d => d.pct),
        backgroundColor: trend.map(d => d.pct >= 80 ? 'rgba(35,209,139,0.7)' : d.pct >= 50 ? 'rgba(245,158,11,0.7)' : 'rgba(239,68,68,0.7)'),
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#555876', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#555876', font: { size: 11 } }, min: 0, max: 100,
             callback: v => v + '%' }
      }
    }
  });
}

// ── Settings ───────────────────────────────────────────────────
async function loadSettings() {
  if (!state.guildId) return;
  try {
    const data = await api(`/api/guilds/${state.guildId}/settings`);
    state.settingsData = data;
    renderSettings(data);
  } catch (err) { toast('Settings load failed: ' + err.message, 'error'); }
}

function renderSettings(data) {
  const el = document.getElementById('settingsContent');
  const { settings, reminders, departments, summaryChannels } = data;

  el.innerHTML = `
    <div class="settings-group">
      <div class="settings-group-title">General</div>
      ${Object.entries(settings).map(([k, v]) => `
        <div class="settings-row">
          <span class="settings-key">${esc(k.replace(/_/g, ' '))}</span>
          <span class="settings-value">${esc(String(v))}</span>
        </div>
      `).join('')}
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Reminders (${reminders.length})</div>
      ${reminders.map(r => `
        <div class="settings-row">
          <span class="settings-key">ID: ${r.id} — ${esc(r.type)}</span>
          <span class="settings-value">${esc(r.reminder_time)}</span>
        </div>
      `).join('') || '<div style="color:var(--text-muted);font-size:12px">No reminders set</div>'}
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Departments (${departments.length})</div>
      ${departments.map(d => `
        <div class="settings-row">
          <span class="settings-key">${d.icon} ${esc(d.name)}</span>
          <span class="settings-value">${esc(d.description || '—')}</span>
        </div>
      `).join('') || '<div style="color:var(--text-muted);font-size:12px">No departments</div>'}
    </div>

    <div class="settings-group">
      <div class="settings-group-title">Summary Channels (${summaryChannels.length})</div>
      ${summaryChannels.map(c => `
        <div class="settings-row">
          <span class="settings-key">#${esc(c.channel_name || c.channel_id)}</span>
          <span class="settings-value">${esc(c.type)}</span>
        </div>
      `).join('') || '<div style="color:var(--text-muted);font-size:12px">No summary channels</div>'}
    </div>
  `;
}

// ── Helpers ────────────────────────────────────────────────────
function avatar(name, color, size = 30) {
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const colors = ['#5865F2','#23D18B','#8B5CF6','#3B82F6','#F59E0B','#EF4444','#FF6B35'];
  const bg = color || colors[name?.charCodeAt(0) % colors.length] || colors[0];
  return `<div class="user-avatar" style="background:${bg}22;color:${bg};width:${size}px;height:${size}px;font-size:${size*0.4}px">${initials}</div>`;
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function animateValue(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const duration = 600;
  const startTime = performance.now();
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function showShimmer() {
  ['kv-total','kv-submitted','kv-pending','kv-late','kv-pct'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('shimmer'); el.textContent = '██'; }
  });
  setTimeout(() => {
    ['kv-total','kv-submitted','kv-pending','kv-late','kv-pct'].forEach(id => {
      document.getElementById(id)?.classList.remove('shimmer');
    });
  }, 800);
}

let toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3500);
}

// Auto-refresh every 60s
setInterval(() => {
  if (state.guildId && state.apiKey) loadData();
}, 60000);
