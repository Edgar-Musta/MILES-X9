/**
 * pair.js — Multi-user pairing command
 *
 * Flow:
 *  1. Any WhatsApp user sends ".pair <theirNumber>" as a DM to the OWNER BOT'S number.
 *  2. The owner bot validates the number, checks they aren't blocked, creates a
 *     user record, spawns a NEW Baileys session for that number, and requests a
 *     pairing code FROM that new session.
 *  3. The code is sent back to the requester via the owner bot DM.
 *  4. The requester enters the code in WhatsApp → Linked Devices → Link with phone number.
 *  5. Their WhatsApp account is now paired to their own independent bot session on the server.
 *
 * The command only works in DMs to the owner bot (not in groups).
 * Existing sub-users who are already active get a reminder instead of a new code.
 * Blocked users are rejected with a generic message.
 */

const userManager    = require('../lib/userManager');
const sessionManager = require('../lib/sessionManager');
const settings       = require('../settings');
const path           = require('path');
const fs             = require('fs');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');

// Track pending pairing sockets so we can clean them up
// Map of phone → { sock, timeout, cancelReconnect }
const pendingSessions = new Map();

/**
 * Creates a temporary Baileys socket to request a pairing code.
 *
 * Returns { code, pairingComplete } where:
 *   code            — 8-char code to show the user (resolves as soon as WA
 *                     issues a QR challenge).
 *   pairingComplete — Promise that resolves when the user enters the code and
 *                     WA fires connection === 'open'. Rejects on 401 (wrong/
 *                     expired code) or after 5 minutes with no success.
 *                     Transient drops (428 keep-alive timeout, 515 server
 *                     restart, etc.) are handled by reconnecting automatically
 *                     — they are NOT treated as failures.
 *
 * @param {string} phone - digits-only phone number, e.g. "256740897162"
 * @returns {Promise<{ code: string, pairingComplete: Promise<void> }>}
 */
async function requestPairingCodeForUser(phone) {
    const SESSION_DIR = path.join(__dirname, '../sessions', phone);

    // Wipe any stale session — ensures a fresh QR/pairing challenge.
    if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    fs.mkdirSync(SESSION_DIR, { recursive: true });

    let isPairingFinished = false;      // ← PREVENT endless reconnects after handshake
    let resolvePaired, rejectPaired;
    const pairingComplete = new Promise((res, rej) => { resolvePaired = res; rejectPaired = rej; });
    let pairTimer = null;
    const pairDeadline = Date.now() + 5 * 60_000;

    // ── Helper: (re)create a socket from current saved state ──────────────
    async function spawnSocket() {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        const { version }          = await fetchLatestBaileysVersion();
        const s = makeWASocket({
            version,
            logger:              pino({ level: 'silent' }),
            printQRInTerminal:   false,
            auth:                state,
            browser:             ['Ubuntu', 'Chrome', '120.0.6099.71'],
            syncFullHistory:     false,
            keepAliveIntervalMs: 60_000,
            connectTimeoutMs:    60_000,
        });
        s.ev.on('creds.update', saveCreds);
        return s;
    }

    // ── Phase 2 helper: attached to every *reconnect* socket ──────────────
    // Watches for connection === 'open'. On a transient drop (428, 515, etc.)
    // it waits 3 s and spawns a new socket. On 401 it rejects permanently.
    function watchForPairing(sock) {
        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (isPairingFinished) return;   // ← no more reconnects after handshake

            if (connection === 'open') {
                clearTimeout(pairTimer);
                isPairingFinished = true;
                try { sock.end(); } catch {}
                resolvePaired();
                return;
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === 401) {
                    clearTimeout(pairTimer);
                    isPairingFinished = true;
                    rejectPaired(new Error('WhatsApp rejected the pairing code (wrong code or expired)'));
                    return;
                }
                if (Date.now() >= pairDeadline) {
                    clearTimeout(pairTimer);
                    isPairingFinished = true;
                    rejectPaired(new Error('Pairing timed out'));
                    return;
                }
                if (isPairingFinished) return;
                console.log(`[pair] Reconnecting pairing socket for ${phone} (code ${statusCode ?? 'unknown'})...`);
                setTimeout(async () => {
                    if (isPairingFinished) return;
                    try   { watchForPairing(await spawnSocket()); }
                    catch (err) { clearTimeout(pairTimer); rejectPaired(err); }
                }, 3000);
            }
        });
    }

    // ── Phase 1: spin up the initial socket and grab the pairing code ─────
    const code = await new Promise(async (resolve, reject) => {
        let sock;
        try { sock = await spawnSocket(); }
        catch (err) { reject(err); rejectPaired(err); return; }

        // Give WA 60 s to issue a QR/pairing challenge.
        const connectTimer = setTimeout(() => {
            try { sock.end(); } catch {}
            const err = new Error('Timed out waiting for WhatsApp pairing challenge');
            reject(err); rejectPaired(err);
        }, 60_000);

        let codeDelivered = false;

        sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (isPairingFinished) return;

            // ── QR fires → intercept and request pairing code ─────────────
            if (qr && !codeDelivered) {
                codeDelivered = true;
                clearTimeout(connectTimer);
                try {
                    const pairingCode = await sock.requestPairingCode(phone);
                    resolve(pairingCode);
                    // 5-minute hard deadline for the user to enter the code.
                    pairTimer = setTimeout(() => {
                        if (isPairingFinished) return;
                        isPairingFinished = true;
                        try { sock.end(); } catch {}
                        rejectPaired(new Error('Pairing timed out — code not entered within 5 minutes'));
                    }, 5 * 60_000);
                } catch (err) {
                    clearTimeout(connectTimer);
                    isPairingFinished = true;
                    try { sock.end(); } catch {}
                    reject(err); rejectPaired(err);
                }
            }

            // ── Handshake completed on the initial socket ──────────────────
            if (connection === 'open') {
                clearTimeout(pairTimer);
                isPairingFinished = true;
                try { sock.end(); } catch {}
                resolvePaired();
            }

            // ── Socket closed ──────────────────────────────────────────────
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (!codeDelivered) {
                    // Failed before we even got a code — nothing to retry.
                    clearTimeout(connectTimer);
                    const err = new Error(`Connection closed prematurely (code ${statusCode ?? 'unknown'})`);
                    reject(err); rejectPaired(err);
                    return;
                }

                // Code was already sent to the user. Handle the drop:
                if (statusCode === 401) {
                    clearTimeout(pairTimer);
                    isPairingFinished = true;
                    rejectPaired(new Error('WhatsApp rejected the pairing code (wrong code or expired)'));
                    return;
                }
                if (Date.now() >= pairDeadline) {
                    clearTimeout(pairTimer);
                    isPairingFinished = true;
                    rejectPaired(new Error('Pairing timed out'));
                    return;
                }
                if (isPairingFinished) return;
                // 428, 515, or unknown — reconnect and keep waiting
                console.log(`[pair] Reconnecting pairing socket for ${phone} (code ${statusCode ?? 'unknown'})...`);
                setTimeout(async () => {
                    if (isPairingFinished) return;
                    try   { watchForPairing(await spawnSocket()); }
                    catch (err) { clearTimeout(pairTimer); rejectPaired(err); }
                }, 3000);
            }
        });
    });

    return { code, pairingComplete };
}

async function pairCommand(sock, chatId, message, q) {
    // Only allow this command in DMs sent directly to the owner bot
    const isGroup = chatId?.endsWith('@g.us');
    if (isGroup) {
        return sock.sendMessage(chatId, {
            text: '❌ The .pair command only works in a private DM to the bot number.',
        }, { quoted: message });
    }

    if (!q) {
        return sock.sendMessage(chatId, {
            text:
                `📲 *MILESX9 Bot Pairing*\n\n` +
                `To pair your WhatsApp number to your own personal bot session:\n\n` +
                `*Usage:* .pair <your number with country code>\n` +
                `*Example:* .pair 256701234567\n\n` +
                `_No + or spaces. Include country code._\n\n` +
                `After pairing, your WhatsApp will have its own independent bot with full group management features.`,
        }, { quoted: message });
    }

    const phone = q.replace(/[^0-9]/g, '');

    if (phone.length < 7 || phone.length > 20) {
        return sock.sendMessage(chatId, {
            text: '❌ Invalid number. Include country code, no + or spaces.\nExample: .pair 256701234567',
        }, { quoted: message });
    }

    // Prevent pairing the owner's own number as a sub-user
    const ownerPhone = (settings.ownerNumber || '').replace(/[^0-9]/g, '');
    if (phone === ownerPhone) {
        return sock.sendMessage(chatId, {
            text: '❌ That is the owner number — it cannot be registered as a sub-user.',
        }, { quoted: message });
    }

    // Check if blocked
    if (userManager.isBlocked(phone)) {
        return sock.sendMessage(chatId, {
            text: '❌ This number is not authorised to use the bot service.',
        }, { quoted: message });
    }

    // Check if already active and running
    if (userManager.isActive(phone) && sessionManager.isRunning(phone)) {
        return sock.sendMessage(chatId, {
            text:
                `✅ *Already Paired*\n\n` +
                `+${phone} already has an active bot session running.\n\n` +
                `If you need to re-pair (e.g. you logged out), please contact the bot owner.`,
        }, { quoted: message });
    }

    // Verify the number is on WhatsApp
    await sock.sendMessage(chatId, { text: '🔍 Checking number...' }, { quoted: message });
    try {
        const result = await sock.onWhatsApp(phone + '@s.whatsapp.net');
        if (!result?.[0]?.exists) {
            return sock.sendMessage(chatId, {
                text: `❌ The number +${phone} is not registered on WhatsApp.`,
            }, { quoted: message });
        }
    } catch (err) {
        return sock.sendMessage(chatId, {
            text: '❌ Could not verify the number. Please try again.',
        }, { quoted: message });
    }

    // Abort any existing pending pairing for this number
    if (pendingSessions.has(phone)) {
        const existing = pendingSessions.get(phone);
        clearTimeout(existing.timeout);
        try { existing.sock?.end(); } catch {}
        pendingSessions.delete(phone);
    }

    await sock.sendMessage(chatId, {
        text: `⏳ Generating pairing code for +${phone}...\nThis may take up to 30 seconds.`,
    }, { quoted: message });

    // Create a user record (status = pending) if not already present
    userManager.addUser(phone);

    // Track this pairing attempt so a second .pair call for the same number
    // can abort the first one cleanly. Previously pendingSessions.set() was
    // never called anywhere, making the abort block at the top a no-op.
    pendingSessions.set(phone, { timeout: null, sock: null });

    try {
        const { code, pairingComplete } = await requestPairingCodeForUser(phone);
        const formatted = code?.match(/.{1,4}/g)?.join('-') || code;

        await sock.sendMessage(chatId, {
            text:
                `✅ *Pairing Code Ready*\n\n` +
                `📱 Number: *+${phone}*\n` +
                `🔑 Code: *${formatted}*\n\n` +
                `*Steps to link:*\n` +
                `1. Open WhatsApp on +${phone}\n` +
                `2. Tap ⋮ → Linked Devices → Link a Device\n` +
                `3. Tap *Link with phone number* (bottom of screen)\n` +
                `4. Enter the code above\n\n` +
                `_You have 5 minutes to enter the code. Your bot will start automatically once linked._`,
        }, { quoted: message });

        // Only spawn userBot AFTER the handshake completes.
        pairingComplete
            .then(() => {
                // Clean up pending session entry
                if (pendingSessions.has(phone)) pendingSessions.delete(phone);
                console.log(`[pair] Handshake complete for ${phone} — starting session.`);
                sessionManager.startUserSession(phone, sock);
                sock.sendMessage(chatId, {
                    text: `🎉 *Pairing successful!*\n\nYour bot for +${phone} is starting now.\nSend *.alive* from that number to confirm it\'s online.`,
                }, { quoted: message }).catch(() => {});
            })
            .catch((err) => {
                if (pendingSessions.has(phone)) pendingSessions.delete(phone);
                console.error(`[pair] Pairing failed after code delivery for ${phone}:`, err.message);
                const user = userManager.getUser(phone);
                if (user?.status === 'pending') userManager.removeUser(phone);
                sock.sendMessage(chatId, {
                    text: `❌ Pairing failed: ${err.message}\n\nPlease try *.pair ${phone}* again.`,
                }, { quoted: message }).catch(() => {});
            });

    } catch (err) {
        console.error(`[pair] Failed to get pairing code for ${phone}:`, err.message);
        const user = userManager.getUser(phone);
        if (user?.status === 'pending') userManager.removeUser(phone);
        if (pendingSessions.has(phone)) pendingSessions.delete(phone);

        await sock.sendMessage(chatId, {
            text:
                `❌ Failed to generate pairing code.\n\n` +
                `Possible reasons:\n` +
                `• The number already has a linked device using a bot\n` +
                `• WhatsApp rate-limited the request (try again in 1 minute)\n` +
                `• The number is not eligible for device linking\n\n` +
                `Error: ${err.message}`,
        }, { quoted: message });
    }
}

module.exports = pairCommand;