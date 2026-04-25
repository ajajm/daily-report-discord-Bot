// src/commands/removeassignment.js
import { SlashCommandBuilder } from 'discord.js';
import { Users } from '../database/db.js';
import { requireAdmin } from '../utils/permissions.js';
import { successEmbed, errorEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('removeassignment')
  .setDescription('Remove a user\'s report channel assignment')
  .addUserOption(o => o.setName('user').setDescription('Team member').setRequired(true));

export async function execute(interaction) {
  const perm = requireAdmin(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  const target = interaction.options.getUser('user');
  Users.removeChannel(interaction.guildId, target.id);

  await interaction.reply({
    embeds: [successEmbed('Assignment Removed', `<@${target.id}>'s report channel assignment has been cleared.`)]
  });
}
