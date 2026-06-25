const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function viewonceCommand(sock, chatId, message) {
    try {
        // Check both direct message and quoted message
        const msg = message.message;
        const quoted = msg?.extendedTextMessage?.contextInfo?.quotedMessage
                    || msg?.imageMessage
                    || msg?.videoMessage;

        const imageMsg = quoted?.imageMessage || (msg?.imageMessage?.viewOnce ? msg.imageMessage : null);
        const videoMsg = quoted?.videoMessage || (msg?.videoMessage?.viewOnce ? msg.videoMessage : null);

        if (!imageMsg && !videoMsg) {
            return await sock.sendMessage(chatId,
                { text: '❌ Reply to a view-once image or video with .vv' },
                { quoted: message }
            );
        }

        if (imageMsg) {
            const stream = await downloadContentFromMessage(imageMsg, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(chatId,
                { image: buffer, caption: imageMsg.caption || '' },
                { quoted: message }
            );
        } else if (videoMsg) {
            const stream = await downloadContentFromMessage(videoMsg, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(chatId,
                { video: buffer, caption: videoMsg.caption || '' },
                { quoted: message }
            );
        }
    } catch (error) {
        console.error('Error in viewonce command:', error.message);
        await sock.sendMessage(chatId,
            { text: '❌ Failed to reveal view-once media.' },
            { quoted: message }
        );
    }
}

module.exports = viewonceCommand;
