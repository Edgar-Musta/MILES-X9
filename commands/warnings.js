/**
 * warnings.js
 * Fixed: the old version checked warnings[userId] (flat) but warn.js stores
 * warnings[chatId][userId] (nested). Now correctly reads the nested structure.
 */

const fs   = require('fs');
const path = require('path');

const warningsFilePath = path.join(__dirname, '../data/warnings.json');

function loadWarnings() {
    if (!fs.existsSync(warningsFilePath)) {
        fs.writeFileSync(warningsFilePath, JSON.stringify({}), 'utf8');
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(warningsFilePath, 'utf8'));
    } catch {
        return {};
    }
}

async function warningsCommand(sock, chatId, message, mentionedJidList) {
    const warnings = loadWarnings();

    if (!mentionedJidList || mentionedJidList.length === 0) {
        // Show ALL warned users in this group
        const groupWarnings = warnings[chatId];
        if (!groupWarnings || Object.keys(groupWarnings).length === 0) {
            await sock.sendMessage(chatId, { text: '✅ No warnings recorded in this group.' }, { quoted: message });
            return;
        }
        const lines = Object.entries(groupWarnings)
            .filter(([, count]) => count > 0)
            .map(([jid, count]) => `• @${jid.split('@')[0]} — ${count}/3 warning(s)`)
            .join('\n');

        await sock.sendMessage(chatId, {
            text: `*『 GROUP WARNINGS 』*\n\n${lines || 'No active warnings.'}`,
            mentions: Object.keys(groupWarnings),
        }, { quoted: message });
        return;
    }

    // Show warnings for a specific user
    const userToCheck = mentionedJidList[0];
    const warningCount = (warnings[chatId] && warnings[chatId][userToCheck]) || 0;

    await sock.sendMessage(chatId, {
        text: `*『 USER WARNINGS 』*\n\n👤 @${userToCheck.split('@')[0]}\n⚠️ Warnings: ${warningCount}/3`,
        mentions: [userToCheck],
    }, { quoted: message });
}

module.exports = warningsCommand;
