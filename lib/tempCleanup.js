/**
 * tempCleanup.js
 * Fixed: replaced async fs.readdir callback with synchronous version to avoid
 * leaving dangling callbacks, added explicit error handling so interval
 * never throws into the event loop.
 */

const fs   = require('fs');
const path = require('path');

const MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

function cleanupTempFiles() {
    const dirs = [
        path.join(process.cwd(), 'tmp'),
        path.join(process.cwd(), 'temp'),
    ];

    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            const files = fs.readdirSync(dir);
            const now   = Date.now();
            for (const file of files) {
                const filePath = path.join(dir, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > MAX_AGE_MS) {
                        fs.unlinkSync(filePath);
                    }
                } catch { /* skip files we can't stat/delete */ }
            }
        } catch (err) {
            console.error('[tempCleanup] Error reading directory:', dir, err.message);
        }
    }
}

// Run once on startup, then every hour
cleanupTempFiles();
setInterval(cleanupTempFiles, 60 * 60 * 1000);

module.exports = { cleanupTempFiles };
