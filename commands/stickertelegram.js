/**
 * stickertelegram.js
 * Fixed:
 * - botToken was used before it was declared (ReferenceError crash)
 * - Added early exit if TELEGRAM_BOT_TOKEN is not set
 * - All temp files now cleaned up even on error
 * - exec() wrapped in a helper that rejects properly
 * - Added timeout to all fetch() calls
 */

const fetch    = require('node-fetch');
const fs       = require('fs');
const path     = require('path');
const sharp    = require('sharp');
const webp     = require('node-webpmux');
const crypto   = require('crypto');
const { exec } = require('child_process');
const settings = require('../settings');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

function execAsync(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 60000 }, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

async function stickerTelegramCommand(sock, chatId, msg) {
    // ── Validate token first — avoids ReferenceError crash ───
    const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!botToken) {
        await sock.sendMessage(chatId, {
            text: '❌ TELEGRAM_BOT_TOKEN is not set in .env — Telegram sticker command is disabled.'
        });
        return;
    }

    try {
        const text = msg.message?.conversation?.trim() ||
                     msg.message?.extendedTextMessage?.text?.trim() || '';
        const args = text.split(' ').slice(1);

        if (!args[0]) {
            await sock.sendMessage(chatId, {
                text: '⚠️ Please enter the Telegram sticker URL!\n\nExample: .stickertelegram https://t.me/addstickers/PackName'
            });
            return;
        }

        if (!args[0].match(/https:\/\/t\.me\/addstickers\//i)) {
            await sock.sendMessage(chatId, {
                text: '❌ Invalid URL! Must be a Telegram sticker URL like:\nhttps://t.me/addstickers/PackName'
            });
            return;
        }

        const packName = args[0].replace('https://t.me/addstickers/', '');

        const stickerSetRes = await fetch(
            `https://api.telegram.org/bot${botToken}/getStickerSet?name=${encodeURIComponent(packName)}`,
            { timeout: 15000 }
        );

        if (!stickerSetRes.ok) {
            throw new Error(`Telegram API error: ${stickerSetRes.status}`);
        }

        const stickerSet = await stickerSetRes.json();
        if (!stickerSet.ok || !stickerSet.result?.stickers?.length) {
            throw new Error('Invalid sticker pack or empty pack');
        }

        const stickers = stickerSet.result.stickers;
        await sock.sendMessage(chatId, {
            text: `📦 Found ${stickers.length} stickers — starting download...`
        });

        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        let successCount = 0;

        for (let i = 0; i < stickers.length; i++) {
            const tempInput  = path.join(tmpDir, `tg_in_${Date.now()}_${i}`);
            const tempOutput = path.join(tmpDir, `tg_out_${Date.now()}_${i}.webp`);

            try {
                const sticker = stickers[i];

                // Get file path from Telegram
                const fileInfoRes = await fetch(
                    `https://api.telegram.org/bot${botToken}/getFile?file_id=${sticker.file_id}`,
                    { timeout: 10000 }
                );
                if (!fileInfoRes.ok) continue;
                const fileData = await fileInfoRes.json();
                if (!fileData.ok || !fileData.result?.file_path) continue;

                // Download the sticker file
                const fileRes = await fetch(
                    `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`,
                    { timeout: 30000 }
                );
                const imageBuffer = await fileRes.buffer();
                fs.writeFileSync(tempInput, imageBuffer);

                const isAnimated = sticker.is_animated || sticker.is_video;
                const ffmpegCmd  = isAnimated
                    ? `ffmpeg -y -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`
                    : `ffmpeg -y -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`;

                await execAsync(ffmpegCmd);

                if (!fs.existsSync(tempOutput)) continue;
                const webpBuffer = fs.readFileSync(tempOutput);

                // Embed sticker metadata
                const img = new webp.Image();
                await img.load(webpBuffer);

                const metadata = {
                    'sticker-pack-id':   crypto.randomBytes(32).toString('hex'),
                    'sticker-pack-name': settings.packname || settings.botName,
                    'emojis': sticker.emoji ? [sticker.emoji] : ['🤖'],
                };

                const exifAttr   = Buffer.from([0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
                const jsonBuffer = Buffer.from(JSON.stringify(metadata), 'utf8');
                const exif       = Buffer.concat([exifAttr, jsonBuffer]);
                exif.writeUIntLE(jsonBuffer.length, 14, 4);
                img.exif = exif;

                const finalBuffer = await img.save(null);
                await sock.sendMessage(chatId, { sticker: finalBuffer });
                successCount++;

                // Rate-limit friendly delay between stickers
                await delay(1200);

            } catch (err) {
                console.error(`[stickertelegram] Error on sticker ${i}:`, err.message);
            } finally {
                // Always clean up temp files, even on error
                try { if (fs.existsSync(tempInput))  fs.unlinkSync(tempInput);  } catch {}
                try { if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch {}
            }
        }

        await sock.sendMessage(chatId, {
            text: `✅ Done! Downloaded ${successCount}/${stickers.length} stickers.`
        });

    } catch (error) {
        console.error('[stickertelegram] Error:', error.message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to process Telegram stickers.\nMake sure the URL is correct and the pack is public.'
        });
    }
}

module.exports = stickerTelegramCommand;
