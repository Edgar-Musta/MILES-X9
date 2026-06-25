/**
 * userManager.js
 * Manages the registry of sub-users who have paired their WhatsApp
 * to the bot service. Stored in data/users.json.
 *
 * User record shape:
 * {
 *   "256701234567": {
 *     phone:     "256701234567",
 *     jid:       "256701234567@s.whatsapp.net",
 *     status:    "active" | "blocked" | "pending",
 *     createdAt: <ISO string>,
 *     blockedAt: <ISO string | null>,
 *     sessionDir:"sessions/256701234567"
 *   }
 * }
 */

const fs   = require('fs');
const path = require('path');

const USERS_PATH = path.join(__dirname, '../data/users.json');

function load() {
    try {
        if (!fs.existsSync(USERS_PATH)) {
            fs.writeFileSync(USERS_PATH, JSON.stringify({}, null, 2));
            return {};
        }
        return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function save(data) {
    try {
        fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[userManager] save error:', err.message);
    }
}

function normalizePhone(raw) {
    return String(raw).replace(/[^0-9]/g, '');
}

// ── Public API ────────────────────────────────────────────────

function getUser(phone) {
    return load()[normalizePhone(phone)] || null;
}

function getAllUsers() {
    return load();
}

function getActiveUsers() {
    const all = load();
    return Object.values(all).filter(u => u.status === 'active');
}

function userExists(phone) {
    return !!load()[normalizePhone(phone)];
}

function isBlocked(phone) {
    const u = getUser(phone);
    return u?.status === 'blocked';
}

function isActive(phone) {
    const u = getUser(phone);
    return u?.status === 'active';
}

function addUser(phone) {
    const p = normalizePhone(phone);
    const all = load();
    if (all[p]) return all[p]; // already exists
    all[p] = {
        phone:      p,
        jid:        p + '@s.whatsapp.net',
        status:     'pending',  // becomes 'active' once session connects
        createdAt:  new Date().toISOString(),
        blockedAt:  null,
        sessionDir: `sessions/${p}`,
    };
    save(all);
    return all[p];
}

function activateUser(phone) {
    const p   = normalizePhone(phone);
    const all = load();
    if (!all[p]) return false;
    all[p].status    = 'active';
    all[p].blockedAt = null;
    save(all);
    return true;
}

function blockUser(phone) {
    const p   = normalizePhone(phone);
    const all = load();
    if (!all[p]) return false;
    all[p].status    = 'blocked';
    all[p].blockedAt = new Date().toISOString();
    save(all);
    return true;
}

function unblockUser(phone) {
    const p   = normalizePhone(phone);
    const all = load();
    if (!all[p]) return false;
    all[p].status    = 'active';
    all[p].blockedAt = null;
    save(all);
    return true;
}

function removeUser(phone) {
    const p   = normalizePhone(phone);
    const all = load();
    if (!all[p]) return false;
    delete all[p];
    save(all);
    return true;
}

module.exports = {
    getUser,
    getAllUsers,
    getActiveUsers,
    userExists,
    isBlocked,
    isActive,
    addUser,
    activateUser,
    blockUser,
    unblockUser,
    removeUser,
    normalizePhone,
};
