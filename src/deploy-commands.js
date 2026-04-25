// src/deploy-commands.js
// Register all slash commands to Discord API

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of files) {
  const filePath = pathToFileURL(path.join(commandsPath, file)).href;
  const command = await import(filePath);
  if (command.data) {
    commands.push(command.data.toJSON());
    logger.info(`  ✓ Queued: /${command.data.name}`);
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

logger.info(`Deploying ${commands.length} slash commands...`);

try {
  const guildId = process.env.DISCORD_GUILD_ID;
  let data;
  if (guildId) {
    // Guild-specific (instant, for dev)
    data = await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
      { body: commands }
    );
    logger.info(`✅ Deployed ${data.length} commands to guild ${guildId} (instant)`);
  } else {
    // Global (up to 1 hour propagation)
    data = await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    logger.info(`✅ Deployed ${data.length} commands globally`);
  }
} catch (err) {
  logger.error(`Deploy failed: ${err.message}`);
  process.exit(1);
}
