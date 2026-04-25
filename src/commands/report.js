// src/commands/report.js
import {
  SlashCommandBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, EmbedBuilder
} from 'discord.js';
import { Reports, GuildSettings } from '../database/db.js';
import moment from 'moment-timezone';

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Submit your daily report');

export async function execute(interaction) {
  const { user, guildId } = interaction;
  const tz = GuildSettings.getTimezone(guildId);
  const now = moment().tz(tz);
  const todayStr = now.format('YYYY-MM-DD');
  
  const todayDisplay = now.format('DD MMM YYYY');
  const tomorrowDisplay = now.clone().add(1, 'day').format('DD MMM YYYY');

  // Build modal
  const modal = new ModalBuilder()
    .setCustomId(`report_modal_${user.id}`)
    .setTitle('📋  Daily Report');

  const dailyInput = new TextInputBuilder()
    .setCustomId('daily_report')
    .setLabel(`Daily report (${todayDisplay})`)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setPlaceholder('What did you do today?');

  const todoInput = new TextInputBuilder()
    .setCustomId('todo_list')
    .setLabel(`Todo list (${tomorrowDisplay})`)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setPlaceholder('What will you do tomorrow?');

  modal.addComponents(
    new ActionRowBuilder().addComponents(dailyInput),
    new ActionRowBuilder().addComponents(todoInput)
  );

  await interaction.showModal(modal);

  // Await submission
  let modalSubmit;
  try {
    modalSubmit = await interaction.awaitModalSubmit({
      filter: i => i.customId === `report_modal_${user.id}` && i.user.id === user.id,
      time: 15 * 60 * 1000 // 15 mins
    });
  } catch {
    return; // Timeout
  }

  const dailyText = modalSubmit.fields.getTextInputValue('daily_report');
  const todoText = modalSubmit.fields.getTextInputValue('todo_list');

  // User can submit infinite reports (we just add a new row)
  const displayName = interaction.member?.displayName || user.username;
  Reports.create(
    guildId,
    user.id,
    user.username,
    displayName,
    dailyText,
    todoText,
    todayStr
  );

  // Send confirmation
  const desc = [
    `<@${user.id}>`,
    `Daily report (${todayDisplay})`,
    dailyText,
    ``,
    `To-Do List (${tomorrowDisplay})`,
    todoText
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setDescription(desc);

  await modalSubmit.reply({ embeds: [embed], ephemeral: true });
}
