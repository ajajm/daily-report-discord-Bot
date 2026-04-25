// src/commands/setreportformat.js
// Dynamic report field configuration

import { SlashCommandBuilder } from 'discord.js';
import { ReportFields } from '../database/db.js';
import { requireAdmin } from '../utils/permissions.js';
import { successEmbed, errorEmbed, infoEmbed } from '../utils/embeds.js';
import { EmbedBuilder } from 'discord.js';
import { Colors } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('reportformat')
  .setDescription('Manage report field format')
  .addSubcommand(s => s.setName('view').setDescription('View current report fields'))
  .addSubcommand(s => s.setName('add').setDescription('Add a custom report field')
    .addStringOption(o => o.setName('key').setDescription('Unique field key e.g. revenue_impact').setRequired(true))
    .addStringOption(o => o.setName('label').setDescription('Display label').setRequired(true))
    .addStringOption(o => o.setName('placeholder').setDescription('Placeholder text'))
    .addStringOption(o => o.setName('type').setDescription('Field type').addChoices(
      { name: 'Paragraph (long text)', value: 'paragraph' },
      { name: 'Short text', value: 'short' },
    ))
    .addBooleanOption(o => o.setName('required').setDescription('Is this field required?'))
    .addIntegerOption(o => o.setName('maxlength').setDescription('Max characters (default 500)')))
  .addSubcommand(s => s.setName('remove').setDescription('Remove a field by key')
    .addStringOption(o => o.setName('key').setDescription('Field key to remove').setRequired(true)))
  .addSubcommand(s => s.setName('reset').setDescription('Reset to default report format'));

export async function execute(interaction) {
  const perm = requireAdmin(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  const { guildId } = interaction;
  const sub = interaction.options.getSubcommand();

  if (sub === 'view') {
    ReportFields.initDefaults(guildId);
    const fields = ReportFields.getForGuild(guildId);
    if (!fields.length) return interaction.reply({ embeds: [infoEmbed('No Fields', 'No report fields set.')], ephemeral: true });
    const lines = fields.map((f, i) => `${i + 1}. **${f.label}** \`[${f.field_key}]\`  ${f.is_required ? '🔴 Required' : '⚪ Optional'}  max:${f.max_length}`);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(Colors.primary).setTitle('📋  Report Format Fields').setDescription(lines.join('\n')).setFooter({ text: 'Discord modals support max 5 active fields' }).setTimestamp()]
    });
  }

  if (sub === 'add') {
    const key = interaction.options.getString('key').toLowerCase().replace(/\s+/g, '_');
    const label = interaction.options.getString('label');
    const placeholder = interaction.options.getString('placeholder') || '';
    const type = interaction.options.getString('type') || 'paragraph';
    const required = interaction.options.getBoolean('required') ?? false;
    const maxLen = interaction.options.getInteger('maxlength') || 500;
    // Find next sort order
    const existing = ReportFields.getForGuild(guildId);
    const order = (existing[existing.length - 1]?.sort_order || 0) + 1;
    ReportFields.addField(guildId, null, key, label, placeholder, type, required, maxLen, order);
    return interaction.reply({ embeds: [successEmbed('Field Added', `Field **${label}** (\`${key}\`) added to report format.`)] });
  }

  if (sub === 'remove') {
    const key = interaction.options.getString('key');
    ReportFields.removeField(guildId, key);
    return interaction.reply({ embeds: [successEmbed('Field Removed', `Field \`${key}\` has been removed from the report format.`)] });
  }

  if (sub === 'reset') {
    ReportFields.resetToDefaults(guildId);
    return interaction.reply({ embeds: [successEmbed('Format Reset', 'Report format has been reset to default 8-field template.')] });
  }
}
