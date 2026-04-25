// src/commands/feedback.js
// Manager review tools: /feedback, /score, /praise, /flag

import { SlashCommandBuilder } from 'discord.js';
import { Feedback, Users, Reports, Settings } from '../database/db.js';
import { requireManager } from '../utils/permissions.js';
import { successEmbed, errorEmbed, Colors } from '../utils/embeds.js';
import { todayStr } from '../utils/time.js';
import { EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('feedback')
  .setDescription('Manager tools: feedback, scoring, praise, flags')
  .addSubcommand(s => s.setName('give').setDescription('Give feedback to a user')
    .addUserOption(o => o.setName('user').setDescription('Team member').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Feedback message').setRequired(true)))
  .addSubcommand(s => s.setName('score').setDescription('Score a user\'s report (1–10)')
    .addUserOption(o => o.setName('user').setDescription('Team member').setRequired(true))
    .addIntegerOption(o => o.setName('score').setDescription('Score 1–10').setMinValue(1).setMaxValue(10).setRequired(true))
    .addStringOption(o => o.setName('date').setDescription('Report date YYYY-MM-DD (default: today)')))
  .addSubcommand(s => s.setName('praise').setDescription('Publicly praise a user')
    .addUserOption(o => o.setName('user').setDescription('Team member').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Praise message')))
  .addSubcommand(s => s.setName('flag').setDescription('Flag a user with a concern')
    .addUserOption(o => o.setName('user').setDescription('Team member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for flagging').setRequired(true)))
  .addSubcommand(s => s.setName('history').setDescription('View feedback history for a user')
    .addUserOption(o => o.setName('user').setDescription('Team member').setRequired(true)));

export async function execute(interaction) {
  const perm = requireManager(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  const sub = interaction.options.getSubcommand();
  const { guildId } = interaction;
  const managerId = interaction.user.id;

  if (sub === 'give') {
    const target = interaction.options.getUser('user');
    const message = interaction.options.getString('message');
    Users.upsert(guildId, target.id, target.username, target.username);
    Feedback.add(guildId, target.id, managerId, 'feedback', message);
    await interaction.reply({
      embeds: [successEmbed('Feedback Recorded', `Feedback given to <@${target.id}>:\n> ${message}`)]
    });
    // DM user
    try {
      await target.send({
        embeds: [new EmbedBuilder()
          .setColor(Colors.info)
          .setTitle('💬  Manager Feedback')
          .setDescription(message)
          .setFooter({ text: `From your manager • ${interaction.guild.name}` })
          .setTimestamp()
        ]
      });
    } catch { /* DMs closed */ }
    return;
  }

  if (sub === 'score') {
    const target = interaction.options.getUser('user');
    const score = interaction.options.getInteger('score');
    const date = interaction.options.getString('date') || todayStr(guildId);
    Reports.setScore(guildId, target.id, date, score);
    Feedback.add(guildId, target.id, managerId, 'score', `Manager score: ${score}/10`, score);
    return interaction.reply({
      embeds: [successEmbed('Score Recorded', `<@${target.id}>'s report for **${date}** scored **${score}/10** ⭐`)]
    });
  }

  if (sub === 'praise') {
    const target = interaction.options.getUser('user');
    const message = interaction.options.getString('message') || 'Great work today! Keep it up. 🎉';
    Feedback.add(guildId, target.id, managerId, 'praise', message);
    // Post praise publicly in user's channel if possible
    const dbUser = Users.get(guildId, target.id);
    if (dbUser?.report_channel) {
      const ch = interaction.guild.channels.cache.get(dbUser.report_channel);
      if (ch) await ch.send({
        embeds: [new EmbedBuilder()
          .setColor(Colors.gold)
          .setTitle('🏆  Manager Recognition')
          .setDescription(`<@${target.id}>\n\n${message}`)
          .setFooter({ text: `By ${interaction.user.username}` })
          .setTimestamp()
        ]
      });
    }
    return interaction.reply({ embeds: [successEmbed('Praise Posted', `<@${target.id}> has been praised! 🏆`)] });
  }

  if (sub === 'flag') {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    Feedback.add(guildId, target.id, managerId, 'flag', reason);
    const alertCh = Settings.get(guildId, 'alert_channel');
    if (alertCh) {
      const ch = interaction.guild.channels.cache.get(alertCh);
      if (ch) await ch.send({
        embeds: [new EmbedBuilder()
          .setColor(Colors.danger)
          .setTitle('🚩  User Flagged')
          .setDescription(`**User:** <@${target.id}>\n**Reason:** ${reason}\n**By:** <@${managerId}>`)
          .setTimestamp()
        ]
      });
    }
    return interaction.reply({ embeds: [successEmbed('Flag Recorded', `<@${target.id}> has been flagged.\n> ${reason}`)], ephemeral: true });
  }

  if (sub === 'history') {
    const target = interaction.options.getUser('user');
    const history = Feedback.getForUser(guildId, target.id, 15);
    if (!history.length) return interaction.reply({ embeds: [errorEmbed('No History', `No feedback recorded for <@${target.id}>.`)], ephemeral: true });
    const lines = history.map(f => {
      const icon = { feedback: '💬', score: '⭐', praise: '🏆', flag: '🚩' }[f.type] || '📝';
      const content = f.content || `Score: ${f.score}/10`;
      const date = new Date(f.created_at).toLocaleDateString('en-IN');
      return `${icon} [${date}] **${f.type}** — ${content}`;
    });
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(Colors.purple)
        .setTitle(`📝  Feedback History — ${target.username}`)
        .setDescription(lines.join('\n'))
        .setTimestamp()
      ]
    });
  }
}
