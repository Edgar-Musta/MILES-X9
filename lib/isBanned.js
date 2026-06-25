const fs   = require('fs');
const path = require('path');

const BANNED_PATH = path.join(__dirname, '../data/banned.json');

function isBanned(userId) {
    try {
        if (!fs.existsSync(BANNED_PATH)) return false;
        const bannedUsers = JSON.parse(fs.readFileSync(BANNED_PATH, 'utf8'));
        return Array.isArray(bannedUsers) && bannedUsers.includes(userId);
    } catch {
        return false;
    }
}

module.exports = { isBanned };
