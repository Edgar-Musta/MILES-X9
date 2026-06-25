const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

async function clearSessionCommand(sock, chatId, msg) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ Only the owner can use this command!'
            }, { quoted: msg });
            return;
        }

        const sessionDir = path.join(__dirname, '../session');
        if (!fs.existsSync(sessionDir)) {
            await sock.sendMessage(chatId, { text: '❌ Session directory not found!' }, { quoted: msg });
            return;
        }

        await sock.sendMessage(chatId, { text: '🔍 Clearing session cache files...' }, { quoted: msg });

        let filesCleared = 0;
        let errors = 0;

        for (const file of fs.readdirSync(sessionDir)) {
            if (file === 'creds.json') continue; // keep credentials
            try {
                fs.unlinkSync(path.join(sessionDir, file));
                filesCleared++;
            } catch {
                errors++;
            }
        }

        await sock.sendMessage(chatId, {
            text: `✅ Session cache cleared!\n• Files removed: ${filesCleared}${errors > 0 ? `\n• Errors: ${errors}` : ''}`
        }, { quoted: msg });

    } catch (error) {
        console.error('Error in clearsession command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to clear session files.' }, { quoted: msg });
    }
}

module.exports = clearSessionCommand;
