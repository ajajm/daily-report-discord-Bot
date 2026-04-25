// src/commands/export.js
// Data export: CSV reports, stats, weekly PDF

import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { Reports, Users, Streaks, MissedReports } from '../database/db.js';
import { requireManager } from '../utils/permissions.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { todayStr } from '../utils/time.js';

export const data = new SlashCommandBuilder()
  .setName('export')
  .setDescription('Export report data')
  .addSubcommand(s => s.setName('reports').setDescription('Export reports as CSV')
    .addStringOption(o => o.setName('from').setDescription('From date YYYY-MM-DD (default: this month)'))
    .addStringOption(o => o.setName('to').setDescription('To date YYYY-MM-DD (default: today)')))
  .addSubcommand(s => s.setName('stats').setDescription('Export user stats as CSV'))
  .addSubcommand(s => s.setName('weekly').setDescription('Export this week\'s summary as CSV'));

export async function execute(interaction) {
  const perm = requireManager(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const { guildId } = interaction;
  const sub = interaction.options.getSubcommand();

  if (sub === 'reports') {
    const today = todayStr(guildId);
    const from = interaction.options.getString('from') || today.slice(0, 7) + '-01';
    const to = interaction.options.getString('to') || today;

    const rows = Reports.getRange(guildId, from, to);
    if (!rows.length) return interaction.editReply({ embeds: [errorEmbed('No Data', 'No reports found in that date range.')] });

    const lines = [
      'Date,User,DisplayName,IsLate,QualityScore,ManagerScore,WordCount,Status,Department'
    ];
    for (const r of rows) {
      lines.push(`${r.report_date},${r.username},${r.display_name || r.username},${r.is_late ? 'Yes' : 'No'},${r.quality_score || ''},${r.manager_score || ''},${r.word_count},${r.status},${r.dept_name || ''}`);
    }
    const csv = lines.join('\n');
    const buffer = Buffer.from(csv, 'utf-8');
    const file = new AttachmentBuilder(buffer, { name: `reports_${from}_to_${to}.csv` });
    return interaction.editReply({ content: `✅ Exported **${rows.length}** reports`, files: [file] });
  }

  if (sub === 'stats') {
    const users = Users.getAll(guildId);
    const lines = ['Username,DisplayName,Department,TotalReports,OnTime,Late,OnTimePct,AvgQuality,AvgManagerScore,CurrentStreak,LongestStreak'];
    for (const u of users) {
      const stats = Reports.getUserStats(guildId, u.discord_id);
      const streak = Streaks.get(guildId, u.discord_id);
      const total = stats?.total || 0;
      const onTime = stats?.on_time || 0;
      const late = stats?.late || 0;
      const pct = total > 0 ? Math.round((onTime / total) * 100) : 0;
      lines.push(`${u.username},${u.display_name || u.username},${u.dept_name || ''},${total},${onTime},${late},${pct}%,${stats?.avg_quality?.toFixed(1) || ''},${stats?.avg_manager_score?.toFixed(1) || ''},${streak?.current_streak || 0},${streak?.longest_streak || 0}`);
    }
    const csv = lines.join('\n');
    const file = new AttachmentBuilder(Buffer.from(csv, 'utf-8'), { name: `stats_${todayStr(guildId)}.csv` });
    return interaction.editReply({ content: `✅ Stats exported for **${users.length}** users`, files: [file] });
  }

  if (sub === 'weekly') {
    const today = todayStr(guildId);
    const d = new Date(today);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff)).toISOString().split('T')[0];

    const rows = Reports.getRange(guildId, monday, today);
    const lines = ['Date,User,IsLate,QualityScore,ManagerScore,WordCount'];
    for (const r of rows) {
      lines.push(`${r.report_date},${r.display_name || r.username},${r.is_late ? 'Yes' : 'No'},${r.quality_score || ''},${r.manager_score || ''},${r.word_count}`);
    }
    const file = new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf-8'), { name: `weekly_${monday}.csv` });
    return interaction.editReply({ content: `✅ Weekly report exported (${rows.length} entries)`, files: [file] });
  }
}
