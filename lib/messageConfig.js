// messageConfig.js — optional context info for forwarded-style messages
// You can leave this as-is or remove contextInfo entirely if you prefer plain messages.
const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: false,
    }
};

module.exports = { channelInfo };
