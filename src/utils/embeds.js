// src/utils/embeds.js
// Premium embed builder — consistent, modern, startup-grade UI

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// Brand colors
export const Colors = {
  primary:   0x5865F2,  // Discord blurple
  success:   0x23D18B,  // Emerald
  warning:   0xF59E0B,  // Amber
  danger:    0xEF4444,  // Red
  info:      0x3B82F6,  // Blue
  purple:    0x8B5CF6,  // Violet
  gold:      0xF59E0B,  // Gold
  dark:      0x1E1F2E,  // Dark bg
  muted:     0x6B7280,  // Gray
  streak:    0xFF6B35,  // Streak orange
};

export function successEmbed(title, description, fields = []) {
  const e = new EmbedBuilder()
    .setColor(Colors.success)
    .setTitle(`✅  ${title}`)
    .setTimestamp();
  if (description) e.setDescription(description);
  if (fields.length) e.addFields(fields);
  return e;
}

export function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(Colors.danger)
    .setTitle(`❌  ${title}`)
    .setDescription(description)
    .setTimestamp();
}

export function infoEmbed(title, description, fields = []) {
  const e = new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle(`ℹ️  ${title}`)
    .setTimestamp();
  if (description) e.setDescription(description);
  if (fields.length) e.addFields(fields);
  return e;
}

export function warningEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(Colors.warning)
    .setTitle(`⚠️  ${title}`)
    .setDescription(description)
    .setTimestamp();
}

export function reportSummaryEmbed(report, content, streakData = null) {
  const username = report.display_name || report.username;
  const date = report.report_date;
  const late = report.is_late;
  const qualityScore = report.quality_score || '—';
  const managerScore = report.manager_score;

  const statusIcon = late ? '🔴' : '🟢';
  const statusText = late ? 'Late Submission' : 'On Time';

  const embed = new EmbedBuilder()
    .setColor(late ? Colors.warning : Colors.success)
    .setTitle(`${statusIcon}  Daily Report — ${username}`)
    .setDescription(`**Date:** ${formatDate(date)}   •   **Status:** ${statusText}`)
    .setTimestamp();

  // Build content fields
  for (const c of content) {
    if (c.value && c.value.trim()) {
      embed.addFields({
        name: `› ${c.field_label}`,
        value: truncate(c.value, 300),
        inline: false
      });
    }
  }

  // Metadata row
  const meta = [];
  if (qualityScore !== '—') meta.push(`📊 Quality: **${qualityScore}/10**`);
  if (managerScore)         meta.push(`⭐ Manager: **${managerScore}/10**`);
  if (report.word_count)    meta.push(`📝 Words: **${report.word_count}**`);
  if (streakData?.current_streak > 1) meta.push(`🔥 Streak: **${streakData.current_streak} days**`);

  if (meta.length) embed.addFields({ name: '📈 Metrics', value: meta.join('   '), inline: false });

  embed.setFooter({ text: `Report ID: ${report.id}  •  Submitted at ${formatTime(report.submitted_at)}` });
  return embed;
}

export function dashboardEmbed(todayData, weekData, guildName) {
  const { total, submitted, pending, late, avgConf, blockers, pct } = todayData;
  const pctBar = progressBar(pct, 12);

  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setTitle(`📊  Team Dashboard — ${guildName}`)
    .setDescription(`**Today's Reporting Status**\n\n${pctBar} **${pct}%** complete`)
    .addFields(
      { name: '👥 Team Size',       value: `\`${total}\``,     inline: true },
      { name: '✅ Submitted',        value: `\`${submitted}\``, inline: true },
      { name: '⏳ Pending',          value: `\`${pending}\``,   inline: true },
      { name: '🔴 Late',             value: `\`${late}\``,      inline: true },
      { name: '🎯 Avg Confidence',   value: `\`${avgConf}/10\``,inline: true },
      { name: '🚧 Active Blockers',  value: `\`${blockers}\``,  inline: true },
    )
    .setTimestamp();

  if (weekData) {
    embed.addFields(
      { name: '\u200B', value: '**── This Week ──**', inline: false },
      { name: '🔥 Top Streak',     value: weekData.topStreak,     inline: true },
      { name: '🏆 Top Performer',  value: weekData.topPerformer,  inline: true },
      { name: '📅 Week Completion',value: `${weekData.weekPct}%`, inline: true },
    );
  }

  embed.setFooter({ text: 'Live Dashboard  •  Updates in real-time' });
  return embed;
}

export function statsEmbed(user, reports, streak, feedback) {
  const username = user.display_name || user.username;
  const total = reports.total || 0;
  const onTime = reports.on_time || 0;
  const pct = total > 0 ? Math.round((onTime / total) * 100) : 0;
  const avgQ = reports.avg_quality ? reports.avg_quality.toFixed(1) : '—';
  const avgM = reports.avg_manager_score ? reports.avg_manager_score.toFixed(1) : '—';
  const streakBar = streak ? streakBadge(streak.current_streak) : '—';

  return new EmbedBuilder()
    .setColor(Colors.purple)
    .setTitle(`👤  Performance — ${username}`)
    .addFields(
      { name: '📅 Total Reports',    value: `\`${total}\``,               inline: true },
      { name: '✅ On-Time Rate',      value: `\`${pct}%\``,                inline: true },
      { name: '🔥 Current Streak',   value: streakBar,                    inline: true },
      { name: '🏆 Longest Streak',   value: `\`${streak?.longest_streak ?? 0} days\``, inline: true },
      { name: '📊 Avg Quality',      value: `\`${avgQ}/10\``,             inline: true },
      { name: '⭐ Manager Score',    value: `\`${avgM}/10\``,             inline: true },
    )
    .setTimestamp()
    .setFooter({ text: `Stats for ${username}` });
}

export function weeklyReportEmbed(data, guildName) {
  const embed = new EmbedBuilder()
    .setColor(Colors.gold)
    .setTitle(`📋  Weekly Team Report`)
    .setDescription(`**${guildName}**  •  Week of ${data.weekLabel}`)
    .addFields(
      { name: '📊 Team Completion',  value: `${data.completionPct}%`,              inline: true },
      { name: '🔥 Top Streak',       value: data.topStreak?.display_name || '—',   inline: true },
      { name: '🏆 Most Consistent',  value: data.mostConsistent?.display_name || '—', inline: true },
      { name: '📈 Most Improved',    value: data.mostImproved?.display_name || '—',   inline: true },
      { name: '🎯 Avg Morale',       value: data.avgMorale ? `${data.avgMorale}/10` : '—', inline: true },
      { name: '❌ Missed Reports',   value: `${data.totalMissed}`,                 inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'Auto-generated weekly summary' });
  return embed;
}

export function reminderEmbed(pending, deadline, type = 'standard') {
  const msgs = {
    standard:   `⏰  **Report Reminder**`,
    final:      `🚨  **Final Reminder** — Last call!`,
    escalation: `🔴  **Missed Report Alert**`,
    motivational: `🔥  **Keep your streak alive!**`,
    early:      `📋  **Early Reminder** — You usually submit late`,
  };

  const colors = {
    standard: Colors.info, final: Colors.warning, escalation: Colors.danger,
    motivational: Colors.streak, early: Colors.purple,
  };

  return new EmbedBuilder()
    .setColor(colors[type] || Colors.info)
    .setTitle(msgs[type] || msgs.standard)
    .setDescription(
      type === 'escalation'
        ? `You missed today's report. Please submit it now — even late submissions help accountability.`
        : `Today's report is due by **${deadline}**. Don't break the chain! 💪`
    )
    .addFields({ name: '📋 Submit Now', value: 'Use `/report` in your assigned channel.' })
    .setTimestamp();
}

// ── Helpers ──────────────────────────────────────────────────

function progressBar(pct, length = 10) {
  const filled = Math.round((pct / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function streakBadge(n) {
  if (n >= 30) return `\`${n} days\` 🌟`;
  if (n >= 14) return `\`${n} days\` 🔥`;
  if (n >= 7)  return `\`${n} days\` ✨`;
  if (n >= 3)  return `\`${n} days\` ⚡`;
  return `\`${n} days\``;
}

function truncate(str, max) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(dtStr) {
  if (!dtStr) return '';
  const d = new Date(dtStr);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
