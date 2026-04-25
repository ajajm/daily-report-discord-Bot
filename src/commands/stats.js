// src/commands/stats.js
import { SlashCommandBuilder } from 'discord.js';
import { Users, Reports, Streaks, Feedback, MissedReports } from '../database/db.js';
import { statsEmbed, errorEmbed } from '../utils/embeds.js';
import { todayStr } from '../utils/time.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('View performance stats')
  .addUserOption(o => o.setName('user').setDescription('User to check (manager only)').setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply();
  const { guildId } = interaction;

  let target = interaction.options.getUser('user');
  if (target && target.id !== interaction.user.id) {
    // Only managers can view others
    const isManager = interaction.member.permissions.has('Administrator') ||
      interaction.member.roles.cache.some(r => r.name === 'Manager' || r.name === 'Founder');
    if (!isManager) {
      return interaction.editReply({ embeds: [errorEmbed('No Permission', 'Only managers can view other users\' stats.')] });
    }
  }
  if (!target) target = interaction.user;

  const dbUser = Users.get(guildId, target.id);
  if (!dbUser) {
    return interaction.editReply({ embeds: [errorEmbed('Not Found', `<@${target.id}> is not registered in the system.`)] });
  }

  const reportStats = Reports.getUserStats(guildId, target.id);
  const streak = Streaks.get(guildId, target.id);
  const feedbackHistory = Feedback.getForUser(guildId, target.id, 5);
  const missedThisMonth = MissedReports.getMonthlyCount(guildId, target.id);
  const consecutive = MissedReports.getConsecutive(guildId, target.id);

  const embed = statsEmbed(dbUser, reportStats, streak, feedbackHistory);
  embed.addFields(
    { name: '❌ Missed This Month', value: `\`${missedThisMonth}\``, inline: true },
    { name: '🔴 Consecutive Misses', value: `\`${consecutive}\``, inline: true }
  );

  if (feedbackHistory.length) {
    const fbLines = feedbackHistory.slice(0, 3).map(f => {
      const icon = { feedback: '💬', score: '⭐', praise: '🏆', flag: '🚩' }[f.type] || '📝';
      return `${icon} **${f.type}**: ${f.content || `Score: ${f.score}/10`}`;
    });
    embed.addFields({ name: '📝 Recent Manager Feedback', value: fbLines.join('\n'), inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}
