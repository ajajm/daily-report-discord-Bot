// migrate.js — run once to add new columns to existing DB
import Database from 'better-sqlite3';
const db = new Database('./data/reports.db');

const newCols = [
  ['channel_id',      'TEXT'],
  ['user_id',         'TEXT'],
  ['ping_content',    'TEXT'],
  ['fire_at',         'DATETIME'],
  ['interval_secs',   'INTEGER'],
  ['skip_days',       'TEXT'],
  ['expires_at',      'DATETIME'],
  ['is_paused',       'INTEGER DEFAULT 0'],
  ['delete_previous', 'INTEGER DEFAULT 0'],
  ['last_message_id', 'TEXT'],
  ['title',           'TEXT'],
  ['reason',          'TEXT'],
  ['color',           'TEXT'],
  ['image_url',       'TEXT'],
  ['thumbnail_url',   'TEXT'],
  ['footer_text',     'TEXT'],
  ['show_timestamp',  'INTEGER DEFAULT 1'],
  ['created_by',      'TEXT'],
];

const existing = db.pragma('table_info(reminders)').map(c => c.name);

for (const [col, type] of newCols) {
  if (!existing.includes(col)) {
    db.prepare(`ALTER TABLE reminders ADD COLUMN ${col} ${type}`).run();
    console.log('  + Added column:', col);
  } else {
    console.log('  ✓ Already exists:', col);
  }
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS staff_roles (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id  TEXT NOT NULL,
    role_id   TEXT NOT NULL,
    role_name TEXT,
    added_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id, role_id)
  )
`).run();
console.log('  ✓ staff_roles table ready');
console.log('Migration complete.');
db.close();
