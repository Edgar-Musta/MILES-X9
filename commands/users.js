/**
 * users.js — Owner-only user management commands
 * 
 * Commands:
 *   .users          — list all registered sub-users and their status
 *   .block <number> — block a sub-user (stops their session + blocks re-pairing)
 *   .unblock <num>  — unblock a sub-user (they must .pair again to reconnect)
 *   .remove <num>   — fully remove a sub-user and delete their session data
 *   .userinfo <num> — show detailed info about a specific sub-user
 *
 * ALL commands require the sender to be the configured owner (settings.ownerNumber).
 */

const userManager    = require('../lib/userManager');
const sessionManager = require('../lib/sessionManager');
const isOwnerOrSudo  = require('../lib/isOwner');
const settings       = require('../settings');

async function usersCommand(sock, chatId, message, q) {
    const senderId = message.key.participant || message.key.remoteJid;
    const ownerOnly = message.key.fromMe || await isOwnerOrSudo(senderId, sock, chatId);

    if (!ownerOnly) {
        return sock.sendMessage(chatId, {
            text: '❌ Only the bot owner can manage sub-users.',
        }, { quoted: message });
    }

    const text    = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const parts   = text.trim().split(/\s+/);
    // parts[0] = ".users", parts[1] = subcommand, parts[2] = number
    const sub     = (parts[1] || '').toLowerCase();
    const rawNum  = parts[2] || q || '';
    const phone   = rawNum.replace(/[^0-9]/g, '');

    // ── .users (no sub-command) — list all ───────────────────
    if (!sub || sub === 'list') {
        const all = userManager.getAllUsers();
        const keys = Object.keys(all);

        if (keys.length === 0) {
            return sock.sendMessage(chatId, {
                text:
                    `👥 *Sub-User Registry*\n\n` +
                    `No sub-users registered yet.\n\n` +
                    `Users can register by sending *.pair <number>* to this bot in DM.`,
            }, { quoted: message });
        }

        const running = sessionManager.getRunning();
        const lines   = keys.map((p, i) => {
            const u      = all[p];
            const online = running.includes(p) ? '🟢' : '🔴';
            const status = u.status === 'blocked' ? '🚫 Blocked' : u.status === 'active' ? '✅ Active' : '⏳ Pending';
            const since  = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-GB') : 'unknown';
            return `${i + 1}. ${online} *+${p}*\n   Status: ${status} | Since: ${since}`;
        });

        return sock.sendMessage(chatId, {
            text:
                `👥 *Sub-User Registry* (${keys.length} user${keys.length !== 1 ? 's' : ''})\n\n` +
                lines.join('\n\n') +
                `\n\n_🟢 = session running  🔴 = offline_\n` +
                `_Commands: .users block <num> | .users unblock <num> | .users remove <num>_`,
        }, { quoted: message });
    }

    // ── Sub-commands that need a phone number ─────────────────
    if (['block', 'unblock', 'remove', 'info'].includes(sub)) {
        if (!phone) {
            return sock.sendMessage(chatId, {
                text: `❌ Please provide a phone number.\nExample: *.users ${sub} 256701234567*`,
            }, { quoted: message });
        }

        const ownerPhone = (settings.ownerNumber || '').replace(/[^0-9]/g, '');
        if (phone === ownerPhone) {
            return sock.sendMessage(chatId, {
                text: '❌ You cannot perform this action on the owner number.',
            }, { quoted: message });
        }

        if (sub === 'info') {
            const user = userManager.getUser(phone);
            if (!user) {
                return sock.sendMessage(chatId, {
                    text: `❌ No user found for +${phone}.`,
                }, { quoted: message });
            }
            const isOnline = sessionManager.isRunning(phone);
            return sock.sendMessage(chatId, {
                text:
                    `👤 *User Info: +${phone}*\n\n` +
                    `• Status: ${user.status}\n` +
                    `• Session: ${isOnline ? '🟢 Running' : '🔴 Offline'}\n` +
                    `• Registered: ${user.createdAt ? new Date(user.createdAt).toLocaleString('en-GB') : 'unknown'}\n` +
                    `• Session Dir: ${user.sessionDir}\n` +
                    (user.blockedAt ? `• Blocked At: ${new Date(user.blockedAt).toLocaleString('en-GB')}` : ''),
            }, { quoted: message });
        }

        if (sub === 'block') {
            if (!userManager.userExists(phone)) {
                return sock.sendMessage(chatId, {
                    text: `❌ No user found for +${phone}. They must have .pair'd first.`,
                }, { quoted: message });
            }
            // Stop their running session
            const wasStopped = sessionManager.stopUserSession(phone);
            const ok         = userManager.blockUser(phone);

            return sock.sendMessage(chatId, {
                text: ok
                    ? `🚫 *Blocked:* +${phone}\n\n` +
                      `Their bot session has been ${wasStopped ? 'stopped and ' : ''}blocked.\n` +
                      `They will not be able to re-pair until unblocked.\n\n` +
                      `To unblock: *.users unblock ${phone}*`
                    : `❌ Failed to block +${phone}. Check logs.`,
            }, { quoted: message });
        }

        if (sub === 'unblock') {
            if (!userManager.userExists(phone)) {
                return sock.sendMessage(chatId, {
                    text: `❌ No user found for +${phone}.`,
                }, { quoted: message });
            }
            const ok = userManager.unblockUser(phone);

            return sock.sendMessage(chatId, {
                text: ok
                    ? `✅ *Unblocked:* +${phone}\n\n` +
                      `They can now re-pair their WhatsApp by sending:\n` +
                      `*.pair ${phone}*\n\n` +
                      `Their session will restart automatically once they link.`
                    : `❌ Failed to unblock +${phone}. Check logs.`,
            }, { quoted: message });
        }

        if (sub === 'remove') {
            if (!userManager.userExists(phone)) {
                return sock.sendMessage(chatId, {
                    text: `❌ No user found for +${phone}.`,
                }, { quoted: message });
            }
            // Stop session, delete session files, remove from registry
            sessionManager.stopUserSession(phone);
            sessionManager.deleteSessionDir(phone);
            const ok = userManager.removeUser(phone);

            return sock.sendMessage(chatId, {
                text: ok
                    ? `🗑️ *Removed:* +${phone}\n\n` +
                      `Their session has been stopped, session files deleted,\n` +
                      `and they have been removed from the user registry.\n\n` +
                      `They will need to *.pair* again to use the bot.`
                    : `❌ Failed to remove +${phone} from registry. Check logs.`,
            }, { quoted: message });
        }
    }

    // ── Unknown sub-command ───────────────────────────────────
    return sock.sendMessage(chatId, {
        text:
            `👥 *User Management Commands*\n\n` +
            `• *.users* — list all sub-users\n` +
            `• *.users info <number>* — detailed info\n` +
            `• *.users block <number>* — block & stop session\n` +
            `• *.users unblock <number>* — unblock (they must re-pair)\n` +
            `• *.users remove <number>* — fully remove user & session data\n\n` +
            `_Numbers should include country code, no + or spaces._`,
    }, { quoted: message });
}

module.exports = usersCommand;
