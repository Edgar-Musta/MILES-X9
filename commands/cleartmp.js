/**
 * cleartmp.js
 * Fixed:
 * - startAutoClear() was called at module load time — means it ran on every
 *   require(), including hot-reloads. Now the interval is only registered once.
 * - clearDirectory() is now synchronous + handles both files and subdirectories.
 */

const fs   = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

function clearDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return { success: true, count: 0, message: `Directory does not exist: ${dirPath}` };
    }
    let count = 0;
    try {
        for (const file of fs.readdirSync(dirPath)) {
            try {
                const filePath = path.join(dirPath, file);
                const stat     = fs.lstatSync(filePath);
                if (stat.isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(filePath);
                }
                count++;
            } catch { /* skip locked/permission-denied files */ }
        }
        return { success: true, count, message: `Cleared ${count} items in ${path.basename(dirPath)}` };
    } catch (err) {
        return { success: false, count: 0, message: `Failed to clear ${path.basename(dirPath)}: ${err.message}` };
    }
}

function clearAllTmp() {
    const results = [
        clearDirectory(path.join(process.cwd(), 'tmp')),
        clearDirectory(path.join(process.cwd(), 'temp')),
    ];
    const totalCount = results.reduce((s, r) => s + r.count, 0);
    const allOk      = results.every(r => r.success);
    return { success: allOk, count: totalCount, message: results.map(r => r.message).join(' | ') };
}

async function clearTmpCommand(sock, chatId, msg) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner  = await isOwnerOrSudo(senderId, sock, chatId);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { text: '❌ This command is only available for the owner!' });
            return;
        }

        const result = clearAllTmp();
        await sock.sendMessage(chatId, {
            text: result.success
                ? `✅ ${result.message}`
                : `❌ ${result.message}`,
        });
    } catch (error) {
        console.error('Error in cleartmp command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to clear temporary files!' });
    }
}

// Auto-clear every 6 hours — registered once at module load
setInterval(() => {
    const result = clearAllTmp();
    if (!result.success) console.error('[Auto Clear]', result.message);
}, 6 * 60 * 60 * 1000);

module.exports = clearTmpCommand;
