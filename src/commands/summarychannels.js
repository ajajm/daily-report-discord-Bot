// src/commands/summarychannels.js
import { SlashCommandBuilder } from 'discord.js';
import { SummaryChannels } from '../database/db.js';
import { requireAdmin } from '../utils/permissions.js';
import { successEmbed, errorEmbed, infoEmbed } from '../utils/embeds.js';
import { EmbedBuilder } from 'discord.js';
import { Colors } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('summarychannel')
  .setDescription('Manage summary/digest channels')
  .addSubcommand(s => s.setName('add').setDescription('Add a summary channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to post summaries in').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Type of summary').addChoices(
      { name: 'Daily Reports', value: 'daily' },
      { name: 'Weekly Summary', value: 'weekly' },
      { name: 'Monthly Summary', value: 'monthly' },
      { name: 'Alerts Only', value: 'alerts' },
    )))
  .addSubcommand(s => s.setName('remove').setDescription('Remove a summary channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to remove').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('List all summary channels'));

export async function execute(interaction) {
  const perm = requireAdmin(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  const { guildId } = interaction;
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const ch = interaction.options.getChannel('channel');
    const type = interaction.options.getString('type') || 'daily';
    SummaryChannels.add(guildId, ch.id, ch.name, type);
    return interaction.reply({ embeds: [successEmbed('Summary Channel Added', `<#${ch.id}> will now receive **${type}** summaries.`)] });
  }

  if (sub === 'remove') {
    const ch = interaction.options.getChannel('channel');
    SummaryChannels.remove(guildId, ch.id);
    return interaction.reply({ embeds: [successEmbed('Summary Channel Removed', `<#${ch.id}> removed from summary channels.`)] });
  }

  if (sub === 'list') {
    const channels = SummaryChannels.getAll(guildId);
    if (!channels.length) return interaction.reply({ embeds: [infoEmbed('No Summary Channels', 'No summary channels configured. Use `/summarychannel add`.')], ephemeral: true });
    const lines = channels.map(c => `<#${c.channel_id}> — [**${c.type}**]`);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(Colors.primary).setTitle('📢  Summary Channels').setDescription(lines.join('\n')).setTimestamp()]
    });
  }
}
