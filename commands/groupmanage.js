/**
 * groupmanage.js
 * Fixed:
 * - groupmanage was missing kick/add/promote/demote/mute/unmute/open/close handlers.
 *   These were routed from index.js but the module only exported setGroup* functions.
 *   Added all missing handlers so the command switch in index.js actually works.
 * - setGroupPhoto() cleanup: always removes temp file in a finally block.
 */

const fs   = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const isAdminCheck = require('../lib/isAdmin');

// ── Shared guard ──────────────────────────────────────────────
async function ensureGroupAndAdmin(sock, chatId, senderId) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' });
        return { ok: false };
    }
    const { isSenderAdmin, isBotAdmin } = await isAdminCheck(sock, chatId, senderId);
    if (!isBotAdmin) {
        await sock.sendMessage(chatId, { text: 'Please make the bot an admin first.' });
        return { ok: false };
    }
    if (!isSenderAdmin) {
        await sock.sendMessage(chatId, { text: 'Only group admins can use this command.' });
        return { ok: false };
    }
    return { ok: true };
}

// ── kick ──────────────────────────────────────────────────────
async function kick(sock, chatId, senderId, mentions, msg) {
    const check = await ensureGroupAndAdmin(sock, chatId, senderId);
    if (!check.ok) return;

    const targets = mentions?.length
        ? mentions
        : [msg.message?.extendedTextMessage?.contextInfo?.participant].filter(Boolean);

    if (!targets.length) {
        return sock.sendMessage(chatId, { text: '❌ Mention or reply to the user to kick.' }, { quoted: msg });
    }
    try {
        await sock.groupParticipantsUpdate(chatId, targets, 'remove');
        await sock.sendMessage(chatId, {
            text: `✅ Kicked: ${targets.map(j => '@' + j.split('@')[0]).join(', ')}`,
            mentions: targets,
        });
    } catch (e) {
        await sock.sendMessage(chatId, { text: `❌ Failed to kick: ${e.message}` });
    }
}

// ── add ───────────────────────────────────────────────────────
async function add(sock, chatId, senderId, mentions, msg, q) {
    const check = await ensureGroupAndAdmin(sock, chatId, senderId);
    if (!check.ok) return;

    let numberToAdd = (q || '').replace(/[^0-9]/g, '');
    if (!numberToAdd && mentions?.length) numberToAdd = mentions[0].split('@')[0];

    if (!numberToAdd) {
        return sock.sendMessage(chatId, { text: '❌ Usage: .add <number> (with country code, no +)' }, { quoted: msg });
    }
    const jid = numberToAdd + '@s.whatsapp.net';
    try {
        const result = await sock.onWhatsApp(jid);
        if (!result?.[0]?.exists) {
            return sock.sendMessage(chatId, { text: `❌ ${numberToAdd} is not on WhatsApp.` }, { quoted: msg });
        }
        await sock.groupParticipantsUpdate(chatId, [jid], 'add');
        await sock.sendMessage(chatId, { text: `✅ Added @${numberToAdd} to the group.`, mentions: [jid] });
    } catch (e) {
        await sock.sendMessage(chatId, { text: `❌ Failed to add user: ${e.message}` });
    }
}

// ── promote ───────────────────────────────────────────────────
async function promote(sock, chatId, senderId, mentions, msg) {
    const check = await ensureGroupAndAdmin(sock, chatId, senderId);
    if (!check.ok) return;

    const targets = mentions?.length
        ? mentions
        : [msg.message?.extendedTextMessage?.contextInfo?.participant].filter(Boolean);

    if (!targets.length) {
        return sock.sendMessage(chatId, { text: '❌ Mention the user to promote.' }, { quoted: msg });
    }
    try {
        await sock.groupParticipantsUpdate(chatId, targets, 'promote');
        await sock.sendMessage(chatId, {
            text: `✅ Promoted: ${targets.map(j => '@' + j.split('@')[0]).join(', ')}`,
            mentions: targets,
        });
    } catch (e) {
        await sock.sendMessage(chatId, { text: `❌ Failed to promote: ${e.message}` });
    }
}

// ── demote ────────────────────────────────────────────────────
async function demote(sock, chatId, senderId, mentions, msg) {
    const check = await ensureGroupAndAdmin(sock, chatId, senderId);
    if (!check.ok) return;

    const targets = mentions?.length
        ? mentions
        : [msg.message?.extendedTextMessage?.contextInfo?.participant].filter(Boolean);

    if (!targets.length) {
        return sock.sendMessage(chatId, { text: '❌ Mention the user to demote.' }, { quoted: msg });
    }
    try {
        await sock.groupParticipantsUpdate(chatId, targets, 'demote');
        await sock.sendMessage(chatId, {
            text: `✅ Demoted: ${targets.map(j => '@' + j.split('@')[0]).join(', ')}`,
            mentions: targets,
        });
    } catch (e) {
        await sock.sendMessage(chatId, { text: `❌ Failed to demote: ${e.message}` });
    }
}

// ── mute / unmute (open / close) ──────────────────────────────
async function mute(sock, chatId, senderId, mentions, msg) {
    const check = await ensureGroupAndAdmin(sock, chatId, senderId);
    if (!check.ok) return;
    try {
        await sock.groupSettingUpdate(chatId, 'announcement'); // only admins can send
        await sock.sendMessage(chatId, { text: '🔇 Group muted — only admins can send messages.' });
    } catch (e) {
        await sock.sendMessage(chatId, { text: `❌ Failed to mute group: ${e.message}` });
    }
}

async function unmute(sock, chatId, senderId, mentions, msg) {
    const check = await ensureGroupAndAdmin(sock, chatId, senderId);
    if (!check.ok) return;
    try {
        await sock.groupSettingUpdate(chatId, 'not_announcement');
        await sock.sendMessage(chatId, { text: '🔊 Group unmuted — everyone can send messages.' });
    } catch (e) {
        await sock.sendMessage(chatId, { text: `❌ Failed to unmute group: ${e.message}` });
    }
}

// open/close are aliases for unmute/mute
const open  = unmute;
const close = mute;

// ── setGroupDescription ───────────────────────────────────────
async function setGroupDescription(sock, chatId, senderId, text, message) {
    const check = await ensureGroupAndAdmin(sock, chatId, senderId);
    if (!check.ok) return;
    const desc = (text || '').trim();
    if (!desc) {
        return sock.sendMessage(chatId, { text: 'Usage: .setgdesc <description>' }, { quoted: message });
    }
    try {
        await sock.groupUpdateDescription(chatId, desc);
        await sock.sendMessage(chatId, { text: '✅ Group description updated.' }, { quoted: message });
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ Failed to update group description.' }, { quoted: message });
    }
}

// ── setGroupName ──────────────────────────────────────────────
async function setGroupName(sock, chatId, senderId, text, message) {
    const check = await ensureGroupAndAdmin(sock, chatId, senderId);
    if (!check.ok) return;
    const name = (text || '').trim();
    if (!name) {
        return sock.sendMessage(chatId, { text: 'Usage: .setgname <new name>' }, { quoted: message });
    }
    try {
        await sock.groupUpdateSubject(chatId, name);
        await sock.sendMessage(chatId, { text: '✅ Group name updated.' }, { quoted: message });
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ Failed to update group name.' }, { quoted: message });
    }
}

// ── setGroupPhoto ─────────────────────────────────────────────
async function setGroupPhoto(sock, chatId, senderId, message) {
    const check = await ensureGroupAndAdmin(sock, chatId, senderId);
    if (!check.ok) return;

    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const imageMessage = quoted?.imageMessage || quoted?.stickerMessage;
    if (!imageMessage) {
        return sock.sendMessage(chatId, { text: 'Reply to an image/sticker with .setgpp' }, { quoted: message });
    }

    const tmpDir  = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const imgPath = path.join(tmpDir, `gpp_${Date.now()}.jpg`);

    try {
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        fs.writeFileSync(imgPath, buffer);

        await sock.updateProfilePicture(chatId, { url: imgPath });
        await sock.sendMessage(chatId, { text: '✅ Group profile photo updated.' }, { quoted: message });
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ Failed to update group profile photo.' }, { quoted: message });
    } finally {
        try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch {}
    }
}

module.exports = {
    kick,
    add,
    promote,
    demote,
    mute,
    unmute,
    open,
    close,
    setGroupDescription,
    setGroupName,
    setGroupPhoto,
};
