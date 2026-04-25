// src/commands/report.js
// /report — opens modal for daily report submission

import {
  SlashCommandBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, EmbedBuilder
} from 'discord.js';
import { Users, Reports, ReportFields, Streaks, SummaryChannels, Settings, SmartState } from '../database/db.js';
import { todayStr, isAfterDeadline, getDeadlineStr, nowInGuild } from '../utils/time.js';
import { scoreReportQuality } from '../utils/quality.js';
import { errorEmbed, warningEmbed, Colors } from '../utils/embeds.js';
import { checkCooldown } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';
import moment from 'moment-timezone';

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Submit your daily report');

export async function execute(interaction) {
  const { user, guildId, channelId } = interaction;

  // Cooldown
  const cd = checkCooldown('report', user.id, 10);
  if (cd.onCooldown) {
    return interaction.reply({ embeds: [errorEmbed('Slow down', `Wait ${cd.remaining}s before submitting again.`)], ephemeral: true });
  }

  // Check user is assigned
  const dbUser = Users.get(guildId, user.id);
  if (!dbUser) {
    return interaction.reply({
      embeds: [errorEmbed('Not Registered', 'You are not registered. Ask an admin to use `/assignreport` first.')],
      ephemeral: true
    });
  }

  // Check correct channel
  const isAdmin = interaction.member.permissions.has('Administrator');
  if (!isAdmin && dbUser.report_channel && dbUser.report_channel !== channelId) {
    const ch = interaction.guild.channels.cache.get(dbUser.report_channel);
    return interaction.reply({
      embeds: [errorEmbed('Wrong Channel', `Submit your report in ${ch ? `<#${ch.id}>` : 'your assigned channel'}.`)],
      ephemeral: true
    });
  }

  // Check already submitted today
  const today = todayStr(guildId);
  const existing = Reports.getToday(guildId, user.id, today);
  if (existing) {
    return interaction.reply({
      embeds: [warningEmbed('Already Submitted', "You already submitted today's report.")],
      ephemeral: true
    });
  }

  // Get dates for labels
  const tz = Settings.get(guildId, 'timezone', process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata');
  const todayDisplay   = moment().tz(tz).format('DD MMM YYYY');
  const tomorrowDisplay = moment().tz(tz).add(1, 'day').format('DD MMM YYYY');

  // Build modal
  const modal = new ModalBuilder()
    .setCustomId(`report_modal_${user.id}`)
    .setTitle('📋  Daily Report');

  const dailyInput = new TextInputBuilder()
    .setCustomId('daily_report')
    .setLabel(`Daily Report (${todayDisplay})`)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder('1. \n2. \n3. ');

  const todoInput = new TextInputBuilder()
    .setCustomId('todo_tomorrow')
    .setLabel(`To-Do List (${tomorrowDisplay})`)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder('1. \n2. \n3. ');

  const meetingInput = new TextInputBuilder()
    .setCustomId('meeting_todo')
    .setLabel('Meeting To-Do (if meeting day)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder('1. \n2. \n3. ');

  modal.addComponents(
    new ActionRowBuilder().addComponents(dailyInput),
    new ActionRowBuilder().addComponents(todoInput),
    new ActionRowBuilder().addComponents(meetingInput),
  );

  await interaction.showModal(modal);

  // Await submission
  let modalSubmit;
  try {
    modalSubmit = await interaction.awaitModalSubmit({
      filter: i => i.customId === `report_modal_${user.id}` && i.user.id === user.id,
      time: 10 * 60 * 1000
    });
  } catch {
    return;
  }

  await modalSubmit.deferReply({ ephemeral: false });

  const dailyReport = modalSubmit.fields.getTextInputValue('daily_report') || '';
  const todoTomorrow = modalSubmit.fields.getTextInputValue('todo_tomorrow') || '';
  const meetingTodo  = modalSubmit.fields.getTextInputValue('meeting_todo') || '';

  const contentMap = { daily_report: dailyReport, todo_tomorrow: todoTomorrow, meeting_todo: meetingTodo };

  // Quality score
  const { score: qualityScore, wordCount, isLowEffort, warning } = scoreReportQuality(contentMap);
  const deadline = Settings.get(guildId, 'deadline', process.env.DEFAULT_DEADLINE || '21:00');
  const isLate = isAfterDeadline(guildId);

  // Save report
  const reportResult = Reports.create(guildId, dbUser.id, user.id, today, deadline, isLate, dbUser.department_id);
  const reportId = reportResult.lastInsertRowid;

  Reports.saveContent(reportId, 'daily_report', `Daily Report (${todayDisplay})`, dailyReport);
  Reports.saveContent(reportId, 'todo_tomorrow', `To-Do List (${tomorrowDisplay})`, todoTomorrow);
  if (meetingTodo.trim()) {
    Reports.saveContent(reportId, 'meeting_todo', 'Meeting To-Do', meetingTodo);
  }
  Reports.setQualityScore(reportId, qualityScore, wordCount);

  // Streak
  Streaks.update(guildId, user.id, today);
  const streak = Streaks.get(guildId, user.id);

  // Smart state
  const smartState = SmartState.get(guildId, user.id);
  SmartState.upsert(guildId, user.id, {
    avg_submit_hour: new Date().getHours(),
    late_count_30d: (smartState?.late_count_30d || 0) + (isLate ? 1 : 0),
    consecutive_low_confidence: 0
  });

  // Build response embed
  const displayName = interaction.member?.displayName || user.username;
  const statusIcon = isLate ? '🔴' : '🟢';
  const streakText = streak?.current_streak > 1 ? `  🔥 ${streak.current_streak}-day streak` : '';

  const embed = new EmbedBuilder()
    .setColor(isLate ? Colors.warning : Colors.success)
    .setTitle(`${statusIcon}  Daily Report — ${displayName}`)
    .setDescription(`**${todayDisplay}**  ·  ${isLate ? 'Late Submission' : 'On Time'}${streakText}`)
    .addFields(
      { name: `📋 Daily Report (${todayDisplay})`, value: formatList(dailyReport), inline: false },
      { name: `📝 To-Do List (${tomorrowDisplay})`, value: formatList(todoTomorrow), inline: false },
    );

  if (meetingTodo.trim()) {
    embed.addFields({ name: '🗓️ Meeting To-Do', value: formatList(meetingTodo), inline: false });
  }

  embed.setFooter({ text: `Quality: ${qualityScore}/10  ·  Words: ${wordCount}` }).setTimestamp();

  await modalSubmit.editReply({ embeds: [embed] });

  if (isLowEffort && warning) {
    await modalSubmit.followUp({ embeds: [warningEmbed('Report Quality', warning)], ephemeral: true });
  }

  // Post to summary channels
  await postToSummaryChannels(interaction.guild, guildId, embed, dbUser.department_id);
  Reports.setSummaryPosted(reportId);

  logger.info(`Report: ${user.username} | ${today} | Late:${isLate} | Q:${qualityScore}`);
}

async function postToSummaryChannels(guild, guildId, embed, deptId) {
  const channels = SummaryChannels.getAll(guildId, 'daily', deptId);
  for (const sc of channels) {
    try {
      const ch = guild.channels.cache.get(sc.channel_id);
      if (ch) await ch.send({ embeds: [embed] });
    } catch (err) {
      logger.warn(`Summary post failed: ${err.message}`);
    }
  }
}

function formatList(text) {
  if (!text?.trim()) return '—';
  return text.trim().slice(0, 1000);
}
