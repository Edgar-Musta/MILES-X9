const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

const configPath = path.join(__dirname, '../data/config.json');

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return {};
    }
}

function saveConfig(cfg) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

async function modeCommand(sock, chatId, message, q) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const ownerCheck = await isOwnerOrSudo(senderId, sock, chatId);

        if (!message.key.fromMe && !ownerCheck) {
            return sock.sendMessage(chatId, {
                text: '❌ Only the owner can change the bot mode.'
            }, { quoted: message });
        }

        const arg = (q || '').trim().toLowerCase();

        if (!arg) {
            const cfg = loadConfig();
            const current = cfg.mode || 'public';
            return sock.sendMessage(chatId, {
                text: `ℹ️ Current mode: *${current.toUpperCase()}*\n\nUsage:\n• .mode public — everyone can use commands\n• .mode private — only owner & sudo can use commands`
            }, { quoted: message });
        }

        if (arg !== 'public' && arg !== 'private') {
            return sock.sendMessage(chatId, {
                text: '❌ Invalid mode. Use: .mode public  or  .mode private'
            }, { quoted: message });
        }

        const cfg = loadConfig();
        cfg.mode = arg;
        saveConfig(cfg);

        await sock.sendMessage(chatId, {
            text: `✅ Bot mode set to *${arg.toUpperCase()}*\n${arg === 'private' ? '🔒 Only owner & sudo users can now use commands.' : '🌐 Everyone can now use commands.'}`
        }, { quoted: message });

    } catch (err) {
        console.error('[mode] Error:', err.message);
        await sock.sendMessage(chatId, { text: '❌ Failed to change mode.' }, { quoted: message });
    }
}

module.exports = modeCommand;
