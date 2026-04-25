// src/events/ready.js
import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { initScheduler } from '../scheduler/scheduler.js';
import { Users, Reminders, ReportFields, Settings } from '../database/db.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  logger.info(`🤖 Bot online as ${client.user.tag}`);
  logger.info(`📡 Serving ${client.guilds.cache.size} guild(s)`);

  // Init defaults for each guild
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      ReportFields.initDefaults(guildId);
      Reminders.initDefaults(guildId);
      logger.info(`  ✓ Initialized guild: ${guild.name} (${guildId})`);
    } catch (err) {
      logger.error(`Failed to init guild ${guildId}: ${err.message}`);
    }
  }

  // Start scheduler
  initScheduler(client);

  // Set activity
  client.user.setPresence({
    activities: [{ name: '📋 Daily Reports | /report', type: 3 }], // WATCHING
    status: 'online'
  });

  logger.info('✅ Bot fully operational');
}
