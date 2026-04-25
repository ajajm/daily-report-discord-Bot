// src/utils/permissions.js
// Role-based permission helpers

import { Settings } from '../database/db.js';

export function isAdmin(member) {
  if (!member) return false;
  if (member.permissions.has('Administrator')) return true;
  const adminRole = process.env.BOT_ADMIN_ROLE_NAME || 'Admin';
  return member.roles.cache.some(r => r.name === adminRole || r.name === 'Owner');
}

export function isManager(member, guildId) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  const managerRoleName = Settings.get(guildId, 'manager_role', process.env.MANAGER_ROLE_NAME || 'Manager');
  return member.roles.cache.some(r => r.name === managerRoleName || r.name === 'Manager' || r.name === 'Founder');
}

export function requireAdmin(interaction) {
  if (!isAdmin(interaction.member)) {
    return { allowed: false, reason: 'This command requires **Administrator** permission.' };
  }
  return { allowed: true };
}

export function requireManager(interaction) {
  if (!isManager(interaction.member, interaction.guildId)) {
    return { allowed: false, reason: 'This command requires a **Manager** or **Admin** role.' };
  }
  return { allowed: true };
}

// Cooldown map: Map<commandName, Map<userId, timestamp>>
const cooldowns = new Map();

export function checkCooldown(commandName, userId, seconds = 5) {
  if (!cooldowns.has(commandName)) cooldowns.set(commandName, new Map());
  const cd = cooldowns.get(commandName);
  const now = Date.now();
  const last = cd.get(userId) || 0;
  if (now - last < seconds * 1000) {
    return { onCooldown: true, remaining: Math.ceil((seconds * 1000 - (now - last)) / 1000) };
  }
  cd.set(userId, now);
  return { onCooldown: false };
}
