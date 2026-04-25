// src/commands/viewassignments.js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Users, Streaks } from '../database/db.js';
import { requireManager } from '../utils/permissions.js';
import { errorEmbed, Colors } from '../utils/embeds.js';
import { todayStr } from '../utils/time.js';
import { Reports } from '../database/db.js';

export const data = new SlashCommandBuilder()
  .setName('viewassignments')
  .setDescription('View all user-channel report assignments');

export async function execute(interaction) {
  const perm = requireManager(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  const users = Users.getAll(interaction.guildId);
  if (!users.length) {
    return interaction.reply({ embeds: [errorEmbed('No Assignments', 'No users have been assigned yet. Use `/assignreport` to get started.')], ephemeral: true });
  }

  const today = todayStr(interaction.guildId);
  const todayReports = Reports.getTodayAll(interaction.guildId, today);
  const submittedIds = new Set(todayReports.map(r => r.discord_id));

  const rows = users.map(u => {
    const status = submittedIds.has(u.discord_id) ? '✅' : '⏳';
    const ch = u.report_channel ? `<#${u.report_channel}>` : '_unassigned_';
    const dept = u.dept_name ? ` · ${u.dept_name}` : '';
    return `${status} <@${u.discord_id}>${dept} → ${ch}`;
  });

  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setTitle('📋  Report Assignments')
    .setDescription(rows.join('\n'))
    .addFields({ name: '📊 Today', value: `${submittedIds.size} / ${users.length} submitted`, inline: true })
    .setTimestamp()
    .setFooter({ text: `✅ Submitted  ⏳ Pending` });

  await interaction.reply({ embeds: [embed] });
}
