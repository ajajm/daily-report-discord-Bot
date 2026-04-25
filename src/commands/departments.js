// src/commands/departments.js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Departments, Users } from '../database/db.js';
import { requireAdmin } from '../utils/permissions.js';
import { successEmbed, errorEmbed, Colors } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('department')
  .setDescription('Manage departments')
  .addSubcommand(s => s.setName('create').setDescription('Create a new department')
    .addStringOption(o => o.setName('name').setDescription('Department name').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Description'))
    .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #FF6B35'))
    .addStringOption(o => o.setName('icon').setDescription('Emoji icon')))
  .addSubcommand(s => s.setName('delete').setDescription('Delete a department')
    .addStringOption(o => o.setName('name').setDescription('Department name').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('List all departments'))
  .addSubcommand(s => s.setName('assign').setDescription('Assign a user to a department')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('name').setDescription('Department name').setRequired(true)));

export async function execute(interaction) {
  const perm = requireAdmin(interaction);
  if (!perm.allowed) return interaction.reply({ embeds: [errorEmbed('No Permission', perm.reason)], ephemeral: true });

  const { guildId } = interaction;
  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    const name = interaction.options.getString('name');
    const desc = interaction.options.getString('description') || '';
    const color = interaction.options.getString('color') || '#5865F2';
    const icon = interaction.options.getString('icon') || '🏢';
    try {
      Departments.create(guildId, name, desc, color, icon);
      return interaction.reply({ embeds: [successEmbed('Department Created', `${icon} **${name}** department created.\n${desc}`)] });
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Already Exists', `A department named **${name}** already exists.`)], ephemeral: true });
    }
  }

  if (sub === 'delete') {
    const name = interaction.options.getString('name');
    Departments.delete(guildId, name);
    return interaction.reply({ embeds: [successEmbed('Deleted', `Department **${name}** deleted.`)] });
  }

  if (sub === 'list') {
    const depts = Departments.getAll(guildId);
    if (!depts.length) return interaction.reply({ embeds: [errorEmbed('No Departments', 'No departments created yet.')], ephemeral: true });
    const lines = depts.map(d => `${d.icon} **${d.name}**${d.description ? ` — ${d.description}` : ''}`);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(Colors.primary).setTitle('🏢  Departments').setDescription(lines.join('\n')).setTimestamp()]
    });
  }

  if (sub === 'assign') {
    const target = interaction.options.getUser('user');
    const name = interaction.options.getString('name');
    const dept = Departments.get(guildId, name);
    if (!dept) return interaction.reply({ embeds: [errorEmbed('Not Found', `Department **${name}** not found.`)], ephemeral: true });
    Users.upsert(guildId, target.id, target.username, target.username, null, dept.id);
    Users.setDepartment(guildId, target.id, dept.id);
    return interaction.reply({ embeds: [successEmbed('Assigned', `<@${target.id}> assigned to **${dept.icon} ${dept.name}**`)] });
  }
}
