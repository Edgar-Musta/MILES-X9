/**
 * antidelete.js
 * Fixed:
 * - setInterval for cleanTempIfLarge was registered every time the module was
 *   require()'d in the old code; it is now registered once at module load.
 * - messageStore was a duplicate of deletedMsgStore in index.js; this file now
 *   only owns the command handler + media store logic. The plain-text antidelete
 *   in index.js still handles non-media deletes without needing this module.
 * - storeMessage() and handleMessageRevocation() kept intact for media tracking.
 * - All file reads/writes wrapped in try/catch.
 */

const fs   = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const messageStore   = new Map();
const CONFIG_PATH    = path.join(__dirname, '../data/antidelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp');

if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

// ── Async iterator → Buffer ───────────────────────────────────
async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

// ── Folder size check + cleanup ───────────────────────────────
function getFolderSizeMB(dir) {
    try {
        return fs.readdirSync(dir).reduce((sum, f) => {
            try { return sum + fs.statSync(path.join(dir, f)).size; } catch { return sum; }
        }, 0) / (1024 * 1024);
    } catch { return 0; }
}

function cleanTempIfLarge() {
    try {
        if (getFolderSizeMB(TEMP_MEDIA_DIR) > 200) {
            for (const f of fs.readdirSync(TEMP_MEDIA_DIR)) {
                try { fs.unlinkSync(path.join(TEMP_MEDIA_DIR, f)); } catch {}
            }
        }
    } catch {}
}

// Register cleanup interval ONCE at module load — not inside a function
setInterval(cleanTempIfLarge, 60_000);

// ── Config helpers ────────────────────────────────────────────
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { enabled: false };
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return { enabled: false }; }
}

function saveConfig(config) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); }
    catch (err) { console.error('[antidelete] Config save error:', err.message); }
}

const isOwnerOrSudo = require('../lib/isOwner');

// ── Command handler ───────────────────────────────────────────
async function handleAntideleteCommand(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner  = await isOwnerOrSudo(senderId, sock, chatId);

    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId,
            { text: '*Only the bot owner can use this command.*' },
            { quoted: message }
        );
    }

    const config = loadConfig();

    if (!match) {
        return sock.sendMessage(chatId, {
            text: `*ANTIDELETE*\n\nStatus: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n\n*.antidelete on* — Enable\n*.antidelete off* — Disable`
        }, { quoted: message });
    }

    if (match === 'on') {
        config.enabled = true;
    } else if (match === 'off') {
        config.enabled = false;
    } else {
        return sock.sendMessage(chatId,
            { text: '*Invalid. Use: .antidelete on/off*' },
            { quoted: message }
        );
    }

    saveConfig(config);
    return sock.sendMessage(chatId, {
        text: `*Antidelete ${match === 'on' ? '✅ enabled' : '❌ disabled'}*`
    }, { quoted: message });
}

// ── Store incoming media for antidelete recovery ──────────────
async function storeMessage(sock, message) {
    try {
        if (!loadConfig().enabled) return;
        if (!message.key?.id) return;

        const messageId = message.key.id;
        let content     = '';
        let mediaType   = '';
        let mediaPath   = '';
        let isViewOnce  = false;

        const sender = message.key.participant || message.key.remoteJid;
        const m      = message.message;

        // Bound the store
        if (messageStore.size >= 500) {
            messageStore.delete(messageStore.keys().next().value);
        }

        // View-once detection
        const viewOnceContainer = m?.viewOnceMessageV2?.message || m?.viewOnceMessage?.message;
        if (viewOnceContainer) {
            if (viewOnceContainer.imageMessage) {
                mediaType = 'image';
                content   = viewOnceContainer.imageMessage.caption || '';
                const buf = await streamToBuffer(
                    await downloadContentFromMessage(viewOnceContainer.imageMessage, 'image')
                );
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
                fs.writeFileSync(mediaPath, buf);
                isViewOnce = true;
            } else if (viewOnceContainer.videoMessage) {
                mediaType = 'video';
                content   = viewOnceContainer.videoMessage.caption || '';
                const buf = await streamToBuffer(
                    await downloadContentFromMessage(viewOnceContainer.videoMessage, 'video')
                );
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
                fs.writeFileSync(mediaPath, buf);
                isViewOnce = true;
            }
        } else if (m?.conversation) {
            content = m.conversation;
        } else if (m?.extendedTextMessage?.text) {
            content = m.extendedTextMessage.text;
        } else if (m?.imageMessage) {
            mediaType = 'image';
            content   = m.imageMessage.caption || '';
            const buf = await streamToBuffer(
                await downloadContentFromMessage(m.imageMessage, 'image')
            );
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
            fs.writeFileSync(mediaPath, buf);
        } else if (m?.stickerMessage) {
            mediaType = 'sticker';
            const buf = await streamToBuffer(
                await downloadContentFromMessage(m.stickerMessage, 'sticker')
            );
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.webp`);
            fs.writeFileSync(mediaPath, buf);
        } else if (m?.videoMessage) {
            mediaType = 'video';
            content   = m.videoMessage.caption || '';
            const buf = await streamToBuffer(
                await downloadContentFromMessage(m.videoMessage, 'video')
            );
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
            fs.writeFileSync(mediaPath, buf);
        } else if (m?.audioMessage) {
            mediaType = 'audio';
            const mime = m.audioMessage.mimetype || '';
            const ext  = mime.includes('ogg') ? 'ogg' : 'mp3';
            const buf  = await streamToBuffer(
                await downloadContentFromMessage(m.audioMessage, 'audio')
            );
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.${ext}`);
            fs.writeFileSync(mediaPath, buf);
        }

        messageStore.set(messageId, {
            content, mediaType, mediaPath, sender,
            group:     message.key.remoteJid?.endsWith('@g.us') ? message.key.remoteJid : null,
            timestamp: Date.now(),
        });

        // Anti-ViewOnce: forward media to owner immediately
        if (isViewOnce && mediaType && fs.existsSync(mediaPath)) {
            try {
                const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const caption     = `*Anti-ViewOnce ${mediaType}*\nFrom: @${sender.split('@')[0]}`;
                if (mediaType === 'image') {
                    await sock.sendMessage(ownerNumber, { image: fs.readFileSync(mediaPath), caption, mentions: [sender] });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(ownerNumber, { video: fs.readFileSync(mediaPath), caption, mentions: [sender] });
                }
                try { fs.unlinkSync(mediaPath); } catch {}
            } catch { /* non-critical */ }
        }

    } catch (err) {
        console.error('[antidelete] storeMessage error:', err.message);
    }
}

// ── Handle deletion events (media recovery) ───────────────────
async function handleMessageRevocation(sock, revocationMessage) {
    try {
        if (!loadConfig().enabled) return;

        const messageId = revocationMessage.message?.protocolMessage?.key?.id;
        if (!messageId) return;

        const deletedBy = revocationMessage.participant
            || revocationMessage.key?.participant
            || revocationMessage.key?.remoteJid;

        const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Don't report owner/bot self-deletes
        if (!deletedBy || deletedBy === ownerNumber || deletedBy.includes(sock.user.id.split(':')[0])) return;

        const original = messageStore.get(messageId);
        if (!original) return;

        const { sender, content, mediaType, mediaPath, group } = original;
        const senderName = sender.split('@')[0];

        let groupName = '';
        if (group) {
            try { groupName = (await sock.groupMetadata(group)).subject; } catch {}
        }

        const time = new Date().toLocaleString('en-US', {
            hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric',
        });

        let text = `*🔰 ANTIDELETE REPORT 🔰*\n\n` +
            `*🗑️ Deleted By:* @${deletedBy.split('@')[0]}\n` +
            `*👤 Sender:* @${senderName}\n` +
            `*🕒 Time:* ${time}`;
        if (groupName) text += `\n*👥 Group:* ${groupName}`;
        if (content)   text += `\n\n*💬 Message:*\n${content}`;

        await sock.sendMessage(ownerNumber, { text, mentions: [deletedBy, sender] });

        if (mediaType && mediaPath && fs.existsSync(mediaPath)) {
            const caption = `*Deleted ${mediaType}* from @${senderName}`;
            try {
                const buf = fs.readFileSync(mediaPath);
                if (mediaType === 'image') {
                    await sock.sendMessage(ownerNumber, { image: buf, caption, mentions: [sender] });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(ownerNumber, { video: buf, caption, mentions: [sender] });
                } else if (mediaType === 'sticker') {
                    await sock.sendMessage(ownerNumber, { sticker: buf });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(ownerNumber, { audio: buf, mimetype: 'audio/mpeg', ptt: false });
                }
            } catch (err) {
                await sock.sendMessage(ownerNumber, { text: `⚠️ Could not send deleted media: ${err.message}` });
            }
            try { fs.unlinkSync(mediaPath); } catch {}
        }

        messageStore.delete(messageId);

    } catch (err) {
        console.error('[antidelete] handleMessageRevocation error:', err.message);
    }
}

module.exports = { handleAntideleteCommand, handleMessageRevocation, storeMessage };
