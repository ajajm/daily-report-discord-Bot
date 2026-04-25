// src/commands/dailyreport.js
import {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits
} from 'discord.js';
import { ReminderConfigs, SummaryConfigs, Reports, GuildSettings } from '../database/db.js';
import moment from 'moment-timezone';

// ── Time parser: "7:00PM" | "19:00" | "9am" ──────────────────
function parseTime(str) {
  if (!str) return null;
  const s = str.trim();
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return { h: parseInt(m24[1]), m: parseInt(m24[2]) };
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m12) {
    let h = parseInt(m12[1]); const m = parseInt(m12[2]);
    if (m12[3].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m12[3].toLowerCase() === 'am' && h === 12) h = 0;
    return { h, m };
  }
  const mShort = s.match(/^(\d{1,2})\s*(am|pm)$/i);
  if (mShort) {
    let h = parseInt(mShort[1]);
    if (mShort[2].toLowerCase() === 'pm' && h < 12) h += 12;
    if (mShort[2].toLowerCase() === 'am' && h === 12) h = 0;
    return { h, m: 0 };
  }
  return null;
}

function fmt24(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fmtDisplay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return moment().hour(h).minute(m).format('h:mm A');
}

function intervalLabel(t) {
  return t === 'weekly' ? '📅 Weekly' : t === 'monthly' ? '🗓 Monthly' : '🔁 Daily';
}

export const data = new SlashCommandBuilder()
  .setName('dr')
  .setDescription('Manage daily report reminders and summaries')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

  // ── add reminder ─────────────────────────────────────────
  .addSubcommand(s => s
    .setName('add')
    .setDescription('Create a daily report reminder')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to send reminder in').setRequired(true))
    .addStringOption(o => o.setName('time').setDescription('Send time e.g. 7:00PM or 19:00').setRequired(true))
    .addStringOption(o => o.setName('interval').setDescription('How often').setRequired(true).addChoices(
      { name: '🔁 Daily',    value: 'daily' },
      { name: '📅 Weekly',   value: 'weekly' },
      { name: '🗓 Monthly',  value: 'monthly' },
    ))
    .addUserOption(o => o.setName('user').setDescription('Tag a specific user (optional)').setRequired(false))
    .addStringOption(o => o.setName('message').setDescription('Custom reminder message (optional)').setRequired(false))
  )

  // ── remove reminder ──────────────────────────────────────
  .addSubcommand(s => s
    .setName('remove')
    .setDescription('Remove a reminder by ID — leave blank to remove ALL')
    .addIntegerOption(o => o.setName('id').setDescription('Reminder ID (from /dr list)').setRequired(false))
  )

  // ── list reminders ───────────────────────────────────────
  .addSubcommand(s => s
    .setName('list')
    .setDescription('List all active reminders')
  )

  // ── view all today reports ───────────────────────────────
  .addSubcommand(s => s
    .setName('all')
    .setDescription("View all users' reports for today")
  )

  // ── delete report ────────────────────────────────────────
  .addSubcommand(s => s
    .setName('delete-report')
    .setDescription('Delete a specific report by its ID')
    .addIntegerOption(o => o.setName('id').setDescription('Report ID (shown next to user in /dr all)').setRequired(true))
  )

  // ── timezone ─────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('timezone')
    .setDescription('Set server timezone')
    .addStringOption(o => o.setName('zone').setDescription('e.g. Asia/Kolkata | UTC | America/New_York').setRequired(true))
  )

  // ── summarise subcommand group ───────────────────────────
  .addSubcommandGroup(g => g
    .setName('summarise')
    .setDescription('Manage the summary/centralised report channel')
    .addSubcommand(s => s
      .setName('add')
      .setDescription('Set up a summary channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post all reports into').setRequired(true))
      .addStringOption(o => o.setName('time').setDescription('Send time e.g. 9:00PM').setRequired(true))
      .addStringOption(o => o.setName('ping').setDescription('Ping a role or user when summary posts e.g. @Manager').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Remove a summary config — leave blank to remove ALL')
      .addIntegerOption(o => o.setName('id').setDescription('Summary config ID').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('list')
      .setDescription('List all active summary configurations')
    )
  );

// ── Handler ───────────────────────────────────────────────────
export async function execute(interaction) {
  const { guildId } = interaction;
  const sub = interaction.options.getSubcommand();
  const group = interaction.options.getSubcommandGroup(false);
  const tz = GuildSettings.getTimezone(guildId);

  // ── SUMMARISE GROUP ─────────────────────────────────────
  if (group === 'summarise') {
    if (sub === 'add') {
      const channel  = interaction.options.getChannel('channel');
      const timeStr  = interaction.options.getString('time');
      const ping     = interaction.options.getString('ping') || null;
      const t = parseTime(timeStr);
      if (!t) return interaction.reply({ content: `❌ Invalid time: \`${timeStr}\`. Use \`7:00PM\` or \`19:00\`.`, ephemeral: true });
      const hhmm = fmt24(t.h, t.m);
      const r = SummaryConfigs.add(guildId, channel.id, hhmm, ping);
      if (r.isDuplicate) {
        return interaction.reply({ content: `⚠️ A summary config already exists for <#${channel.id}> at **${fmtDisplay(hhmm)}** (ID: \`#${r.lastInsertRowid}\`).`, ephemeral: true });
      }
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅  Summary Config Created')
          .addFields(
            { name: 'ID',      value: `\`#${r.lastInsertRowid}\``, inline: true },
            { name: 'Channel', value: `<#${channel.id}>`,          inline: true },
            { name: 'Time',    value: fmtDisplay(hhmm),            inline: true },
            { name: 'Ping',    value: ping || 'None',              inline: true },
          )
          .setFooter({ text: 'Reports submitted before this time will be batched and posted here.' })
        ]
      });
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id');
      if (id) {
        SummaryConfigs.remove(id, guildId);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🗑️  Removed').setDescription(`Summary config \`#${id}\` deleted.`)] });
      } else {
        SummaryConfigs.removeAll(guildId);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🗑️  All Removed').setDescription('All summary configs deleted.')] });
      }
    }

    if (sub === 'list') {
      const configs = SummaryConfigs.getAll(guildId);
      if (!configs.length) return interaction.reply({ content: 'No summary configs. Use `/dr summarise add` to create one.', ephemeral: true });
      const lines = configs.map(c =>
        `\`#${c.id}\`  📢 <#${c.channel_id}>  🕐 **${fmtDisplay(c.send_time)}**${c.ping_content ? `  🔔 ${c.ping_content}` : ''}`
      );
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📋  Summary Configs').setDescription(lines.join('\n'))]
      });
    }
  }

  // ── ADD REMINDER ────────────────────────────────────────
  if (sub === 'add') {
    const channel  = interaction.options.getChannel('channel');
    const timeStr  = interaction.options.getString('time');
    const interval = interaction.options.getString('interval');
    const user     = interaction.options.getUser('user');
    const message  = interaction.options.getString('message');
    const t = parseTime(timeStr);
    if (!t) return interaction.reply({ content: `❌ Invalid time: \`${timeStr}\`. Use \`7:00PM\` or \`19:00\`.`, ephemeral: true });
    const hhmm = fmt24(t.h, t.m);
    const r = ReminderConfigs.add(guildId, channel.id, user?.id, message, hhmm, interval);
    if (r.isDuplicate) {
      return interaction.reply({ content: `⚠️ A reminder already exists for <#${channel.id}> at **${fmtDisplay(hhmm)}** (ID: \`#${r.lastInsertRowid}\`).`, ephemeral: true });
    }
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅  Reminder Created')
        .addFields(
          { name: 'ID',       value: `\`#${r.lastInsertRowid}\``,    inline: true },
          { name: 'Channel',  value: `<#${channel.id}>`,             inline: true },
          { name: 'Time',     value: fmtDisplay(hhmm),               inline: true },
          { name: 'Interval', value: intervalLabel(interval),         inline: true },
          { name: 'User',     value: user ? `<@${user.id}>` : 'All', inline: true },
          { name: 'Message',  value: message || 'Default',           inline: true },
        )
      ]
    });
  }

  // ── REMOVE REMINDER ─────────────────────────────────────
  if (sub === 'remove') {
    const id = interaction.options.getInteger('id');
    if (id) {
      ReminderConfigs.remove(id, guildId);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🗑️  Removed').setDescription(`Reminder \`#${id}\` deleted.`)] });
    } else {
      ReminderConfigs.removeAll(guildId);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🗑️  All Removed').setDescription('All reminders deleted.')] });
    }
  }

  // ── LIST REMINDERS ──────────────────────────────────────
  if (sub === 'list') {
    const reminders = ReminderConfigs.getAll(guildId);
    if (!reminders.length) return interaction.reply({ content: 'No reminders set. Use `/dr add` to create one.', ephemeral: true });
    const lines = reminders.map(r =>
      `\`#${r.id}\`  📢 <#${r.channel_id}>  🕐 **${fmtDisplay(r.send_time)}**  ${intervalLabel(r.interval_type)}${r.user_id ? `  👤 <@${r.user_id}>` : ''}${r.message ? `\n　　💬 ${r.message}` : ''}`
    );
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('⏰  Active Reminders').setDescription(lines.join('\n\n')).setFooter({ text: `Timezone: ${tz}` })]
    });
  }

  // ── ALL — view today's reports ──────────────────────────
  if (sub === 'all') {
    const tz = GuildSettings.getTimezone(guildId);
    const today = moment().tz(tz).format('YYYY-MM-DD');
    const todayDisplay = moment().tz(tz).format('DD MMM YYYY');
    const tomorrowDisplay = moment().tz(tz).add(1, 'day').format('DD MMM YYYY');
    const reports = Reports.getToday(guildId, today);

    if (!reports.length) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle(`📊  Daily Reports — ${todayDisplay}`).setDescription('No reports submitted today yet.')]
      });
    }

    const embeds = [];
    let current = new EmbedBuilder().setColor(0xFEE75C);
    let desc = '';

    for (const r of reports) {
      const block = [
        `<@${r.discord_id}> \`(ID: #${r.id})\``,
        `Daily report (${todayDisplay})`,
        r.daily_report,
        ``,
        `To-Do List (${tomorrowDisplay})`,
        r.todo_list,
        `\n${'─'.repeat(30)}`,
      ].join('\n');

      if (desc.length + block.length > 3800) {
        embeds.push(current.setDescription(desc));
        desc = '';
        current = new EmbedBuilder().setColor(0xFEE75C);
      }
      desc += block + '\n';
    }
    if (desc) embeds.push(current.setDescription(desc));

    return interaction.reply({ embeds: embeds.slice(0, 10) }); // Discord max 10 embeds
  }

  // ── DELETE REPORT ───────────────────────────────────────
  if (sub === 'delete-report') {
    const id = interaction.options.getInteger('id');
    const changes = Reports.remove(id, guildId);
    if (changes.changes > 0) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🗑️  Report Deleted').setDescription(`Report \`#${id}\` has been permanently removed.`)] });
    } else {
      return interaction.reply({ content: `❌ Report \`#${id}\` not found.`, ephemeral: true });
    }
  }

  // ── TIMEZONE ────────────────────────────────────────────
  if (sub === 'timezone') {
    const zone = interaction.options.getString('zone');
    try { Intl.DateTimeFormat(undefined, { timeZone: zone }); } catch {
      return interaction.reply({ content: `❌ Invalid timezone: \`${zone}\`\nExamples: \`Asia/Kolkata\` · \`UTC\` · \`America/New_York\``, ephemeral: true });
    }
    GuildSettings.setTimezone(guildId, zone);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('🌍  Timezone Set').setDescription(`Server timezone → **${zone}**`)] });
  }
}
