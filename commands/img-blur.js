cat > ~/MILES-X9/commands/img-blur.js << 'EOF'
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const Jimp = require('jimp');

async function blurCommand(sock, chatId, message, quotedMessage) {
    try {
        let imageBuffer;

        if (quotedMessage) {
            if (!quotedMessage.imageMessage) {
                await sock.sendMessage(chatId, {
                    text: '❌ Please reply to an image message'
                }, { quoted: message });
                return;
            }
            const quoted = {
                message: { imageMessage: quotedMessage.imageMessage }
            };
            imageBuffer = await downloadMediaMessage(quoted, 'buffer', {}, {});
        } else if (message.message?.imageMessage) {
            imageBuffer = await downloadMediaMessage(message, 'buffer', {}, {});
        } else {
            await sock.sendMessage(chatId, {
                text: '❌ Please reply to an image or send an image with caption .blur'
            }, { quoted: message });
            return;
        }

        const image = await Jimp.read(imageBuffer);

        // Scale down to max 800×800 preserving aspect ratio
        const { width, height } = image.bitmap;
        if (width > 800 || height > 800) {
            image.scale(800 / Math.max(width, height));
        }

        image.blur(10);

        const blurredImage = await image.getBufferAsync(Jimp.MIME_JPEG);

        await sock.sendMessage(chatId, {
            image: blurredImage,
            caption: '*[ ✔ ] Image Blurred Successfully*'
        }, { quoted: message });

    } catch (error) {
        console.error('Error in blur command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to blur image. Please try again later.'
        }, { quoted: message });
    }
}

module.exports = blurCommand;
