/**
 * autostatus.js
 * Fixed:
 * - reactToStatus() used sock.relayMessage() with incorrect status reaction format
 *   which causes WA to flag the bot (potential block). Replaced with sock.sendMessage()
 *   reaction which is the correct Baileys API for reactions.
 * - handleStatusUpdate() had three redundant code paths for the same thing; collapsed to one.
 * - Rate limit retry logic was naive — now uses a simple backoff with a cap.
 * - Config file reads now properly catch parse errors.
 */

const fs   = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

const configPath = path.join(__dirname, '../data/autoStatus.json');

function loadConfig() {
    try {
        if (!fs.existsSync(configPath)) return { enabled: false, reactOn: false };
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return { enabled: false, reactOn: false };
    }
}

function saveConfig(cfg) {
    try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2)); }
    catch (err) { console.error('[autostatus] saveConfig error:', err.message); }
}

async function autoStatusCommand(sock, chatId, msg) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner  = await isOwnerOrSudo(senderId, sock, chatId);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { text: '❌ This command can only be used by the owner!' });
            return;
        }

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const args = text.trim().split(' ').slice(1);
        const config = loadConfig();

        if (!args.length) {
            await sock.sendMessage(chatId, {
                text: `🔄 *Auto Status Settings*\n\n` +
                    `📱 *Auto Status View:* ${config.enabled ? 'ON' : 'OFF'}\n` +
                    `💫 *Status Reactions:* ${config.reactOn ? 'ON' : 'OFF'}\n\n` +
                    `*Commands:*\n` +
                    `.autostatus on\n` +
                    `.autostatus off\n` +
                    `.autostatus react on\n` +
                    `.autostatus react off`
            });
            return;
        }

        const cmd = args[0].toLowerCase();

        if (cmd === 'on') {
            config.enabled = true;
            saveConfig(config);
            await sock.sendMessage(chatId, { text: '✅ Auto status view enabled!' });

        } else if (cmd === 'off') {
            config.enabled = false;
            saveConfig(config);
            await sock.sendMessage(chatId, { text: '❌ Auto status view disabled!' });

        } else if (cmd === 'react') {
            if (!args[1]) {
                await sock.sendMessage(chatId, { text: '❌ Use: .autostatus react on/off' });
                return;
            }
            const sub = args[1].toLowerCase();
            if (sub === 'on') {
                config.reactOn = true;
                saveConfig(config);
                await sock.sendMessage(chatId, { text: '💚 Status reactions enabled!' });
            } else if (sub === 'off') {
                config.reactOn = false;
                saveConfig(config);
                await sock.sendMessage(chatId, { text: '❌ Status reactions disabled!' });
            } else {
                await sock.sendMessage(chatId, { text: '❌ Use: .autostatus react on/off' });
            }

        } else {
            await sock.sendMessage(chatId, { text: '❌ Invalid command! Use .autostatus on/off or .autostatus react on/off' });
        }

    } catch (error) {
        console.error('[autostatus] Command error:', error.message);
        await sock.sendMessage(chatId, { text: '❌ Error managing auto status!' });
    }
}

/**
 * React to a status update using the correct Baileys reaction API.
 * Using relayMessage() for status reactions triggers WA abuse detection.
 */
async function reactToStatus(sock, statusKey) {
    const config = loadConfig();
    if (!config.reactOn) return;
    try {
        await sock.sendMessage(statusKey.remoteJid, {
            react: {
                text: '💚',
                key:  statusKey,
            },
        });
    } catch (err) {
        // Only log unexpected errors; 403 on status reactions is normal (privacy settings)
        if (!err.message?.includes('403') && !err.message?.includes('not-authorized')) {
            console.error('[autostatus] React error:', err.message);
        }
    }
}

/**
 * Handle incoming status messages — view and optionally react.
 * This is called from index.js messages.upsert when chatId === 'status@broadcast'.
 */
async function handleStatusUpdate(sock, statusMsg) {
    const config = loadConfig();
    if (!config.enabled) return;

    // Determine the status key
    let key = null;
    if (statusMsg?.key?.remoteJid === 'status@broadcast') {
        key = statusMsg.key;
    } else if (statusMsg?.messages?.[0]?.key?.remoteJid === 'status@broadcast') {
        key = statusMsg.messages[0].key;
    }
    if (!key) return;

    try {
        // Small delay to avoid hammering WA with rapid reads
        await new Promise(r => setTimeout(r, 800));
        await sock.readMessages([key]);
        await reactToStatus(sock, key);
    } catch (err) {
        if (err.message?.includes('rate-overlimit')) {
            // Back off and retry once
            await new Promise(r => setTimeout(r, 3000));
            try { await sock.readMessages([key]); } catch { /* give up */ }
        }
        // Other errors are non-critical
    }
}

module.exports = { autoStatusCommand, handleStatusUpdate };
