// src/commands/assignreport.js
import { SlashCommandBuilder } from 'discord.js';
import { Users } from '../database/db.js';
import { requireAdmin } from '../utils/permissions.js';
import { successEmbed, errorEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('assignreport')
  .setDescription('Assign a user to a report channel')
  .addUserOption(o => o.setName('user').setDescription('Team member').setRequired(true))
  .addChannelOption(o => o.setName('channel').setDescription('Their report channel').setRequired(true));

export async function execute(interaction) {
  const perm = requireAdmin(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  const target = interaction.options.getUser('user');
  const channel = interaction.options.getChannel('channel');
  const { guildId } = interaction;

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  const displayName = member?.displayName || target.username;

  Users.upsert(guildId, target.id, target.username, displayName, channel.id);

  await interaction.reply({
    embeds: [successEmbed('Assignment Saved', `<@${target.id}> is now assigned to <#${channel.id}>.\nThey can submit \`/report\` only in that channel.`,
      [{ name: '📋 Channel', value: `<#${channel.id}>`, inline: true }, { name: '👤 User', value: `<@${target.id}>`, inline: true }]
    )]
  });
}
