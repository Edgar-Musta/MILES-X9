const settings = require('../settings');
const { isSudo } = require('./index');

// Simple in-memory cache for group metadata (to avoid hammering WA on every message)
const metaCache = new Map();
const META_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedMeta(sock, chatId) {
    const cached = metaCache.get(chatId);
    if (cached && Date.now() - cached.ts < META_TTL) return cached.data;
    try {
        const data = await sock.groupMetadata(chatId);
        metaCache.set(chatId, { data, ts: Date.now() });
        return data;
    } catch {
        return null;
    }
}

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    const ownerNumberClean = (settings.ownerNumber || '').split(':')[0].split('@')[0];
    if (!ownerNumberClean) return false;

    const ownerJid = ownerNumberClean + '@s.whatsapp.net';
    const senderClean = senderId.split(':')[0].split('@')[0];

    // Direct number or JID match
    if (senderId === ownerJid || senderClean === ownerNumberClean) return true;

    // Check sudo list first (cheap)
    try {
        if (await isSudo(senderId)) return true;
    } catch { /* ignore */ }

    // LID check in groups — only if needed (senderId contains @lid)
    if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
        try {
            const meta = await getCachedMeta(sock, chatId);
            if (meta) {
                const match = meta.participants.find(p => {
                    const pClean = (p.id || '').split(':')[0].split('@')[0];
                    return pClean === ownerNumberClean;
                });
                if (match) {
                    // The owner IS in this group — check if this LID maps to them
                    const botLidClean = (sock.user?.lid || '').split(':')[0].split('@')[0];
                    const senderLidClean = senderId.split(':')[0].split('@')[0];
                    if (botLidClean && senderLidClean && botLidClean === senderLidClean) return true;
                }
            }
        } catch { /* non-critical */ }
    }

    // Fallback: phone number substring check
    if (ownerNumberClean && senderId.includes(ownerNumberClean)) return true;

    return false;
}

module.exports = isOwnerOrSudo;
