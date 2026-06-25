const fetch = require('node-fetch');
const FormData = require('form-data');
const FileType = require('file-type');
const fs = require('fs');
const path = require('path');

/**
 * Upload image buffer to telegra.ph (reliable, no auth needed)
 * Falls back to catbox.moe if telegra.ph fails.
 */
async function uploadImage(buffer) {
    const fileType = await FileType.fromBuffer(buffer);
    const { ext, mime } = fileType || { ext: 'jpg', mime: 'image/jpeg' };

    // ── Primary: telegra.ph ───────────────────────────────────
    try {
        const form = new FormData();
        form.append('file', buffer, { filename: `upload.${ext}`, contentType: mime });

        const res = await fetch('https://telegra.ph/upload', {
            method: 'POST',
            body: form,
            headers: form.getHeaders(),
            timeout: 15000,
        });

        const json = await res.json();
        if (json?.[0]?.src) {
            return 'https://telegra.ph' + json[0].src;
        }
    } catch (e) {
        console.error('[uploadImage] telegra.ph failed:', e.message);
    }

    // ── Fallback: catbox.moe ──────────────────────────────────
    try {
        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, `upload_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpFile, buffer);

        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', fs.createReadStream(tmpFile), {
            filename: `upload.${ext}`,
            contentType: mime,
        });

        const res = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: form,
            headers: form.getHeaders(),
            timeout: 20000,
        });

        try { fs.unlinkSync(tmpFile); } catch {}

        const url = await res.text();
        if (url?.startsWith('https://')) return url.trim();
    } catch (e) {
        console.error('[uploadImage] catbox.moe failed:', e.message);
    }

    throw new Error('All image upload services failed');
}

module.exports = { uploadImage };
