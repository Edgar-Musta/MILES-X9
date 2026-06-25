async function isAdmin(sock, chatId, senderId) {
    // Guard: only valid in group chats
    if (!chatId || !chatId.endsWith('@g.us')) {
        return { isSenderAdmin: false, isBotAdmin: false };
    }

    try {
        // Normalise senderId — could arrive as an object in some Baileys versions
        const senderStr = (typeof senderId === 'string')
            ? senderId
            : (senderId?.id || senderId?.toString?.() || '');

        const metadata = await sock.groupMetadata(chatId);
        if (!metadata?.participants) return { isSenderAdmin: false, isBotAdmin: false };

        const participants = metadata.participants;

        const botId    = sock.user?.id  || '';
        const botLid   = sock.user?.lid || '';
        const botNum   = botId.split(':')[0].split('@')[0];
        const botLidNum = botLid.split(':')[0].split('@')[0];

        const senderNum = senderStr.split(':')[0].split('@')[0];

        function matchesBot(p) {
            const pId     = p.id  || '';
            const pLid    = p.lid || '';
            const pIdNum  = pId.split(':')[0].split('@')[0];
            const pLidNum = pLid.split(':')[0].split('@')[0];
            return (
                pId  === botId  ||
                pLid === botLid ||
                (botNum    && pIdNum  === botNum)    ||
                (botLidNum && pLidNum === botLidNum)
            );
        }

        function matchesSender(p) {
            const pId    = p.id  || '';
            const pLid   = p.lid || '';
            const pIdNum = pId.split(':')[0].split('@')[0];
            const pLidNum = pLid.split(':')[0].split('@')[0];
            return (
                pId  === senderStr ||
                pLid === senderStr ||
                (senderNum && pIdNum  === senderNum) ||
                (senderNum && pLidNum === senderNum)
            );
        }

        const isAdmin = p => p.admin === 'admin' || p.admin === 'superadmin';

        return {
            isBotAdmin:    participants.some(p => matchesBot(p)    && isAdmin(p)),
            isSenderAdmin: participants.some(p => matchesSender(p) && isAdmin(p)),
        };

    } catch (err) {
        console.error('❌ Error in isAdmin:', err.message);
        return { isSenderAdmin: false, isBotAdmin: false };
    }
}

module.exports = isAdmin;
