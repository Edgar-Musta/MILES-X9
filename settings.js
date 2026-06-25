// ============================================================
//  MILESX9 — Settings
//  Edit this file to configure your bot before first run.
// ============================================================

const settings = {
  // Your WhatsApp number WITH country code, no + or spaces
  // Example: Uganda +256 → 256701234567
  ownerNumber: process.env.OWNER_NUMBER || '256701234567',

  // Bot display name
  botName: process.env.BOT_NAME || 'MILESX9',

  // Your name (shown in some messages)
  botOwner: process.env.BOT_OWNER || 'MustaX',

  // Command prefix
  prefix: process.env.PREFIX || '.',

  // 'public' = everyone can use commands, 'private' = only owner/sudo
  commandMode: process.env.COMMAND_MODE || 'public',

  // Bot version
  version: '3.0.7',

  // Short description shown in help menu
  description: 'A WhatsApp group management bot.',

  // Max messages kept in memory store (lower = less RAM)
  maxStoreMessages: 20,
};

module.exports = settings;
