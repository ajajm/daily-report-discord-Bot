// src/commands/reminders.js
// Full-featured /reminder command — ReminderPro-style

import {
  SlashCommandBuilder, EmbedBuilder, ButtonBuilder,
  ButtonStyle, ActionRowBuilder
} from 'discord.js';
import { Reminders, Settings, StaffRoles } from '../database/db.js';
import { successEmbed, errorEmbed, Colors } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { parseFlexibleTime, formatTime, parseInterval, secondsToHuman } from '../utils/time.js';
import moment from 'moment-timezone';

// ── Permission check: Admin OR staff role ─────────────────────
function hasReminderPermission(interaction) {
  if (interaction.member.permissions.has('Administrator')) return true;
  const staffRoles = StaffRoles.getAll(interaction.guildId);
  return staffRoles.some(r => interaction.member.roles.cache.has(r.role_id));
}

export const data = new SlashCommandBuilder()
  .setName('reminder')
  .setDescription('Manage reminders')

  // ── ADD ─────────────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('add')
    .setDescription('Create a one-time or recurring reminder')
    .addStringOption(o => o.setName('time').setDescription('When: "7:00PM", "2d 3h", "30/04 9pm", "monday 3pm"').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('What this reminder is about').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (default: user\'s assigned channel)').setRequired(false))
    .addStringOption(o => o.setName('repeat').setDescription('Repeat interval: "daily", "weekly", "30m", "2h", "7d"').setRequired(false))
    .addStringOption(o => o.setName('ping').setDescription('Who to ping: @here, @role, @user (comma-separated)').setRequired(false))
    .addStringOption(o => o.setName('type').setDescription('Reminder tone').setRequired(false).addChoices(
      { name: '📋 Standard',        value: 'standard' },
      { name: '🚨 Final/Escalation', value: 'escalation' },
      { name: '📩 DM only',          value: 'dm' },
    ))
    .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(false))
    .addStringOption(o => o.setName('color').setDescription('Embed color hex e.g #FF6B35').setRequired(false))
    .addStringOption(o => o.setName('expires').setDescription('Stop recurring after this date e.g "31/12 23:59"').setRequired(false))
    .addStringOption(o => o.setName('skip_days').setDescription('Skip these days e.g "saturday,sunday"').setRequired(false))
    .addBooleanOption(o => o.setName('delete_previous').setDescription('Delete last reminder message before sending new one').setRequired(false))
  )

  // ── LIST ─────────────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('list')
    .setDescription('View all active reminders for this server')
  )

  // ── REMOVE ───────────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('remove')
    .setDescription('Delete a reminder by ID')
    .addIntegerOption(o => o.setName('id').setDescription('Reminder ID (from /reminder list)').setRequired(true))
  )

  // ── EDIT ─────────────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('edit')
    .setDescription('Edit an existing reminder')
    .addIntegerOption(o => o.setName('id').setDescription('Reminder ID to edit').setRequired(true))
    .addStringOption(o => o.setName('time').setDescription('New time').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('New reason/message').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('New channel').setRequired(false))
    .addStringOption(o => o.setName('repeat').setDescription('New repeat interval').setRequired(false))
    .addStringOption(o => o.setName('ping').setDescription('New ping content').setRequired(false))
    .addStringOption(o => o.setName('color').setDescription('New embed color').setRequired(false))
    .addStringOption(o => o.setName('title').setDescription('New title').setRequired(false))
    .addStringOption(o => o.setName('expires').setDescription('New expiration').setRequired(false))
  )

  // ── PAUSE ────────────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('pause')
    .setDescription('Pause a reminder (or all reminders)')
    .addIntegerOption(o => o.setName('id').setDescription('Reminder ID — leave blank to pause ALL').setRequired(false))
  )

  // ── RESUME ───────────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('resume')
    .setDescription('Resume a paused reminder (or all)')
    .addIntegerOption(o => o.setName('id').setDescription('Reminder ID — leave blank to resume ALL').setRequired(false))
  )

  // ── DST ──────────────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('dst-forward')
    .setDescription('Shift all reminders forward by 1 hour (clocks spring forward)')
  )
  .addSubcommand(s => s
    .setName('dst-backward')
    .setDescription('Shift all reminders backward by 1 hour (clocks fall back)')
  )

  // ── DEADLINE ─────────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('deadline')
    .setDescription('Set the daily report submission deadline')
    .addStringOption(o => o.setName('time').setDescription('e.g. 10:00PM or 22:00').setRequired(true))
  )

  // ── TIMEZONE ─────────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('timezone')
    .setDescription('Set the server timezone')
    .addStringOption(o => o.setName('zone').setDescription('e.g. Asia/Kolkata | UTC | America/New_York').setRequired(true))
  )

  // ── STAFF ROLES ───────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('staff-add')
    .setDescription('Allow a role to manage reminders without Admin permission')
    .addRoleOption(o => o.setName('role').setDescription('Role to grant reminder access').setRequired(true))
  )
  .addSubcommand(s => s
    .setName('staff-remove')
    .setDescription('Remove a role from reminder staff')
    .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true))
  )
  .addSubcommand(s => s
    .setName('staff-list')
    .setDescription('List all roles with reminder management access')
  )

  // ── CLEAR ALL ─────────────────────────────────────────────
  .addSubcommand(s => s
    .setName('clear')
    .setDescription('Delete ALL reminders for this server at once')
  );


export async function execute(interaction) {
  const { guildId } = interaction;
  const sub = interaction.options.getSubcommand();

  // Permission check
  if (!hasReminderPermission(interaction)) {
    return interaction.reply({ embeds: [errorEmbed('No Permission', 'You need Administrator or a staff role to manage reminders.')], ephemeral: true });
  }

  const tz = Settings.get(guildId, 'timezone', process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata');

  // ─── ADD ──────────────────────────────────────────────────────
  if (sub === 'add') {
    const timeStr  = interaction.options.getString('time');
    const reason   = interaction.options.getString('reason') || null;
    const channel  = interaction.options.getChannel('channel');
    const repeat   = interaction.options.getString('repeat') || null;
    const ping     = interaction.options.getString('ping') || null;
    const type     = interaction.options.getString('type') || 'standard';
    const title    = interaction.options.getString('title') || null;
    const color    = interaction.options.getString('color') || null;
    const expires  = interaction.options.getString('expires') || null;
    const skipDays = interaction.options.getString('skip_days') || null;
    const delPrev  = interaction.options.getBoolean('delete_previous') || false;

    // Parse fire time
    const fireAt = parseFlexibleTime(timeStr, tz);
    if (!fireAt) {
      return interaction.reply({ embeds: [errorEmbed('Invalid Time', `Could not parse **"${timeStr}"**\n\nSupported formats:\n• \`7:00PM\` or \`19:00\`\n• \`2h 30m\` or \`1d\`\n• \`30/04 9pm\`\n• \`monday 3pm\``)], ephemeral: true });
    }

    // Parse repeat interval
    let intervalSecs = null;
    if (repeat) {
      intervalSecs = parseInterval(repeat);
      if (!intervalSecs) {
        return interaction.reply({ embeds: [errorEmbed('Invalid Repeat', `Could not parse **"${repeat}"**\n\nExamples: \`daily\`, \`weekly\`, \`2h\`, \`30m\`, \`7d\``)], ephemeral: true });
      }
    }

    // Parse expiration
    let expiresAt = null;
    if (expires) {
      expiresAt = parseFlexibleTime(expires, tz);
      if (!expiresAt) {
        return interaction.reply({ embeds: [errorEmbed('Invalid Expiry', `Could not parse expiry date: **"${expires}"**`)], ephemeral: true });
      }
    }

    // Validate color
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return interaction.reply({ embeds: [errorEmbed('Invalid Color', 'Use hex format: `#FF6B35`')], ephemeral: true });
    }

    const skipArr = skipDays ? skipDays.split(',').map(d => d.trim().toLowerCase()) : [];

    const r = Reminders.create({
      guild_id:       guildId,
      channel_id:     channel?.id || null,
      ping_content:   ping || null,
      fire_at:        fireAt.toISOString(),
      interval_secs:  intervalSecs,
      skip_days:      JSON.stringify(skipArr),
      expires_at:     expiresAt?.toISOString() || null,
      type,
      delete_previous: delPrev ? 1 : 0,
      title:          title || null,
      reason:         reason || null,
      color:          color || null,
      show_timestamp: 1,
      created_by:     interaction.user.id,
      is_active:      1,
    });

    const id = r.lastInsertRowid;

    const lines = [
      `**ID:** \`#${id}\``,
      `🕐 **Fires at:** ${moment(fireAt).tz(tz).format('ddd, DD MMM YYYY [at] h:mm A z')}`,
      repeat    ? `🔁 **Repeats:** every ${secondsToHuman(intervalSecs)}` : `📌 **One-time** reminder`,
      channel   ? `📢 **Channel:** <#${channel.id}>` : `📢 **Channel:** assigned channels`,
      ping      ? `🔔 **Pings:** ${ping}` : '',
      skipArr.length ? `⏭ **Skip days:** ${skipArr.join(', ')}` : '',
      expiresAt ? `⏰ **Expires:** ${moment(expiresAt).tz(tz).format('DD MMM YYYY h:mm A')}` : '',
      reason    ? `💬 **Reason:** ${reason}` : '',
      color     ? `🎨 **Color:** ${color}` : '',
      delPrev   ? `🗑 **Delete previous:** yes` : '',
    ].filter(Boolean).join('\n');

    return interaction.reply({ embeds: [successEmbed('✅  Reminder Created', lines)] });
  }

  // ─── LIST ─────────────────────────────────────────────────────
  if (sub === 'list') {
    const reminders = Reminders.getAll(guildId);
    const deadline  = Settings.get(guildId, 'deadline', '21:00');

    if (!reminders.length) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(Colors.info)
          .setTitle('⏰  Reminders')
          .setDescription('No reminders set.\nUse `/reminder add time:7:00PM reason:Daily report` to create one.')
          .setTimestamp()
        ]
      });
    }

    const lines = reminders.map(r => {
      const status   = r.is_paused ? '⏸' : r.is_active ? '🟢' : '🔴';
      const fireStr  = r.fire_at
        ? moment(r.fire_at).tz(tz).format('DD MMM h:mm A')
        : (r.reminder_time || '?');
      const repeat   = r.interval_secs ? ` 🔁${secondsToHuman(r.interval_secs)}` : ' 1x';
      const ch       = r.channel_id ? `<#${r.channel_id}>` : 'assigned';
      const typeTag  = r.type !== 'standard' ? ` [${r.type}]` : '';
      const reasonTxt = r.reason ? ` — ${r.reason.slice(0, 40)}` : '';
      return `${status} \`#${r.id}\` **${fireStr}**${repeat}${typeTag} 📢${ch}${reasonTxt}`;
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setTitle('⏰  Active Reminders')
      .setDescription(lines.join('\n'))
      .addFields(
        { name: '⏱ Deadline', value: formatTime(deadline), inline: true },
        { name: '🌍 Timezone', value: tz,                   inline: true },
        { name: '📊 Total',    value: `${reminders.length}`, inline: true },
      )
      .setFooter({ text: '/reminder remove id:<#> to delete  |  /reminder edit id:<#> to change' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ─── REMOVE ───────────────────────────────────────────────────
  if (sub === 'remove') {
    const id = interaction.options.getInteger('id');
    const r = Reminders.getById(id, guildId);
    if (!r) return interaction.reply({ embeds: [errorEmbed('Not Found', `No reminder with ID \`#${id}\`.`)], ephemeral: true });
    Reminders.remove(id, guildId);
    return interaction.reply({ embeds: [successEmbed('Deleted', `Reminder \`#${id}\` removed.`)] });
  }

  // ─── EDIT ─────────────────────────────────────────────────────
  if (sub === 'edit') {
    const id = interaction.options.getInteger('id');
    const r = Reminders.getById(id, guildId);
    if (!r) return interaction.reply({ embeds: [errorEmbed('Not Found', `No reminder with ID \`#${id}\`.`)], ephemeral: true });

    const updates = {};
    const timeStr = interaction.options.getString('time');
    if (timeStr) {
      const fireAt = parseFlexibleTime(timeStr, tz);
      if (!fireAt) return interaction.reply({ embeds: [errorEmbed('Invalid Time', `Could not parse "${timeStr}"`)], ephemeral: true });
      updates.fire_at = fireAt.toISOString();
    }

    const reason  = interaction.options.getString('reason');
    const channel = interaction.options.getChannel('channel');
    const repeat  = interaction.options.getString('repeat');
    const ping    = interaction.options.getString('ping');
    const color   = interaction.options.getString('color');
    const title   = interaction.options.getString('title');
    const expires = interaction.options.getString('expires');

    if (reason)  updates.reason      = reason;
    if (channel) updates.channel_id  = channel.id;
    if (ping)    updates.ping_content = ping;
    if (color)   updates.color       = color;
    if (title)   updates.title       = title;
    if (repeat) {
      const secs = parseInterval(repeat);
      if (!secs) return interaction.reply({ embeds: [errorEmbed('Invalid Repeat', `Could not parse "${repeat}"`)], ephemeral: true });
      updates.interval_secs = secs;
    }
    if (expires) {
      const exp = parseFlexibleTime(expires, tz);
      if (!exp) return interaction.reply({ embeds: [errorEmbed('Invalid Expiry', `Could not parse "${expires}"`)], ephemeral: true });
      updates.expires_at = exp.toISOString();
    }

    if (!Object.keys(updates).length) {
      return interaction.reply({ embeds: [errorEmbed('Nothing to Update', 'Provide at least one field to change.')], ephemeral: true });
    }

    Reminders.update(id, guildId, updates);
    return interaction.reply({ embeds: [successEmbed('Updated', `Reminder \`#${id}\` updated.\n${Object.keys(updates).join(', ')} changed.`)] });
  }

  // ─── PAUSE ────────────────────────────────────────────────────
  if (sub === 'pause') {
    const id = interaction.options.getInteger('id');
    if (id) {
      const r = Reminders.getById(id, guildId);
      if (!r) return interaction.reply({ embeds: [errorEmbed('Not Found', `No reminder \`#${id}\`.`)], ephemeral: true });
      Reminders.setPaused(id, guildId, true);
      return interaction.reply({ embeds: [successEmbed('⏸  Paused', `Reminder \`#${id}\` paused. Use \`/reminder resume id:${id}\` to activate again.`)] });
    } else {
      Reminders.pauseAll(guildId, true);
      return interaction.reply({ embeds: [successEmbed('⏸  All Paused', 'All reminders paused. Use `/reminder resume` to resume all.')] });
    }
  }

  // ─── RESUME ───────────────────────────────────────────────────
  if (sub === 'resume') {
    const id = interaction.options.getInteger('id');
    if (id) {
      const r = Reminders.getById(id, guildId);
      if (!r) return interaction.reply({ embeds: [errorEmbed('Not Found', `No reminder \`#${id}\`.`)], ephemeral: true });
      Reminders.setPaused(id, guildId, false);
      return interaction.reply({ embeds: [successEmbed('▶️  Resumed', `Reminder \`#${id}\` is active again.`)] });
    } else {
      Reminders.pauseAll(guildId, false);
      return interaction.reply({ embeds: [successEmbed('▶️  All Resumed', 'All reminders are active again.')] });
    }
  }

  // ─── DST ──────────────────────────────────────────────────────
  if (sub === 'dst-forward' || sub === 'dst-backward') {
    const direction = sub === 'dst-forward' ? 1 : -1;
    const reminders = Reminders.getAll(guildId);
    let count = 0;
    for (const r of reminders) {
      if (r.fire_at) {
        const newTime = moment(r.fire_at).add(direction, 'hour').toISOString();
        Reminders.update(r.id, guildId, { fire_at: newTime });
        count++;
      }
    }
    const icon = direction === 1 ? '⏩' : '⏪';
    const label = direction === 1 ? 'forward (spring)' : 'backward (fall)';
    return interaction.reply({ embeds: [successEmbed(`${icon}  DST Adjusted`, `${count} reminder(s) shifted 1 hour ${label}.`)] });
  }

  // ─── DEADLINE ─────────────────────────────────────────────────
  if (sub === 'deadline') {
    const timeStr = interaction.options.getString('time');
    const parsed  = parseFlexibleTime(timeStr, tz);
    if (!parsed) return interaction.reply({ embeds: [errorEmbed('Invalid Time', 'Use `HH:MM` or `h:mmAM/PM`')], ephemeral: true });
    const hh = String(parsed.hour()).padStart(2,'0');
    const mm = String(parsed.minute()).padStart(2,'0');
    Settings.set(guildId, 'deadline', `${hh}:${mm}`);
    return interaction.reply({ embeds: [successEmbed('✅  Deadline Set', `Daily report deadline → **${formatTime(`${hh}:${mm}`)}`)] });
  }

  // ─── TIMEZONE ─────────────────────────────────────────────────
  if (sub === 'timezone') {
    const zone = interaction.options.getString('zone');
    try { Intl.DateTimeFormat(undefined, { timeZone: zone }); } catch {
      return interaction.reply({ embeds: [errorEmbed('Invalid Timezone', `"${zone}" is not recognised.\n\nExamples: \`Asia/Kolkata\` · \`UTC\` · \`America/New_York\` · \`Europe/London\``)], ephemeral: true });
    }
    Settings.set(guildId, 'timezone', zone);
    return interaction.reply({ embeds: [successEmbed('🌍  Timezone Set', `Server timezone → **${zone}**`)] });
  }

  // ─── STAFF ROLES ──────────────────────────────────────────────
  if (sub === 'staff-add') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ embeds: [errorEmbed('No Permission', 'Only Administrators can manage staff roles.')], ephemeral: true });
    }
    const role = interaction.options.getRole('role');
    StaffRoles.add(guildId, role.id, role.name);
    return interaction.reply({ embeds: [successEmbed('Staff Role Added', `<@&${role.id}> can now manage reminders.`)] });
  }

  if (sub === 'staff-remove') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ embeds: [errorEmbed('No Permission', 'Only Administrators can manage staff roles.')], ephemeral: true });
    }
    const role = interaction.options.getRole('role');
    StaffRoles.remove(guildId, role.id);
    return interaction.reply({ embeds: [successEmbed('Staff Role Removed', `<@&${role.id}> removed from reminder staff.`)] });
  }

  // ─── CLEAR ALL ────────────────────────────────────────────
  if (sub === 'clear') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ embeds: [errorEmbed('No Permission', 'Only Administrators can clear all reminders.')], ephemeral: true });
    }
    const count = Reminders.getAll(guildId).length;
    if (!count) return interaction.reply({ embeds: [successEmbed('Nothing to Clear', 'No active reminders found.')], ephemeral: true });
    Reminders.clearAll(guildId);
    return interaction.reply({ embeds: [successEmbed('🗑️  All Cleared', `Deleted **${count}** reminder(s). Use \`/reminder add\` to create new ones.`)] });
  }

  if (sub === 'staff-list') {
    const roles = StaffRoles.getAll(guildId);
    if (!roles.length) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.info).setTitle('👥  Staff Roles').setDescription('No staff roles set. Only Admins can manage reminders.\n\nUse `/reminder staff-add role:@YourRole` to grant access.').setTimestamp()] });
    }
    const lines = roles.map(r => `<@&${r.role_id}> — added <t:${Math.floor(new Date(r.added_at).getTime()/1000)}:R>`);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.primary).setTitle('👥  Reminder Staff Roles').setDescription(lines.join('\n')).setTimestamp()] });
  }
}
