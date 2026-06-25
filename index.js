// ============================================================
//  MILESX9 — Main Entry Point (Owner Session)
//  Multi-user build: owner bot manages sub-user sessions.
// ============================================================

require('dotenv').config();

// CRITICAL: Do NOT trap SIGINT or SIGTERM.
// Pterodactyl sends SIGTERM to stop the server — trapping it
// prevents the panel from ever stopping/restarting the bot.
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err.message, err.stack || '');
});
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason?.message || reason);
});

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const fs    = require('fs');
const path  = require('path');
const pino  = require('pino');
const chalk = require('chalk');

const settings       = require('./settings');
const sessionManager = require('./lib/sessionManager');
const userManager    = require('./lib/userManager');

if (!settings.ownerNumber) {
    console.warn(chalk.yellow('\n⚠️  OWNER_NUMBER is not set.'));
    console.warn(chalk.yellow('   Edit settings.js or add OWNER_NUMBER=<your number> to .env\n'));
}

// ── Directory setup ───────────────────────────────────────────
const SESSION_DIR = path.join(__dirname, 'session');
const TMP_DIR     = path.join(__dirname, 'tmp');
const SESSIONS_BASE = path.join(__dirname, 'sessions'); // sub-user sessions live here
[SESSION_DIR, TMP_DIR, path.join(__dirname, 'data'), SESSIONS_BASE].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── In-memory caches (bounded) ────────────────────────────────
const msgCache = new Map();
function cacheMessage(msg) {
    if (!msg?.key?.id) return;
    msgCache.set(msg.key.id, msg.message);
    if (msgCache.size > 1000) msgCache.delete(msgCache.keys().next().value);
}

const deletedMsgStore = new Map();
function storeForAntidelete(msg, chatId, senderId, text) {
    if (!msg?.key?.id) return;
    deletedMsgStore.set(msg.key.id, { msg, chatId, senderId, text });
    if (deletedMsgStore.size > 500) deletedMsgStore.delete(deletedMsgStore.keys().next().value);
}

// ── Command loader ────────────────────────────────────────────
const COMMANDS_DIR = path.join(__dirname, 'commands');
const commands = {};
fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.js')).forEach(file => {
    const name = file.replace('.js', '');
    try {
        commands[name] = require(path.join(COMMANDS_DIR, file));
    } catch (e) {
        console.warn(chalk.yellow(`⚠️  Could not load command: ${name} — ${e.message}`));
    }
});

// ── Helpers ───────────────────────────────────────────────────
const isOwner      = require('./lib/isOwner');
const { isBanned } = require('./lib/isBanned');
const store        = require('./lib/lightweight_store');

function getPrefix() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8')).prefix || settings.prefix;
    } catch { return settings.prefix; }
}

function getMode() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8')).mode || settings.commandMode || 'public';
    } catch { return settings.commandMode || 'public'; }
}

function getMessageText(msg) {
    const m = msg.message;
    if (!m) return '';
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.buttonsResponseMessage?.selectedButtonId ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        ''
    );
}

function getMentions(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

function isAutoReadEnabled() {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'autoread.json'), 'utf8')).enabled; }
    catch { return false; }
}

// ── Reconnect counter ─────────────────────────────────────────
let connectionAttempts = 0;

// ── Main owner bot ────────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version }          = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger:                         pino({ level: 'silent' }),
        printQRInTerminal:              false,
        auth:                           state,
        browser:                        ['Ubuntu', 'Chrome', '120.0.6099.71'],
        syncFullHistory:                false,
        generateHighQualityLinkPreview: false,
        keepAliveIntervalMs:            25_000,
        connectTimeoutMs:               90_000,
        defaultQueryTimeoutMs:          60_000,
        getMessage: async (key) => msgCache.get(key.id) || { conversation: '' },
    });

    store.bind(sock.ev);
    sock.ev.on('creds.update', saveCreds);

    // ── Connection ────────────────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        try {
            if (qr) {
                const qrcode = require('qrcode-terminal');
                console.log(chalk.cyan('\n📷 Scan this QR code with WhatsApp → Linked Devices → Link a Device:\n'));
                qrcode.generate(qr, { small: true });
                console.log(chalk.gray('   QR expires in ~20 seconds. Restart if expired.\n'));
            }

            if (connection === 'open') {
                connectionAttempts = 0;
                console.log(chalk.green(`\n✅ ${settings.botName} [OWNER] connected as ${sock.user?.id}`));
                console.log(chalk.gray(`   Prefix: ${getPrefix()} | Mode: ${getMode()}\n`));

                // Start all previously-active sub-user sessions
                sessionManager.startAllActiveSessions(sock);
            }

            if (connection === 'close') {
                const code   = lastDisconnect?.error?.output?.statusCode;
                const reason = DisconnectReason;

                if (code === reason.loggedOut) {
                    console.log(chalk.red('\n🔴 Logged out. Clearing session and restarting...'));
                    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                    connectionAttempts = 0;
                    msgCache.clear();
                    deletedMsgStore.clear();
                    setTimeout(launchBot, 3000);
                } else if (code === 515) {
                    console.log(chalk.yellow('\n🔄 WA server restart. Reconnecting...'));
                    setTimeout(launchBot, 5000);
                } else if (code === 428) {
                    console.log(chalk.yellow('\n⚠️  Connection timed out (428). Reconnecting in 5s...'));
                    setTimeout(launchBot, 5000);
                } else if (code !== 401) {
                    connectionAttempts++;
                    const delay = Math.min(connectionAttempts * 5000, 30000);
                    console.log(chalk.yellow(`\n⚠️  Disconnected (${code}). Reconnecting in ${delay / 1000}s...`));
                    setTimeout(launchBot, delay);
                }
            }
        } catch (err) {
            console.error('[connection.update error]', err.message);
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

                if (isAutoReadEnabled()) sock.readMessages([msg.key]).catch(() => {});

                if (chatId === 'status@broadcast') {
                    try {
                        const asCfg = JSON.parse(
                            fs.readFileSync(path.join(__dirname, 'data', 'autoStatus.json'), 'utf8')
                        );
                        if (asCfg?.enabled) sock.readMessages([msg.key]).catch(() => {});
                    } catch {}
                    continue;
                }

                const prefix = getPrefix();
                if (!text.startsWith(prefix)) continue;

                // .pair is open to ANYONE who DMs the owner bot — no ban/mode check
                // (ban check would prevent new users from pairing)
                const body    = text.slice(prefix.length).trim();
                const [cmd, ...args] = body.split(' ');
                const command = cmd.toLowerCase();
                const q       = args.join(' ').trim();

                // .pair is always available in DMs regardless of mode
                if (command === 'pair') {
                    await commands.pair?.(sock, chatId, msg, q);
                    continue;
                }

                // Ban and mode checks for all other commands
                if (!fromMe && await isBanned(senderId)) continue;
                if (getMode() === 'private' && !fromMe) {
                    const allowed = await isOwner(senderId, sock, chatId);
                    if (!allowed) continue;
                }

                console.log(chalk.gray(`[CMD] ${command} | from: ${senderId} | chat: ${chatId}`));

                switch (command) {

                    // ── General ───────────────────────────────
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

                    // ── Owner: bot config ─────────────────────
                    case 'mode':
                        await commands.mode?.(sock, chatId, msg, q); break;
                    case 'setprefix':
                        await commands.setprefix?.(sock, chatId, msg); break;
                    case 'sudo':
                        await commands.sudo?.(sock, chatId, msg); break;
                    case 'clearsession':
                        await commands.clearsession?.(sock, chatId, msg); break;
                    case 'cleartmp':
                        await commands.cleartmp?.(sock, chatId, msg); break;

                    // ── Owner: sub-user management ────────────
                    case 'users':
                        await commands.users?.(sock, chatId, msg, q); break;

                    // ── Owner: block/unblock shorthand ────────
                    // These are convenience aliases: .block 256701234567
                    case 'block': {
                        const phone = q.replace(/[^0-9]/g, '');
                        if (!phone) {
                            await sock.sendMessage(chatId, { text: '❌ Usage: .block <number>' }, { quoted: msg });
                            break;
                        }
                        const ownerCheck = await isOwner(senderId, sock, chatId);
                        if (!fromMe && !ownerCheck) {
                            await sock.sendMessage(chatId, { text: '❌ Owner only.' }, { quoted: msg });
                            break;
                        }
                        sessionManager.stopUserSession(phone);
                        const ok = userManager.blockUser(phone);
                        await sock.sendMessage(chatId, {
                            text: ok ? `🚫 Blocked +${phone} and stopped their session.` : `❌ User +${phone} not found.`
                        }, { quoted: msg });
                        break;
                    }
                    case 'unblock': {
                        const phone = q.replace(/[^0-9]/g, '');
                        if (!phone) {
                            await sock.sendMessage(chatId, { text: '❌ Usage: .unblock <number>' }, { quoted: msg });
                            break;
                        }
                        const ownerCheck = await isOwner(senderId, sock, chatId);
                        if (!fromMe && !ownerCheck) {
                            await sock.sendMessage(chatId, { text: '❌ Owner only.' }, { quoted: msg });
                            break;
                        }
                        const ok = userManager.unblockUser(phone);
                        await sock.sendMessage(chatId, {
                            text: ok
                                ? `✅ Unblocked +${phone}. They can now re-pair with *.pair ${phone}*`
                                : `❌ User +${phone} not found.`
                        }, { quoted: msg });
                        break;
                    }

                    // ── Auto features ─────────────────────────
                    case 'autoread':
                        await commands.autoread?.autoreadCommand?.(sock, chatId, msg); break;
                    case 'autostatus':
                        await commands.autostatus?.autoStatusCommand?.(sock, chatId, msg); break;
                    case 'autotyping':
                        await commands.autotyping?.autotypingCommand?.(sock, chatId, msg); break;
                    case 'antidelete':
                        await commands.antidelete?.handleAntideleteCommand?.(sock, chatId, msg, q); break;

                    // ── Group management ──────────────────────
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

                    // ── Media ─────────────────────────────────
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

                    default:
                        if (fromMe || getMode() === 'private') {
                            await sock.sendMessage(chatId, {
                                text: `❓ Unknown command: *${prefix}${command}*\nType *${prefix}help* for the list.`
                            }, { quoted: msg });
                        }
                        break;
                }

            } catch (err) {
                console.error(chalk.red(`[ERROR] Message handler: ${err.message}`));
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
            console.error(chalk.red(`[ERROR] group-participants.update: ${err.message}`));
        }
    });

    // ── Anti-delete ───────────────────────────────────────────
    sock.ev.on('messages.delete', async (item) => {
        try {
            let cfg = { enabled: false };
            try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'antidelete.json'), 'utf8')); } catch {}
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

// ── Entry ─────────────────────────────────────────────────────
console.log(chalk.cyan(`\n╔══════════════════════════════════╗`));
console.log(chalk.cyan(`║   🤖 ${settings.botName.padEnd(26)}║`));
console.log(chalk.cyan(`║   Multi-User Build  v${settings.version.padEnd(12)}║`));
console.log(chalk.cyan(`╚══════════════════════════════════╝\n`));

function launchBot() {
    startBot().catch(err => {
        console.error(chalk.red('[FATAL] startBot threw:'), err.message);
        console.log(chalk.yellow('Retrying in 10 seconds...'));
        setTimeout(launchBot, 10000);
    });
}

launchBot();
