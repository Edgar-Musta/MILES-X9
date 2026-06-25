/**
 * sessionManager.js
 * Spawns and manages per-user bot sessions as child processes.
 * Each sub-user gets their own isolated Baileys session running in
 * a separate Node.js process (userBot.js).
 *
 * The owner bot (index.js) is NOT managed here — it runs independently.
 */

const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');
const userManager = require('./userManager');

// Map of phone → { process, startedAt, restarts }
const runningProcesses = new Map();

const USER_BOT_SCRIPT = path.join(__dirname, '../userBot.js');
const SESSIONS_BASE   = path.join(__dirname, '../sessions');

function ensureSessionsDir() {
    if (!fs.existsSync(SESSIONS_BASE)) {
        fs.mkdirSync(SESSIONS_BASE, { recursive: true });
    }
}

/**
 * Start a sub-user session.
 * @param {string} phone - Phone number (digits only)
 * @param {object} ownerSock - The owner's Baileys socket (to send notifications)
 */
function startUserSession(phone, ownerSock = null) {
    ensureSessionsDir();

    if (runningProcesses.has(phone)) {
        console.log(`[sessionManager] Session for ${phone} already running.`);
        return;
    }

    const sessionDir = path.join(SESSIONS_BASE, phone);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const child = spawn(process.execPath, [USER_BOT_SCRIPT], {
        env: {
            ...process.env,
            USER_PHONE:   phone,
            SESSION_DIR:  sessionDir,
            // Inherit owner's prefix and bot name
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

    const meta = { process: child, startedAt: Date.now(), restarts: 0, phone };
    runningProcesses.set(phone, meta);

    child.stdout.on('data', (d) => {
        process.stdout.write(`[user:${phone}] ${d}`);
    });
    child.stderr.on('data', (d) => {
        process.stderr.write(`[user:${phone}] ${d}`);
    });

    child.on('exit', (code, signal) => {
        runningProcesses.delete(phone);
        console.log(`[sessionManager] Session ${phone} exited (code=${code} signal=${signal})`);

        // Auto-restart if the user is still active, up to 5 times
        const user = userManager.getUser(phone);
        if (user?.status === 'active' && meta.restarts < 5) {
            meta.restarts++;
            console.log(`[sessionManager] Restarting session ${phone} (attempt ${meta.restarts})...`);
            setTimeout(() => startUserSession(phone, ownerSock), 8000);
        }
    });

    child.on('error', (err) => {
        console.error(`[sessionManager] Process error for ${phone}:`, err.message);
    });

    console.log(`[sessionManager] Started session for ${phone} (PID ${child.pid})`);
}

/**
 * Stop a sub-user session gracefully.
 */
function stopUserSession(phone) {
    const meta = runningProcesses.get(phone);
    if (!meta) return false;
    try {
        meta.process.kill('SIGTERM');
    } catch {}
    runningProcesses.delete(phone);
    console.log(`[sessionManager] Stopped session for ${phone}`);
    return true;
}

/**
 * Check if a session is currently running.
 */
function isRunning(phone) {
    return runningProcesses.has(phone);
}

/**
 * Get a list of all running session phones.
 */
function getRunning() {
    return [...runningProcesses.keys()];
}

/**
 * Delete a user's session directory (wipes their pairing).
 */
function deleteSessionDir(phone) {
    const sessionDir = path.join(SESSIONS_BASE, phone);
    try {
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`[sessionManager] Deleted session dir for ${phone}`);
        }
        return true;
    } catch (err) {
        console.error(`[sessionManager] Failed to delete session dir for ${phone}:`, err.message);
        return false;
    }
}

/**
 * Start all active users' sessions (called on owner bot startup).
 */
function startAllActiveSessions(ownerSock = null) {
    const active = userManager.getActiveUsers();
    for (const user of active) {
        // Small stagger to avoid hammering WA simultaneously
        const delay = active.indexOf(user) * 5000;
        setTimeout(() => startUserSession(user.phone, ownerSock), delay);
    }
    console.log(`[sessionManager] Queued ${active.length} active user session(s) to start.`);
}

module.exports = {
    startUserSession,
    stopUserSession,
    isRunning,
    getRunning,
    deleteSessionDir,
    startAllActiveSessions,
};
