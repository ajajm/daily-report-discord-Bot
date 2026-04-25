// src/events/interactionCreate.js
import { Events, InteractionType } from 'discord.js';
import { logger } from '../utils/logger.js';
import { errorEmbed } from '../utils/embeds.js';

export const name = Events.InteractionCreate;
export const once = false;

export async function execute(interaction, client) {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Unknown command: ${interaction.commandName}`);
      return;
    }
    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(`Command error [${interaction.commandName}]: ${err.message}\n${err.stack}`);
      const embed = errorEmbed('Command Error', 'Something went wrong. Please try again.\n```' + err.message + '```');
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  // Button interactions (future: approve/deny buttons)
  if (interaction.isButton()) {
    const [action, ...args] = interaction.customId.split('_');
    // Extensible button handler
    logger.debug(`Button interaction: ${interaction.customId}`);
    return;
  }
}
