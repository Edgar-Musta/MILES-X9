/**
 * hidetag.js
 * Fixed:
 * - Old version saved media to ../temp/ (no mkdir guard) causing ENOENT crashes.
 * - Temp files are now cleaned up after sending.
 * - Function signature updated to match corrected call in index.js.
 */

const isAdmin = require('../lib/isAdmin');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs   = require('fs');
const path = require('path');

const TMP_DIR = path.join(__dirname, '../tmp');

async function downloadToTmp(msgObj, mediaType) {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    const stream = await downloadContentFromMessage(msgObj, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    const filePath = path.join(TMP_DIR, `hidetag_${Date.now()}.${mediaType}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

async function hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' }, { quoted: message });
        return;
    }

    const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

    if (!isBotAdmin) {
        await sock.sendMessage(chatId, { text: 'Please make the bot an admin first.' }, { quoted: message });
        return;
    }

    if (!isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'Only admins can use the .hidetag command.' }, { quoted: message });
        return;
    }

    const groupMetadata = await sock.groupMetadata(chatId);
    const participants  = groupMetadata.participants || [];
    const nonAdmins     = participants.filter(p => !p.admin).map(p => p.id);

    if (!replyMessage) {
        await sock.sendMessage(chatId, {
            text: messageText || '👋 @everyone',
            mentions: nonAdmins,
        });
        return;
    }

    let tempFilePath = null;
    try {
        let content = {};

        if (replyMessage.imageMessage) {
            tempFilePath = await downloadToTmp(replyMessage.imageMessage, 'image');
            content = {
                image:    { url: tempFilePath },
                caption:  messageText || replyMessage.imageMessage.caption || '',
                mentions: nonAdmins,
            };
        } else if (replyMessage.videoMessage) {
            tempFilePath = await downloadToTmp(replyMessage.videoMessage, 'video');
            content = {
                video:    { url: tempFilePath },
                caption:  messageText || replyMessage.videoMessage.caption || '',
                mentions: nonAdmins,
            };
        } else if (replyMessage.documentMessage) {
            tempFilePath = await downloadToTmp(replyMessage.documentMessage, 'document');
            content = {
                document: { url: tempFilePath },
                fileName: replyMessage.documentMessage.fileName,
                caption:  messageText || '',
                mentions: nonAdmins,
            };
        } else if (replyMessage.conversation || replyMessage.extendedTextMessage) {
            content = {
                text:     replyMessage.conversation || replyMessage.extendedTextMessage?.text || '',
                mentions: nonAdmins,
            };
        } else {
            content = { text: messageText || '👋', mentions: nonAdmins };
        }

        if (Object.keys(content).length > 0) {
            await sock.sendMessage(chatId, content);
        }
    } finally {
        if (tempFilePath) {
            try { fs.unlinkSync(tempFilePath); } catch {}
        }
    }
}

module.exports = hideTagCommand;
