// src/commands/dashboard.js
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Users, Reports, Streaks, Settings } from '../database/db.js';
import { requireManager } from '../utils/permissions.js';
import { errorEmbed, dashboardEmbed, Colors } from '../utils/embeds.js';
import { todayStr } from '../utils/time.js';

export const data = new SlashCommandBuilder()
  .setName('dashboard')
  .setDescription('View the team performance dashboard')
  .addStringOption(o => o.setName('period').setDescription('Period').addChoices(
    { name: 'Today', value: 'today' },
    { name: 'This Week', value: 'week' },
    { name: 'This Month', value: 'month' }
  ));

export async function execute(interaction) {
  const perm = requireManager(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  await interaction.deferReply();

  const { guildId } = interaction;
  const period = interaction.options.getString('period') || 'today';
  const today = todayStr(guildId);

  const allUsers = Users.getAll(guildId);
  const total = allUsers.length;

  // Today's data
  const todayReports = Reports.getTodayAll(guildId, today);
  const submitted = todayReports.length;
  const pending = Math.max(0, total - submitted);
  const late = todayReports.filter(r => r.is_late).length;
  const pct = total > 0 ? Math.round((submitted / total) * 100) : 0;

  // Average confidence
  const confidences = [];
  for (const r of todayReports) {
    const content = Reports.getContent(r.id);
    const conf = content.find(c => c.field_key === 'confidence');
    if (conf?.value) {
      const n = parseInt(conf.value);
      if (!isNaN(n) && n >= 1 && n <= 10) confidences.push(n);
    }
  }
  const avgConf = confidences.length ? (confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(1) : '—';

  // Blockers count
  let blockers = 0;
  for (const r of todayReports) {
    const content = Reports.getContent(r.id);
    const b = content.find(c => c.field_key === 'blockers');
    if (b?.value && b.value.trim().length > 5) blockers++;
  }

  // Week data
  const weekStart = getWeekStart();
  const weekReports = Reports.getRange(guildId, weekStart, today);
  const weekDays = getDaysSinceMonday();
  const expectedWeek = total * weekDays;
  const weekPct = expectedWeek > 0 ? Math.round((weekReports.length / expectedWeek) * 100) : 0;

  const streakLb = Streaks.getLeaderboard(guildId);
  const topStreak = streakLb[0];

  // Top performer (most on-time this week)
  const userWeekMap = {};
  for (const r of weekReports) {
    if (!userWeekMap[r.discord_id]) userWeekMap[r.discord_id] = { name: r.display_name || r.username, count: 0, onTime: 0 };
    userWeekMap[r.discord_id].count++;
    if (!r.is_late) userWeekMap[r.discord_id].onTime++;
  }
  const sorted = Object.values(userWeekMap).sort((a, b) => b.onTime - a.onTime);
  const topPerformer = sorted[0]?.name || '—';

  const todayData = { total, submitted, pending, late, avgConf, blockers, pct };
  const weekData = {
    topStreak: topStreak ? `${topStreak.display_name || topStreak.username} (🔥 ${topStreak.current_streak}d)` : '—',
    topPerformer,
    weekPct
  };

  const embed = dashboardEmbed(todayData, weekData, interaction.guild.name);

  // Pending list
  const submittedIds = new Set(todayReports.map(r => r.discord_id));
  const pendingUsers = allUsers.filter(u => !submittedIds.has(u.discord_id));
  if (pendingUsers.length && pendingUsers.length <= 15) {
    embed.addFields({
      name: '⏳ Still Pending',
      value: pendingUsers.map(u => `<@${u.discord_id}>`).join('  '),
      inline: false
    });
  }

  // Dashboard URL
  const dashUrl = process.env.DASHBOARD_URL;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Open Dashboard').setStyle(ButtonStyle.Link).setURL(dashUrl || 'http://localhost:3000').setEmoji('📊')
  );

  await interaction.editReply({ embeds: [embed], components: dashUrl ? [row] : [] });
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

function getDaysSinceMonday() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day; // Mon=1 ... Sun=7
}
