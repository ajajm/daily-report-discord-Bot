// src/scheduler/scheduler.js
// Cron-based scheduler: reminders, missed reports, weekly summary, smart logic

import cron from 'node-cron';
import moment from 'moment-timezone';
import { getDb, Users, Reminders, Reports, Streaks, Settings, MissedReports, SummaryChannels, SmartState, Feedback } from '../database/db.js';
import { todayStr, getGuildTimezone, parseTime, formatTime, getDeadlineStr } from '../utils/time.js';
import { reminderEmbed, weeklyReportEmbed, warningEmbed, Colors } from '../utils/embeds.js';
import { analyzeSmartReminder } from '../utils/quality.js';
import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

let client;

export function initScheduler(discordClient) {
  client = discordClient;

  // Main tick — runs every minute
  cron.schedule('* * * * *', () => tick());

  // Midnight reset — break streaks for no-shows, log missed reports
  cron.schedule('1 0 * * *', () => midnightReset());

  // Weekly summary — every Sunday at 23:00 server timezone (approximate, refined in tick)
  // We handle this inside tick() based on guild timezone

  logger.info('✅ Scheduler initialized');
}

// ── Main Tick ────────────────────────────────────────────────
async function tick() {
  if (!client?.guilds?.cache) return;

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      await processGuild(guildId, guild);
    } catch (err) {
      logger.error(`Scheduler tick error for guild ${guildId}: ${err.message}`);
    }
  }
}

async function processGuild(guildId, guild) {
  const tz = getGuildTimezone(guildId);
  const now = moment().tz(tz);
  const currentTime = now.format('HH:mm');
  const today = now.format('YYYY-MM-DD');
  const dayOfWeek = now.day(); // 0=Sun

  // ── Report-deadline reminders (HH:MM style) ─────────────
  const reportReminders = Reminders.getReportReminders(guildId);
  for (const reminder of reportReminders) {
    if (reminder.reminder_time === currentTime) {
      await fireReportReminder(guildId, guild, reminder, today, tz);
    }
  }

  // ── fire_at-based reminders (one-time & recurring) ──────
  await processDueReminders(guild);

  // ── Smart Reminder Check (early, motivational) ───────────
  const smartEnabled = Settings.get(guildId, 'smart_reminders', true);
  if (smartEnabled) {
    await checkSmartReminders(guildId, guild, now, today);
  }

  // ── Weekly Summary ───────────────────────────────────────
  const weeklyEnabled = Settings.get(guildId, 'weekly_report', true);
  if (weeklyEnabled && dayOfWeek === 0 && currentTime === '23:00') {
    await postWeeklySummary(guildId, guild, tz);
  }
}

// ── fire_at-based Reminder Engine ───────────────────────────
async function processDueReminders(guild) {
  const due = Reminders.getDue();
  for (const r of due) {
    try {
      // Skip days check
      const skipDays = JSON.parse(r.skip_days || '[]');
      if (skipDays.length) {
        const dayName = moment().tz('UTC').format('dddd').toLowerCase();
        if (skipDays.includes(dayName)) {
          // Advance to next occurrence if recurring
          if (r.interval_secs) Reminders.advanceFireAt(r.id, r.interval_secs);
          else Reminders.update(r.id, r.guild_id, { is_active: 0 });
          continue;
        }
      }

      const targetGuild = guild.client.guilds.cache.get(r.guild_id);
      if (!targetGuild) continue;

      // Build message content
      const pingLine = r.ping_content || '';
      const msgContent = pingLine ? `${pingLine}` : undefined;

      if (r.type === 'dm') {
        // DM the specific user
        if (r.user_id) {
          const member = await targetGuild.members.fetch(r.user_id).catch(() => null);
          if (member) {
            const embed = buildRichEmbed(r);
            await member.send({ content: embed ? undefined : (r.reason || 'You have a reminder!'), embeds: embed ? [embed] : [] }).catch(() => {});
          }
        }
      } else {
        // Post in channel
        const chId = r.channel_id;
        if (chId) {
          const ch = targetGuild.channels.cache.get(chId);
          if (ch) {
            const embed = buildRichEmbed(r);
            const sent = await ch.send({
              content: msgContent,
              embeds: embed ? [embed] : [],
            }).catch(() => null);

            // Delete previous message if enabled
            if (r.delete_previous && r.last_message_id) {
              ch.messages.delete(r.last_message_id).catch(() => {});
            }
            if (sent) Reminders.setLastMessage(r.id, sent.id);
          }
        }
      }

      // Recurring: advance; One-time: deactivate
      if (r.interval_secs) {
        Reminders.advanceFireAt(r.id, r.interval_secs);
      } else {
        Reminders.update(r.id, r.guild_id, { is_active: 0 });
      }

      logger.info(`Reminder #${r.id} fired [${r.type}] guild:${r.guild_id}`);
    } catch (err) {
      logger.error(`Reminder #${r.id} fire error: ${err.message}`);
    }
  }
}

function buildRichEmbed(r) {
  if (!r.reason && !r.title) return null;
  const color = r.color ? parseInt(r.color.replace('#', ''), 16) : 0x5865F2;
  const embed = new EmbedBuilder().setColor(color);
  if (r.title)         embed.setTitle(r.title);
  if (r.reason)        embed.setDescription(r.reason);
  if (r.image_url)     embed.setImage(r.image_url);
  if (r.thumbnail_url) embed.setThumbnail(r.thumbnail_url);
  if (r.footer_text)   embed.setFooter({ text: r.footer_text });
  if (r.show_timestamp) embed.setTimestamp();
  return embed;
}


// ── Fire Report Reminder (HH:MM style) ──────────────────────
async function fireReportReminder(guildId, guild, reminder, today, tz) {
  const deadline = getDeadlineStr(guildId);
  const users = Users.getAll(guildId);
  const todayReports = Reports.getTodayAll(guildId, today);
  const submittedIds = new Set(todayReports.map(r => r.discord_id));
  const pending = users.filter(u => !submittedIds.has(u.discord_id));

  if (!pending.length) return;

  const type = reminder.type || 'standard';

  // Parse meta (channel/user stored in message field as JSON)
  let meta = {};
  try { meta = JSON.parse(reminder.message || '{}'); } catch { meta = {}; }

  // Filter to specific user if set
  const targetUsers = meta.user
    ? pending.filter(u => u.discord_id === meta.user)
    : pending;

  if (!targetUsers.length) return;

  // Build today/tomorrow display strings
  const todayDisplay    = moment().tz(tz).format('DD MMM YYYY');
  const tomorrowDisplay = moment().tz(tz).add(1, 'day').format('DD MMM YYYY');

  for (const u of targetUsers) {
    // Determine target channel
    let targetChannelId = meta.channel || u.report_channel;
    if (!targetChannelId) continue;

    const ch = guild.channels.cache.get(targetChannelId);
    if (!ch) continue;

    // Build the formatted reminder message with the report template
    const header = type === 'escalation'
      ? `🚨 You missed today's report. Please submit it now using \`/report\`.`
      : `Please send your daily report using \`/report\`\nin the below given format`;

    const formatPreview = [
      ``,
      `**Daily Report (${todayDisplay})**`,
      `1.`,
      `2.`,
      ``,
      `**To-Do List (${tomorrowDisplay})**`,
      `1.`,
      `2.`,
      ``,
      `*Days with team meeting: add the Meeting To-Do list below*`,
      `**Meeting To-Do (until next meeting)**`,
      `1.`,
      `2.`,
    ].join('\n');

    try {
      await ch.send({
        content: `<@${u.discord_id}>\n${header}\n${formatPreview}`
      });
    } catch (err) {
      logger.warn(`Reminder send failed [${u.discord_id}]: ${err.message}`);
    }

    // DM ping if enabled
    const dmEnabled = Settings.get(guildId, 'dm_reminders', false);
    if (dmEnabled) {
      try {
        const member = await guild.members.fetch(u.discord_id).catch(() => null);
        if (member) await member.send({ content: `⏰ **Report Reminder** — Please submit your daily report in **${guild.name}** before **${deadline}**.\n\nUse \`/report\` in your assigned channel.` });
      } catch { /* DMs closed */ }
    }
  }

  logger.info(`Reminder [${type}] fired for guild ${guildId} — ${targetUsers.length} user(s) pinged`);
}


// ── Smart Reminder Engine ────────────────────────────────────
async function checkSmartReminders(guildId, guild, now, today) {
  const users = Users.getAll(guildId);
  const todayReports = Reports.getTodayAll(guildId, today);
  const submittedIds = new Set(todayReports.map(r => r.discord_id));

  for (const u of users) {
    if (submittedIds.has(u.discord_id)) continue;

    const state = SmartState.get(guildId, u.discord_id);
    if (!state) continue;

    const recentReports = Reports.getRange(guildId, getDateDaysAgo(30), today);
    const userRecent = recentReports.filter(r => r.discord_id === u.discord_id);
    const streak = Streaks.get(guildId, u.discord_id);
    const hints = analyzeSmartReminder(userRecent, streak);

    for (const hint of hints) {
      if (hint === 'early') {
        // Send 1 hour earlier than first standard reminder
        const reminders = Reminders.getAll(guildId);
        if (reminders.length === 0) continue;
        const firstReminder = reminders[0];
        const t = parseTime(firstReminder.reminder_time);
        if (!t) continue;
        const earlyTime = now.clone().hour(t.hour - 1).minute(t.minute).format('HH:mm');
        if (now.format('HH:mm') === earlyTime && !state.early_reminder_sent) {
          const embed = reminderEmbed([], getDeadlineStr(guildId), 'early');
          if (u.report_channel) {
            const ch = guild.channels.cache.get(u.report_channel);
            if (ch) await ch.send({ content: `<@${u.discord_id}>`, embeds: [embed] }).catch(() => {});
          }
          getDb().prepare('UPDATE smart_reminder_state SET early_reminder_sent=1 WHERE guild_id=? AND discord_id=?').run(guildId, u.discord_id);
        }
      }

      if (hint === 'streak_milestone') {
        // Motivational ping
        const embed = reminderEmbed([], getDeadlineStr(guildId), 'motivational');
        if (u.report_channel) {
          const ch = guild.channels.cache.get(u.report_channel);
          if (ch) await ch.send({ content: `<@${u.discord_id}> 🔥 You're on a **${streak?.current_streak}-day streak!** Don't stop now!`, embeds: [embed] }).catch(() => {});
        }
      }

      if (hint === 'low_confidence') {
        // Notify manager silently
        const alertCh = Settings.get(guildId, 'alert_channel');
        if (alertCh) {
          const ch = guild.channels.cache.get(alertCh);
          if (ch) {
            await ch.send({
              embeds: [new EmbedBuilder()
                .setColor(Colors.warning)
                .setTitle('⚠️  Morale Alert')
                .setDescription(`<@${u.discord_id}> has been reporting **low confidence scores** consistently.\n\nConsider a 1:1 check-in.`)
                .setTimestamp()
              ]
            }).catch(() => {});
          }
        }
      }
    }
  }
}

// ── Midnight Reset ───────────────────────────────────────────
async function midnightReset() {
  if (!client?.guilds?.cache) return;

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const tz = getGuildTimezone(guildId);
      const yesterday = moment().tz(tz).subtract(1, 'day').format('YYYY-MM-DD');
      const users = Users.getAll(guildId);
      const reports = Reports.getTodayAll(guildId, yesterday);
      const submittedIds = new Set(reports.map(r => r.discord_id));

      for (const u of users) {
        if (u.is_exempt) continue;
        if (!submittedIds.has(u.discord_id)) {
          // Record miss
          MissedReports.record(guildId, u.discord_id, yesterday);
          // Break streak
          Streaks.breakStreak(guildId, u.discord_id);

          // Escalation checks
          const consecutive = MissedReports.getConsecutive(guildId, u.discord_id);
          const monthly = MissedReports.getMonthlyCount(guildId, u.discord_id);

          const alertCh = Settings.get(guildId, 'alert_channel');
          if (alertCh) {
            const ch = guild.channels.cache.get(alertCh);
            if (ch) {
              if (consecutive === 2) {
                await ch.send({
                  embeds: [new EmbedBuilder()
                    .setColor(Colors.warning)
                    .setTitle('⚠️  Consecutive Miss Alert')
                    .setDescription(`<@${u.discord_id}> has missed **2 consecutive reports**.\n\nPlease follow up.`)
                    .setTimestamp()
                  ]
                }).catch(() => {});
              }
              if (monthly === 5) {
                await ch.send({
                  embeds: [new EmbedBuilder()
                    .setColor(Colors.danger)
                    .setTitle('🚨  Monthly Miss Threshold Reached')
                    .setDescription(`<@${u.discord_id}> has missed **5 reports this month**.\n\nThis is a performance concern requiring review.`)
                    .setTimestamp()
                  ]
                }).catch(() => {});
              }
            }
          }
        }
      }

      // Reset smart reminder daily flags
      SmartState.resetDailyFlags(guildId);
      logger.info(`Midnight reset done for guild ${guildId}`);
    } catch (err) {
      logger.error(`Midnight reset error for guild ${guildId}: ${err.message}`);
    }
  }
}

// ── Weekly Summary ───────────────────────────────────────────
async function postWeeklySummary(guildId, guild, tz) {
  const now = moment().tz(tz);
  const today = now.format('YYYY-MM-DD');
  const monday = now.clone().startOf('isoWeek').format('YYYY-MM-DD');
  const weekLabel = `${moment(monday).format('MMM D')} – ${now.format('MMM D, YYYY')}`;

  const allUsers = Users.getAll(guildId);
  const weekReports = Reports.getRange(guildId, monday, today);
  const expected = allUsers.length * 7;
  const completionPct = expected > 0 ? Math.round((weekReports.length / expected) * 100) : 0;

  // Stats per user
  const userMap = {};
  for (const r of weekReports) {
    if (!userMap[r.discord_id]) userMap[r.discord_id] = { name: r.display_name || r.username, count: 0, onTime: 0, confTotal: 0, confCount: 0 };
    userMap[r.discord_id].count++;
    if (!r.is_late) userMap[r.discord_id].onTime++;
  }

  const streakLb = Streaks.getLeaderboard(guildId);
  const topStreak = streakLb[0];

  const sorted = Object.values(userMap).sort((a, b) => b.onTime - a.onTime);
  const mostConsistent = sorted[0];

  const totalMissed = allUsers.length * 7 - weekReports.length;

  const embed = weeklyReportEmbed({
    weekLabel,
    completionPct,
    topStreak,
    mostConsistent,
    mostImproved: sorted[1] || null,
    avgMorale: null,
    totalMissed: Math.max(0, totalMissed)
  }, guild.name);

  const channels = SummaryChannels.getAll(guildId, 'weekly');
  for (const sc of channels) {
    const ch = guild.channels.cache.get(sc.channel_id);
    if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
  }

  logger.info(`Weekly summary posted for guild ${guildId}`);
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
