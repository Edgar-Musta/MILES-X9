const { handleWelcome } = require('../lib/welcome');
const { isWelcomeOn, getWelcome } = require('../lib/index');

async function welcomeCommand(sock, chatId, message) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.' });
        return;
    }
    const text = message.message?.conversation ||
                 message.message?.extendedTextMessage?.text || '';
    const matchText = text.split(' ').slice(1).join(' ');
    await handleWelcome(sock, chatId, message, matchText);
}

async function handleJoinEvent(sock, id, participants) {
    try {
        const isWelcomeEnabled = await isWelcomeOn(id);
        if (!isWelcomeEnabled) return;

        const customMessage = await getWelcome(id);
        const groupMetadata = await sock.groupMetadata(id);
        const groupName = groupMetadata.subject;
        const groupDesc = groupMetadata.desc || 'No description available';

        for (const participant of participants) {
            try {
                const participantString = typeof participant === 'string'
                    ? participant
                    : (participant.id || participant.toString());
                const user = participantString.split('@')[0];

                let finalMessage;
                if (customMessage) {
                    finalMessage = customMessage
                        .replace(/{user}/g, `@${user}`)
                        .replace(/{group}/g, groupName)
                        .replace(/{description}/g, groupDesc);
                } else {
                    const now = new Date().toLocaleString('en-US', {
                        month: '2-digit', day: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: true
                    });
                    finalMessage =
                        `╭━━━━━━━━━━━━━━━╮\n` +
                        `┃ 👋 *WELCOME*\n` +
                        `┃ @${user}\n` +
                        `┃ to *${groupName}*\n` +
                        `┃ Members: ${groupMetadata.participants.length}\n` +
                        `┃ Time: ${now}\n` +
                        `╰━━━━━━━━━━━━━━━╯\n\n` +
                        `${groupDesc}`;
                }

                await sock.sendMessage(id, {
                    text: finalMessage,
                    mentions: [participantString]
                });
            } catch (err) {
                console.error('Error sending welcome to participant:', err.message);
            }
        }
    } catch (err) {
        console.error('Error in handleJoinEvent:', err.message);
    }
}

module.exports = { welcomeCommand, handleJoinEvent };
