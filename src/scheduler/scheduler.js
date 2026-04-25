// src/scheduler/scheduler.js
import cron from 'node-cron';
import moment from 'moment-timezone';
import { getDb, ReminderConfigs, SummaryConfigs, Reports, GuildSettings } from '../database/db.js';
import { EmbedBuilder } from 'discord.js';

let client;

export function initScheduler(discordClient) {
  client = discordClient;

  // Check every minute
  cron.schedule('* * * * *', () => tick());
  console.log('[Scheduler] Initialized');
}

async function tick() {
  if (!client?.guilds?.cache) return;

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      await processGuild(guildId, guild);
    } catch (err) {
      console.error(`[Scheduler] Error for guild ${guildId}:`, err);
    }
  }
}

async function processGuild(guildId, guild) {
  const tz = GuildSettings.getTimezone(guildId);
  const now = moment().tz(tz);
  const currentTime = now.format('HH:mm');
  const todayStr = now.format('YYYY-MM-DD');

  // ── 1. Process Reminders ──────────────────────────────────
  const reminders = ReminderConfigs.getAll(guildId);
  for (const r of reminders) {
    if (r.send_time === currentTime && r.last_fired !== todayStr) {
      // Check interval logic
      let shouldFire = false;
      if (!r.last_fired) {
        shouldFire = true;
      } else {
        const lastFiredMoment = moment.tz(r.last_fired, 'YYYY-MM-DD', tz);
        const diffDays = now.diff(lastFiredMoment, 'days');
        
        if (r.interval_type === 'daily' && diffDays >= 1) shouldFire = true;
        if (r.interval_type === 'weekly' && diffDays >= 7) shouldFire = true;
        if (r.interval_type === 'monthly' && diffDays >= 28 && now.date() === lastFiredMoment.date()) shouldFire = true; // rough monthly
        if (r.interval_type === 'monthly' && diffDays >= 31) shouldFire = true; 
      }

      if (shouldFire) {
        await fireReminder(guild, r, todayStr, tz);
      }
    }
  }

  // ── 2. Process Summaries ──────────────────────────────────
  const summaries = SummaryConfigs.getAll(guildId);
  for (const s of summaries) {
    if (s.send_time === currentTime && s.last_fired !== todayStr) {
      await fireSummary(guild, s, todayStr, tz);
    }
  }
}

async function fireReminder(guild, r, todayStr, tz) {
  try {
    const ch = guild.channels.cache.get(r.channel_id);
    if (!ch) return;

    let content = '**Please send your daily report**\n*in the below given format using `/report` cmd*';
    if (r.user_id) {
      content += `\n<@${r.user_id}>`;
    }

    const todayDisplay = moment().tz(tz).format('DD MMM YYYY');
    const tomorrowDisplay = moment().tz(tz).add(1, 'day').format('DD MMM YYYY');

    const desc = [
      `Daily report (${todayDisplay})`,
      `1.`,
      `2.`,
      ``,
      `To-Do List (${tomorrowDisplay})`,
      `1.`,
      `2.`,
      ``,
      `Days when we have the team meeting include:`,
      `*To do list (until the next meeting)*`
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xFEE75C) // Yellow/Gold color from screenshot
      .setDescription(desc);

    await ch.send({ content: content, embeds: [embed] });
    ReminderConfigs.setLastFired(r.id, todayStr);
    console.log(`[Scheduler] Fired reminder #${r.id} for guild ${guild.id}`);
  } catch (err) {
    console.error(`[Scheduler] Failed to send reminder #${r.id}:`, err);
  }
}

async function fireSummary(guild, s, todayStr, tz) {
  try {
    // Get all pending reports
    const pendingReports = Reports.getPending(guild.id);
    if (!pendingReports.length) {
      ReminderConfigs.setLastFired(s.id, todayStr); // update so it doesn't try again
      return; // Nothing to send
    }

    const ch = guild.channels.cache.get(s.channel_id);
    if (!ch) return;

    const todayDisplay = moment().tz(tz).format('DD MMM YYYY');
    const tomorrowDisplay = moment().tz(tz).add(1, 'day').format('DD MMM YYYY');

    // Group reports by user (they can send infinite, but we should show all or group them)
    // The requirement says: "Shows all user report in single embedded format like this: User1... User2..."
    const embeds = [];
    let currentEmbed = new EmbedBuilder()
      .setColor(0xFEE75C);
    
    let desc = '';

    for (const r of pendingReports) {
      const repDate = moment.tz(r.report_date, 'YYYY-MM-DD', tz).format('DD MMM YYYY');
      const nextDate = moment.tz(r.report_date, 'YYYY-MM-DD', tz).add(1, 'day').format('DD MMM YYYY');

      const block = [
        `<@${r.discord_id}>`,
        `Daily report (${repDate})`,
        r.daily_report,
        ``,
        `To-Do List (${nextDate})`,
        r.todo_list,
        `\n${'─'.repeat(30)}\n`
      ].join('\n');

      if (desc.length + block.length > 3800) {
        embeds.push(currentEmbed.setDescription(desc));
        desc = '';
        currentEmbed = new EmbedBuilder().setColor(0xFEE75C);
      }
      desc += block;
    }

    if (desc) {
      embeds.push(currentEmbed.setDescription(desc));
    }

    await ch.send({
      content: s.ping_content ? s.ping_content : undefined,
      embeds: embeds.slice(0, 10) // Discord max 10 embeds per message
    });

    // Mark as sent
    Reports.markSent(pendingReports.map(r => r.id));
    SummaryConfigs.setLastFired(s.id, todayStr);

    console.log(`[Scheduler] Fired summary #${s.id} for guild ${guild.id} (${pendingReports.length} reports)`);
  } catch (err) {
    console.error(`[Scheduler] Failed to send summary #${s.id}:`, err);
  }
}
