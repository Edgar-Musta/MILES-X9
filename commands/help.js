const settings = require('../settings');
const fs   = require('fs');
const path = require('path');

function getPrefix() {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/config.json'), 'utf8'));
        return cfg.prefix || settings.prefix;
    } catch { return settings.prefix; }
}

function getMode() {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/config.json'), 'utf8'));
        return cfg.mode || settings.commandMode || 'public';
    } catch { return settings.commandMode || 'public'; }
}

async function helpCommand(sock, chatId, message) {
    const prefix = getPrefix();
    const mode   = getMode();

    const helpMessage =
`┏━━━━━━━━━━━━━━━━━━━━┓
┃   🤖 *${settings.botName}*
┃   Version : ${settings.version}
┃   Owner   : ${settings.botOwner}
┃   Prefix  : ${prefix}
┃   Mode    : ${mode.toUpperCase()}
┗━━━━━━━━━━━━━━━━━━━━┛

*『 GENERAL 』*
▸ ${prefix}alive  ▸ ${prefix}ping  ▸ ${prefix}help
▸ ${prefix}owner  ▸ ${prefix}settings

*『 PAIRING (DM Edgar) 』*
▸ ${prefix}pair <number> — Get your own bot session

*『 OWNER ONLY 』*
▸ ${prefix}mode public/private
▸ ${prefix}setprefix  ▸ ${prefix}sudo
▸ ${prefix}autoread  ▸ ${prefix}autostatus  ▸ ${prefix}autotyping
▸ ${prefix}antidelete  ▸ ${prefix}clearsession  ▸ ${prefix}cleartmp

*『 USER MANAGEMENT (Owner) 』*
▸ ${prefix}users — list all sub-users
▸ ${prefix}users info <number>
▸ ${prefix}users block <number>
▸ ${prefix}users unblock <number>
▸ ${prefix}users remove <number>
▸ ${prefix}block <number>  ▸ ${prefix}unblock <number>

*『 GROUP ADMIN 』*
▸ ${prefix}kick  ▸ ${prefix}add  ▸ ${prefix}promote  ▸ ${prefix}demote
▸ ${prefix}mute  ▸ ${prefix}unmute  ▸ ${prefix}hidetag
▸ ${prefix}warn  ▸ ${prefix}warnings  ▸ ${prefix}resetlink
▸ ${prefix}setgname  ▸ ${prefix}setgdesc  ▸ ${prefix}setgpp
▸ ${prefix}welcome  ▸ ${prefix}groupinfo

*『 MEDIA 』*
▸ ${prefix}sticker  ▸ ${prefix}removebg  ▸ ${prefix}blur
▸ ${prefix}delete  ▸ ${prefix}viewonce

> Powered by *${settings.botName}* 🤖`;

    try {
        await sock.sendMessage(chatId, { text: helpMessage }, { quoted: message });
    } catch (error) {
        console.error('Error in help command:', error);
    }
}

module.exports = helpCommand;
