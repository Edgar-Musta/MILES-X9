# 🤖 MILESX9WhatsApp Bot — Clean Build

> **Clean rebuild — no obfuscated code, no backdoors, no hardcoded owner numbers, no external pairing servers.**

---

## ⚡ Quick Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure the bot
```bash
cp .env.example .env
```
Edit `.env` and fill in at minimum:
```
OWNER_NUMBER=256701234567   # your number, country code, no + or spaces
```

### 3. Start the bot
```bash
node index.js
```

On first run you will see a **pairing code** in the terminal:
```
🔑 PAIRING CODE: ABCD-EFGH
```
Open WhatsApp on your phone → **Linked Devices** → **Link with phone number** → enter the code.

---

## 📋 Commands

| Command | Description | Who |
|---------|-------------|-----|
| `.alive` | Check bot status & uptime | Everyone |
| `.ping` | Response time & uptime | Everyone |
| `.help` | Full command list | Everyone |
| `.owner` | Show owner contact | Everyone |
| `.pair <number>` | Generate pairing code | Owner |
| `.setprefix <char>` | Change command prefix | Owner |
| `.settings` | View bot settings | Owner |
| `.sudo add/del/list` | Manage sudo users | Owner |
| `.autoread on/off` | Auto-read all messages | Owner |
| `.autostatus on/off` | Auto-view statuses | Owner |
| `.autotyping on/off` | Auto-typing indicator | Owner |
| `.antidelete on/off` | Recover deleted messages | Owner |
| `.cleartmp` | Clear temp files | Owner |
| `.clearsession` | Reset session | Owner |
| **Group commands** | | |
| `.groupinfo` | Show group info | Admins |
| `.hidetag <text>` | Tag all members silently | Admins |
| `.welcome on/off` | Toggle welcome messages | Admins |
| `.kick @user` | Kick a member | Admins |
| `.add <number>` | Add a member | Admins |
| `.promote @user` | Promote to admin | Admins |
| `.demote @user` | Demote from admin | Admins |
| `.mute` / `.unmute` | Lock/unlock group chat | Admins |
| `.setgname <name>` | Change group name | Admins |
| `.setgdesc <desc>` | Change group description | Admins |
| `.setgpp` | Change group photo (reply to image) | Admins |
| `.resetlink` | Reset invite link | Admins |
| `.warn @user` | Warn a member (3 = auto-kick) | Admins |
| `.warnings @user` | View warnings | Admins |
| **Media commands** | | |
| `.sticker` | Convert image/video to sticker | Everyone |
| `.removebg` | Remove image background | Everyone |
| `.blur` | Blur an image | Everyone |
| `.delete` / `.del` | Delete bot message | Owner |
| `.viewonce` / `.vo` | Reveal view-once media | Owner |

---

## 🗂️ Project Structure

```
queen-diva/
├── index.js          ← Main bot (clean, readable)
├── settings.js       ← Bot configuration
├── config.js         ← API keys (add your own)
├── .env.example      ← Copy to .env and fill in
├── package.json
├── commands/         ← All command files (plain JS)
├── lib/              ← Helper libraries
├── data/             ← Bot state (JSON files)
├── session/          ← WhatsApp session (auto-created)
└── tmp/              ← Temp media files (auto-cleaned)
```

---

## 🔒 Security Notes

- **Session files** in `session/` are your WhatsApp credentials. Never share them.
- **`.env`** contains your owner number. Never share it.
- Both files are in `.gitignore` so they won't be accidentally committed.
- No external pairing server is used — pairing codes are generated locally by Baileys.
- No phone numbers are hardcoded anywhere in the source.

---

## 🔧 Hosting on Pterodactyl / MonkeyBytes

1. Upload the project folder (zip it first, then extract on the panel).
2. Set environment variables in the panel's **Startup** tab instead of using `.env`.
3. Set start command to: `node index.js`
4. Node.js version must be **18 or higher**.

---

## 📦 Updating

To update Baileys to the latest version:
```bash
npm install @whiskeysockets/baileys@latest
```
