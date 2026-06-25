/**
 * userBot.js
 * Runs as a child process for each sub-user session.
 * Each instance manages ONE user's Baileys session independently.
 *
 * Privileges vs owner bot:
 *  - Sub-users can use: alive, ping, help, groupinfo, hidetag, kick, add,
 *    promote, demote, mute, unmute, warn, warnings, welcome, resetlink,
 *    setgname, setgdesc, setgpp, antidelete, autoread, autotyping,
 *    viewonce, sticker, removebg, blur, delete, clear, cleartmp
 *  - Sub-users CANNOT: .sudo, .mode, .setprefix, .clearsession,
 *    .autostatus (WA status spam risk), .pair, .users, .block, .unblock
 *    (those are owner-server-level operations)
 *
 * Environment variables (set by sessionManager.js):
 *   USER_PHONE  — the sub-user's phone number
 *   SESSION_DIR — absolute path to their session directory
 */

require('dotenv').config();

process.on('uncaughtException',   (err)    => console.error('[user-bot uncaughtException]',   err.message));
process.on('unhandledRejection',  (reason) => console.error('[user-bot unhandledRejection]',  reason?.message || reason));

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const fs    = require('fs');
const path  = require('path');
const pino  = require('pino');

const settings   = require('./settings');
const userMgr    = require('./lib/userManager');

const USER_PHONE = process.env.USER_PHONE;
const SESSION_DIR = process.env.SESSION_DIR || path.join(__dirname, 'sessions', USER_PHONE);

if (!USER_PHONE) {
    console.error('[userBot] USER_PHONE env not set. Exiting.');
    process.exit(1);
}

// ── Per-user data directory ───────────────────────────────────
// Each user gets their own data subfolder so settings don't bleed between users
const USER_DATA_DIR = path.join(__dirname, 'sessions', USER_PHONE, 'data');
[SESSION_DIR, USER_DATA_DIR, path.join(__dirname, 'tmp')].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Message cache (bounded) ───────────────────────────────────
const msgCache = new Map();
function cacheMessage(msg) {
    if (!msg?.key?.id) return;
    msgCache.set(msg.key.id, msg.message);
    if (msgCache.size > 500) msgCache.delete(msgCache.keys().next().value);
}

const deletedMsgStore = new Map();
function storeForAntidelete(msg, chatId, senderId, text) {
    if (!msg?.key?.id) return;
    deletedMsgStore.set(msg.key.id, { msg, chatId, senderId, text });
    if (deletedMsgStore.size > 300) deletedMsgStore.delete(deletedMsgStore.keys().next().value);
}

// ── Load commands (re-use main bot commands) ──────────────────
const COMMANDS_DIR = path.join(__dirname, 'commands');
const commands = {};
const ALLOWED_COMMANDS = [
    'alive', 'ping', 'help', 'owner', 'groupinfo', 'hidetag',
    'groupmanage', 'welcome', 'warn', 'warnings', 'resetlink',
    'antidelete', 'autoread', 'autotyping', 'viewonce',
    'stickertelegram', 'removebg', 'img-blur', 'delete',
    'clear', 'cleartmp', 'settings',
];

for (const file of fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.js'))) {
    const name = file.replace('.js', '');
    if (!ALLOWED_COMMANDS.includes(name)) continue;
    try {
        commands[name] = require(path.join(COMMANDS_DIR, file));
    } catch (e) {
        console.warn(`[userBot:${USER_PHONE}] Could not load command ${name}: ${e.message}`);
    }
}

// ── Per-user config helpers ───────────────────────────────────
function getConfigPath(filename) {
    return path.join(USER_DATA_DIR, filename);
}

function getPrefix() {
    try {
        return JSON.parse(fs.readFileSync(getConfigPath('config.json'), 'utf8')).prefix || settings.prefix;
    } catch { return settings.prefix; }
}

function getMode() {
    try {
        return JSON.parse(fs.readFileSync(getConfigPath('config.json'), 'utf8')).mode || 'public';
    } catch { return 'public'; }
}

function getMessageText(msg) {
    const m = msg.message;
    if (!m) return '';
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        ''
    );
}

function getMentions(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

// ── Auth state — loaded ONCE, reused across all reconnects ───
// CRITICAL FIX: previously useMultiFileAuthState() was called inside
// startSession(), meaning every reconnect re-read and re-initialised
// the auth state from disk. In Baileys v7 RC this causes creds.json
// to be rewritten with a new noise key on each call, making WA treat
// every reconnect as a brand-new device → instant 428 on the old socket
// → reconnect loop. Loading auth state once at the top level and passing
// the same state object into every makeWASocket() call fixes this.
let authState  = null;   // set in bootstrap before first startSession()
let saveCreds  = null;
let waVersion  = null;

// ── Reconnect counters ────────────────────────────────────────
let connectionAttempts  = 0;
let consecutiveFailures = 0;
const MAX_FAILURES      = 5;

function startSession() {
    const sock = makeWASocket({
        version:                        waVersion,
        logger:                         pino({ level: 'silent' }),
        printQRInTerminal:              false,
        auth:                           authState,
        browser:                        ['Ubuntu', 'Chrome', '120.0.6099.71'],
        syncFullHistory:                false,
        generateHighQualityLinkPreview: false,
        keepAliveIntervalMs:            60_000,
        connectTimeoutMs:               60_000,
        defaultQueryTimeoutMs:          60_000,
        getMessage: async (key) => msgCache.get(key.id) || { conversation: '' },
    });

    sock.ev.on('creds.update', saveCreds);

    // ── Connection ────────────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            connectionAttempts = 0;
            consecutiveFailures = 0;   // ← reset failure counter on success
            console.log(`[userBot:${USER_PHONE}] ✅ Connected as ${sock.user?.id}`);
            userMgr.activateUser(USER_PHONE);
        }

        if (connection === 'close') {
            const raw      = lastDisconnect?.error;
            const code     = raw?.output?.statusCode ?? raw?.data?.statusCode ?? raw?.statusCode ?? null;
            const errorMsg = raw?.message || String(raw || 'unknown');
            console.log(`[userBot:${USER_PHONE}] Disconnected (${code}) – ${errorMsg}`);

            if (code === DisconnectReason.loggedOut || code === 401) {
                // Logged out / session invalidated — clean exit.
                // sessionManager will decide whether to restart.
                console.log(`[userBot:${USER_PHONE}] Logged out — clearing session.`);
                try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
                userMgr.blockUser(USER_PHONE);
                process.exit(0);

            } else if (code === 428 || code === 515) {
                // 428 = Connection Replaced (transient — WA keepalive or another
                //       socket took over). 515 = WA server restart. Both are normal.
                // Do NOT count toward failure limit. Use longer delay so we don't
                // hammer WA with rapid reconnects from the same IP.
                connectionAttempts++;
                const delay = Math.min(connectionAttempts * 15_000, 60_000);
                console.log(`[userBot:${USER_PHONE}] Transient disconnect (${code}). Reconnecting in ${delay/1000}s...`);
                setTimeout(startSession, delay);

            } else if (code !== null) {
                // Real failure — count toward the limit.
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_FAILURES) {
                    console.error(`[userBot:${USER_PHONE}] ${MAX_FAILURES} consecutive real failures. Exiting.`);
                    process.exit(1);
                }
                const delay = Math.min(consecutiveFailures * 8_000, 30_000);
                console.log(`[userBot:${USER_PHONE}] Failure ${consecutiveFailures}/${MAX_FAILURES}. Retry in ${delay/1000}s`);
                setTimeout(startSession, delay);
            }
        }
    });

    // ── Message handler ───────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                if (!msg.message) continue;

                const chatId   = msg.key.remoteJid;
                const senderId = msg.key.participant || msg.key.remoteJid;
                const fromMe   = msg.key.fromMe;
                const isGroup  = chatId?.endsWith('@g.us');
                const text     = getMessageText(msg);
                const mentions = getMentions(msg);

                cacheMessage(msg);
                if (chatId) storeForAntidelete(msg, chatId, senderId, text);

                // Skip status broadcasts
                if (chatId === 'status@broadcast') continue;

                const prefix = getPrefix();
                if (!text.startsWith(prefix)) continue;

                // Sub-user bots respond to the sub-user themselves (fromMe)
                // OR to any message in public mode.
                // The sub-user is the "owner" of their own bot session.
                const userJid = USER_PHONE + '@s.whatsapp.net';
                const isSessionOwner = fromMe || senderId === userJid || senderId?.includes(USER_PHONE);

                if (getMode() === 'private' && !isSessionOwner) continue;

                const body    = text.slice(prefix.length).trim();
                const [cmd, ...args] = body.split(' ');
                const command = cmd.toLowerCase();
                const q       = args.join(' ').trim();

                console.log(`[userBot:${USER_PHONE}] CMD: ${command} | from: ${senderId}`);

                // ── Blocked command notice ────────────────────
                const OWNER_ONLY = ['sudo','mode','setprefix','clearsession','autostatus',
                                    'pair','users','block','unblock'];
                if (OWNER_ONLY.includes(command)) {
                    await sock.sendMessage(chatId, {
                        text: `⚠️ *${prefix}${command}* is not available in sub-user sessions.\nThis is a server-owner-level command.`
                    }, { quoted: msg });
                    continue;
                }

                switch (command) {
                    case 'alive':
                        await commands.alive?.(sock, chatId, msg); break;
                    case 'ping':
                        await commands.ping?.(sock, chatId, msg); break;
                    case 'help': case 'menu':
                        await commands.help?.(sock, chatId, msg, isGroup); break;
                    case 'owner':
                        await commands.owner?.(sock, chatId, msg); break;
                    case 'settings':
                        await commands.settings?.(sock, chatId, msg); break;
                    case 'autoread':
                        await commands.autoread?.autoreadCommand?.(sock, chatId, msg); break;
                    case 'autotyping':
                        await commands.autotyping?.autotypingCommand?.(sock, chatId, msg); break;
                    case 'antidelete':
                        await commands.antidelete?.handleAntideleteCommand?.(sock, chatId, msg, q); break;
                    case 'groupinfo': case 'ginfo':
                        await commands.groupinfo?.(sock, chatId, msg); break;
                    case 'hidetag': case 'everyone': {
                        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                        await commands.hidetag?.(sock, chatId, senderId, q, quotedMsg, msg);
                        break;
                    }
                    case 'kick': case 'add': case 'promote': case 'demote':
                    case 'mute': case 'unmute': case 'open': case 'close': {
                        const gm = commands.groupmanage;
                        if (gm && typeof gm[command] === 'function') {
                            await gm[command](sock, chatId, senderId, mentions, msg, q);
                        }
                        break;
                    }
                    case 'setgdesc': case 'setgname': case 'setgpp': {
                        const { setGroupDescription, setGroupName, setGroupPhoto } = commands.groupmanage || {};
                        if (command === 'setgdesc') await setGroupDescription?.(sock, chatId, senderId, q, msg);
                        if (command === 'setgname') await setGroupName?.(sock, chatId, senderId, q, msg);
                        if (command === 'setgpp')   await setGroupPhoto?.(sock, chatId, senderId, msg);
                        break;
                    }
                    case 'resetlink':
                        await commands.resetlink?.(sock, chatId, senderId, msg); break;
                    case 'welcome':
                        await commands.welcome?.welcomeCommand?.(sock, chatId, msg, q); break;
                    case 'warn':
                        await commands.warn?.(sock, chatId, senderId, mentions, msg); break;
                    case 'warnings': case 'warnlist':
                        await commands.warnings?.(sock, chatId, msg, mentions); break;
                    case 'stickertelegram': case 'stickertelegrampacks':
                        await commands.stickertelegram?.(sock, chatId, msg, q); break;
                    case 'removebg':
                        await commands.removebg?.exec?.(sock, msg, []); break;
                    case 'blur': case 'imgblur':
                        await commands['img-blur']?.(sock, chatId, msg); break;
                    case 'delete': case 'del':
                        await commands.delete?.(sock, chatId, msg, senderId); break;
                    case 'viewonce': case 'vo': case 'vv':
                        await commands.viewonce?.(sock, chatId, msg); break;
                    case 'clear':
                        await commands.clear?.(sock, chatId, msg); break;
                    case 'cleartmp':
                        await commands.cleartmp?.(sock, chatId, msg); break;
                    default:
                        if (isSessionOwner) {
                            await sock.sendMessage(chatId, {
                                text: `❓ Unknown command: *${prefix}${command}*\nType *${prefix}help* for the list.`
                            }, { quoted: msg });
                        }
                        break;
                }

            } catch (err) {
                console.error(`[userBot:${USER_PHONE}] Handler error:`, err.message);
            }
        }
    });

    // ── Group events ──────────────────────────────────────────
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        try {
            if (action === 'add') {
                const { handleJoinEvent } = commands.welcome || {};
                if (handleJoinEvent) await handleJoinEvent(sock, id, participants);
            }
        } catch (err) {
            console.error(`[userBot:${USER_PHONE}] group-participants error:`, err.message);
        }
    });

    // ── Anti-delete ───────────────────────────────────────────
    sock.ev.on('messages.delete', async (item) => {
        try {
            let cfg = { enabled: false };
            try {
                cfg = JSON.parse(fs.readFileSync(
                    path.join(USER_DATA_DIR, 'antidelete.json'), 'utf8'
                ));
            } catch {}
            if (!cfg?.enabled) return;

            const keys = item.keys || (item.key ? [item.key] : []);
            for (const key of keys) {
                const stored = deletedMsgStore.get(key.id);
                if (!stored?.text) continue;
                const { chatId, senderId, text } = stored;
                await sock.sendMessage(chatId, {
                    text: `🗑️ *Deleted Message*\n👤 From: @${senderId.split('@')[0]}\n\n📝 ${text}`,
                    mentions: [senderId],
                });
            }
        } catch {}
    });

    return sock;
}

// ── Bootstrap ─────────────────────────────────────────────────
// Initialise auth state ONCE here, then pass into startSession().
// Never call useMultiFileAuthState() again inside the reconnect loop.
console.log(`[userBot] Starting session for user: ${USER_PHONE}`);

async function bootstrap() {
    try {
        const auth     = await useMultiFileAuthState(SESSION_DIR);
        authState      = auth.state;
        saveCreds      = auth.saveCreds;
        waVersion      = (await fetchLatestBaileysVersion()).version;
        console.log(`[userBot:${USER_PHONE}] Auth loaded. Baileys v${waVersion.join('.')}`);
        startSession();
    } catch (err) {
        console.error(`[userBot:${USER_PHONE}] Bootstrap failed:`, err.message);
        setTimeout(bootstrap, 10_000);
    }
}

bootstrap();