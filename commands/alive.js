const settings = require('../settings');

async function aliveCommand(sock, chatId, message) {
    try {
        const uptime = process.uptime();
        const d = Math.floor(uptime / 86400);
        const h = Math.floor((uptime % 86400) / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const s = Math.floor(uptime % 60);
        const uptimeStr = `${d}d ${h}h ${m}m ${s}s`;

        const text =
            `┏━━〔 🤖 *${settings.botName}* 〕━━┓\n` +
            `┃ ✅ Status   : Online\n` +
            `┃ ⏱️ Uptime   : ${uptimeStr}\n` +
            `┃ 🔖 Version  : ${settings.version}\n` +
            `┃ 📌 Prefix   : ${settings.prefix}\n` +
            `┗━━━━━━━━━━━━━━━━━━━┛`;

        await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch (error) {
        console.error('Error in alive command:', error);
        await sock.sendMessage(chatId, { text: '✅ Bot is alive!' }, { quoted: message });
    }
}

module.exports = aliveCommand;
