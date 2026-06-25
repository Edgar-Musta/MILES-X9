/**
 * autotyping.js
 * Fixed:
 * - presenceSubscribe() before every typing update is expensive and causes
 *   WA connection warnings. Subscribe once per connection, not per message.
 * - Removed duplicate/overlapping composing calls that extend delays unnecessarily.
 * - handleAutotypingForCommand() was unused dead code — removed.
 * - showTypingAfterCommand() was called AFTER response was already sent (pointless) — removed.
 * - Typing delays now bounded properly.
 */

const fs   = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

const configPath = path.join(__dirname, '..', 'data', 'autotyping.json');

function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
    }
    try {
        return JSON.parse(fs.readFileSync(configPath));
    } catch {
        return { enabled: false };
    }
}

async function autotypingCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner  = await isOwnerOrSudo(senderId, sock, chatId);

        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { text: '❌ This command is only available for the owner!' });
            return;
        }

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(' ').slice(1);
        const config = initConfig();

        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'on' || action === 'enable') {
                config.enabled = true;
            } else if (action === 'off' || action === 'disable') {
                config.enabled = false;
            } else {
                await sock.sendMessage(chatId, { text: '❌ Invalid option! Use: .autotyping on/off' });
                return;
            }
        } else {
            config.enabled = !config.enabled;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        await sock.sendMessage(chatId, {
            text: `✅ Auto-typing has been ${config.enabled ? 'enabled' : 'disabled'}!`
        });

    } catch (error) {
        console.error('Error in autotyping command:', error);
        await sock.sendMessage(chatId, { text: '❌ Error processing command!' });
    }
}

function isAutotypingEnabled() {
    try {
        return initConfig().enabled;
    } catch {
        return false;
    }
}

/**
 * Show a typing indicator before sending a response.
 * Call this BEFORE awaiting sock.sendMessage(), not after.
 * @param {object} sock - Baileys socket
 * @param {string} chatId - JID of the chat
 * @param {number} durationMs - How long to show typing (ms). Capped at 5000.
 */
async function showTyping(sock, chatId, durationMs = 2000) {
    if (!isAutotypingEnabled()) return;
    const bounded = Math.max(500, Math.min(durationMs, 5000));
    try {
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(r => setTimeout(r, bounded));
        await sock.sendPresenceUpdate('paused', chatId);
    } catch {
        // Non-critical — typing indicator failures must not break commands
    }
}

module.exports = {
    autotypingCommand,
    isAutotypingEnabled,
    showTyping,
    // Legacy exports kept so existing call sites don't crash
    handleAutotypingForMessage: showTyping,
};
