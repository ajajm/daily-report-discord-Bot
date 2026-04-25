// src/commands/settings.js
// Server-wide configuration command

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Settings } from '../database/db.js';
import { requireAdmin } from '../utils/permissions.js';
import { successEmbed, errorEmbed, Colors } from '../utils/embeds.js';
import { formatTime } from '../utils/time.js';

export const data = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('View or update bot settings')
  .addSubcommand(s => s.setName('view').setDescription('View current settings'))
  .addSubcommand(s => s.setName('alertchannel').setDescription('Set the alert/manager channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel for alerts').setRequired(true)))
  .addSubcommand(s => s.setName('managerrole').setDescription('Set the manager role name')
    .addStringOption(o => o.setName('role').setDescription('Role name e.g. Manager').setRequired(true)))
  .addSubcommand(s => s.setName('weeklyreport').setDescription('Toggle weekly Sunday summary')
    .addStringOption(o => o.setName('state').setDescription('on/off').setRequired(true).addChoices(
      { name: 'On', value: 'on' }, { name: 'Off', value: 'off' }
    )))
  .addSubcommand(s => s.setName('smartreminders').setDescription('Toggle smart/adaptive reminders')
    .addStringOption(o => o.setName('state').setDescription('on/off').setRequired(true).addChoices(
      { name: 'On', value: 'on' }, { name: 'Off', value: 'off' }
    )))
  .addSubcommand(s => s.setName('qualitycheck').setDescription('Toggle quality control warnings')
    .addStringOption(o => o.setName('state').setDescription('on/off').setRequired(true).addChoices(
      { name: 'On', value: 'on' }, { name: 'Off', value: 'off' }
    )));

export async function execute(interaction) {
  const perm = requireAdmin(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  const { guildId } = interaction;
  const sub = interaction.options.getSubcommand();

  if (sub === 'view') {
    const s = Settings.getAll(guildId);
    const deadline = s.deadline || process.env.DEFAULT_DEADLINE || '21:00';
    const tz = s.timezone || process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata';
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(Colors.primary)
        .setTitle('⚙️  Bot Settings')
        .addFields(
          { name: '⏱ Deadline',          value: formatTime(deadline),               inline: true },
          { name: '🌍 Timezone',          value: tz,                                 inline: true },
          { name: '👔 Manager Role',      value: s.manager_role || 'Manager',        inline: true },
          { name: '📢 Alert Channel',     value: s.alert_channel ? `<#${s.alert_channel}>` : 'Not set', inline: true },
          { name: '📋 Weekly Report',     value: s.weekly_report === false ? 'Off' : 'On', inline: true },
          { name: '🧠 Smart Reminders',   value: s.smart_reminders === false ? 'Off' : 'On', inline: true },
          { name: '🔍 Quality Check',     value: s.quality_check === false ? 'Off' : 'On', inline: true },
          { name: '💌 DM Reminders',      value: s.dm_reminders === false ? 'Off' : 'On', inline: true },
        )
        .setTimestamp()
      ]
    });
  }

  if (sub === 'alertchannel') {
    const ch = interaction.options.getChannel('channel');
    Settings.set(guildId, 'alert_channel', ch.id);
    return interaction.reply({ embeds: [successEmbed('Alert Channel Set', `Alerts will be posted in <#${ch.id}>`)] });
  }

  if (sub === 'managerrole') {
    const role = interaction.options.getString('role');
    Settings.set(guildId, 'manager_role', role);
    return interaction.reply({ embeds: [successEmbed('Manager Role Updated', `Manager role set to **${role}**`)] });
  }

  if (sub === 'weeklyreport') {
    const state = interaction.options.getString('state') === 'on';
    Settings.set(guildId, 'weekly_report', state);
    return interaction.reply({ embeds: [successEmbed('Weekly Report', `Weekly auto-summary is now **${state ? 'ON' : 'OFF'}**`)] });
  }

  if (sub === 'smartreminders') {
    const state = interaction.options.getString('state') === 'on';
    Settings.set(guildId, 'smart_reminders', state);
    return interaction.reply({ embeds: [successEmbed('Smart Reminders', `Smart/adaptive reminders are now **${state ? 'ON' : 'OFF'}**`)] });
  }

  if (sub === 'qualitycheck') {
    const state = interaction.options.getString('state') === 'on';
    Settings.set(guildId, 'quality_check', state);
    return interaction.reply({ embeds: [successEmbed('Quality Check', `Report quality control is now **${state ? 'ON' : 'OFF'}**`)] });
  }
}
