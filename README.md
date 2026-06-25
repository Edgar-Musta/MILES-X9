# 🤖 MILESX9 — Multi-User WhatsApp Bot

> **Clean build — no obfuscated code, no backdoors, no hardcoded owner numbers, no external pairing servers.**
> Built on [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) v7.

---

## ✨ What This Bot Can Do

MILESX9 is a **multi-user WhatsApp bot**. The owner runs one server instance, and multiple users can each pair their own WhatsApp number to get their own independent bot session — complete with group management, auto features, and media tools.

- ✅ One server, many users — each with their own isolated session
- ✅ Pairing via WhatsApp pairing codes (no QR scanning needed)
- ✅ Full group admin toolkit
- ✅ Auto-read, auto-status, auto-typing, anti-delete
- ✅ Media tools — blur, background removal, Telegram sticker import
- ✅ Warn system with auto-kick at 3 warnings
- ✅ Sudo user support
- ✅ Per-user private data (settings don't bleed between users)

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
Edit `.env` and set at minimum:
```env
OWNER_NUMBER=256701234567        # your number, country code, no + or spaces
BOT_NAME=MILESX9                 # display name
BOT_OWNER=YourName               # your name
PREFIX=.                         # command prefix
COMMAND_MODE=public              # public or private
TELEGRAM_BOT_TOKEN=              # optional — only needed for .stickertelegram
```

### 3. Start the bot
```bash
node index.js
```

A **QR code** will appear in the terminal: (OR PAIRING CODE)
```
🔑 PAIRING CODE: ABCD-EFGH
```
Open WhatsApp → **Linked Devices** → **Scan QR Code** or **Link with phone number** → enter the code.

---

## 🖥️ Running on a VPS (Recommended)

Use **PM2** to keep the bot running after you close the terminal and survive reboots:

```bash
npm install -g pm2
pm2 start index.js --name "MILESX9"
pm2 save
pm2 startup          # copy and run the command it prints
```

Useful PM2 commands:
```bash
pm2 logs MILESX9     # live logs
pm2 restart MILESX9  # restart
pm2 stop MILESX9     # stop
pm2 status           # check if running
```

---

## 👥 Multi-User System

### How it works
1. A user sends `.pair <their number>` in a **DM to the owner bot's number**
2. The bot sends them a pairing code
3. They enter the code in WhatsApp → Linked Devices → Link with phone number
4. Their own independent bot session starts automatically on the server
5. They can now use all bot commands from their own WhatsApp

### Owner controls
The owner can manage all sub-users with the `.users` command:

| Command | Description |
|---|---|
| `.users` | List all registered sub-users with status |
| `.users info <number>` | View detailed info about a sub-user |
| `.users block <number>` | Block a sub-user and stop their session |
| `.users unblock <number>` | Unblock a sub-user (they must re-pair) |
| `.users remove <number>` | Fully remove user and delete their session data |
| `.block <number>` | Shorthand to block a sub-user |
| `.unblock <number>` | Shorthand to unblock a sub-user |

---

## 📋 Command Reference

### General — available to everyone
| Command | Description |
|---|---|
| `.alive` | Check if the bot is online, uptime |
| `.ping` | Response time and uptime |
| `.help` / `.menu` | Full command list |
| `.owner` | Show owner contact info |
| `.settings` | View current bot configuration |

### Pairing
| Command | Description | Who |
|---|---|---|
| `.pair <number>` | Pair a WhatsApp number to get a personal bot session | Anyone (DM only) |

### Auto Features
| Command | Description | Who |
|---|---|---|
| `.autoread on/off` | Automatically mark all incoming messages as read | Owner / Sub-user |
| `.autostatus on/off` | Automatically view all WhatsApp statuses | Owner only |
| `.autotyping on/off` | Show typing indicator when receiving messages | Owner / Sub-user |
| `.antidelete on/off` | Recover and forward deleted messages | Owner / Sub-user |

### Group Management
| Command | Description | Who |
|---|---|---|
| `.groupinfo` / `.ginfo` | Show group name, size, description, invite link | Admins |
| `.hidetag <text>` / `.everyone` | Tag all group members silently | Admins |
| `.welcome on/off` | Toggle welcome message for new members | Admins |
| `.kick @user` | Remove a member from the group | Admins |
| `.add <number>` | Add a member to the group | Admins |
| `.promote @user` | Promote a member to group admin | Admins |
| `.demote @user` | Demote an admin back to member | Admins |
| `.mute` | Lock the group (only admins can send) | Admins |
| `.unmute` | Unlock the group | Admins |
| `.open` | Open group for all members | Admins |
| `.close` | Close group to members | Admins |
| `.setgname <name>` | Change the group name | Admins |
| `.setgdesc <description>` | Change the group description | Admins |
| `.setgpp` | Change the group photo (reply to an image) | Admins |
| `.resetlink` | Reset the group invite link | Admins |

### Warn System
| Command | Description | Who |
|---|---|---|
| `.warn @user` | Warn a member — auto-kicks at 3 warnings | Admins |
| `.warnings @user` / `.warnlist` | View a member's warning count | Admins |

### Media Tools
| Command | Description |
|---|---|
| `.blur` | Blur an image — send image with caption or reply to one |
| `.removebg` | Remove background from an image — send/reply/provide URL |
| `.stickertelegram <url>` | Import a full Telegram sticker pack as WhatsApp stickers |
| `.viewonce` / `.vo` / `.vv` | Reveal a view-once photo or video |
| `.delete` / `.del` | Delete a bot message |
| `.clear` | Clear bot data |
| `.cleartmp` | Clear temporary media files from the server |

### Owner / Admin Controls
| Command | Description |
|---|---|
| `.mode public` | Allow everyone to use bot commands |
| `.mode private` | Restrict commands to owner and sudo users only |
| `.setprefix <char>` | Change the command prefix (e.g. `.setprefix !`) |
| `.sudo add @user` | Add a sudo user (elevated permissions) |
| `.sudo del @user` | Remove a sudo user |
| `.sudo list` | List all sudo users |
| `.clearsession` | Reset the bot's WhatsApp session |

---

## 🗂️ Project Structure

```
MILES-X9/
├── index.js            ← Owner bot — main entry point
├── userBot.js          ← Sub-user bot — runs as child process per user
├── settings.js         ← Bot configuration
├── config.js           ← API keys
├── .env                ← Environment variables (create from .env.example)
├── package.json
├── commands/           ← All command files
│   ├── alive.js
│   ├── antidelete.js
│   ├── autoread.js
│   ├── autostatus.js
│   ├── autotyping.js
│   ├── clearsession.js
│   ├── cleartmp.js
│   ├── delete.js
│   ├── groupinfo.js
│   ├── groupmanage.js
│   ├── help.js
│   ├── hidetag.js
│   ├── img-blur.js
│   ├── mode.js
│   ├── owner.js
│   ├── pair.js
│   ├── ping.js
│   ├── removebg.js
│   ├── resetlink.js
│   ├── setprefix.js
│   ├── settings.js
│   ├── stickertelegram.js
│   ├── sudo.js
│   ├── users.js
│   ├── viewonce.js
│   ├── warn.js
│   ├── warnings.js
│   └── welcome.js
├── lib/                ← Helper libraries
│   ├── index.js
│   ├── isAdmin.js
│   ├── isBanned.js
│   ├── isOwner.js
│   ├── lightweight_store.js
│   ├── messageConfig.js
│   ├── myfunc.js
│   ├── myfunc2.js
│   ├── sessionManager.js   ← Manages sub-user child processes
│   ├── tempCleanup.js
│   ├── uploadImage.js
│   ├── uploader.js
│   ├── userManager.js      ← Sub-user registry (JSON-backed)
│   └── welcome.js
├── data/               ← Bot state (auto-created, JSON files)
├── session/            ← Owner WhatsApp session (auto-created)
├── sessions/           ← Sub-user sessions, one folder per number
└── tmp/                ← Temporary media files (auto-cleaned)
```

---

## 🔒 Security Notes

- **`session/`** and **`sessions/`** contain WhatsApp credentials. Never share or commit them.
- **`.env`** contains your owner number. Never share it.
- Both are listed in `.gitignore` and will not be accidentally committed.
- No external pairing server is used — pairing codes are generated locally by Baileys.
- No phone numbers are hardcoded anywhere in the source.
- Blocked users are rejected at the pairing stage and cannot re-pair until unblocked by the owner.

---

## 🔧 Hosting Notes

### Pterodactyl panel
1. Upload the project folder (zip it, extract on the panel).
2. Set environment variables in the panel's **Startup** tab instead of `.env`.
3. Set start command to `node index.js`.
4. Node.js **18 or higher** required.

### VPS (Ubuntu)
If you get `Illegal instruction (core dumped)` on startup:
```bash
# Remove native image libraries that require AVX2 CPU support
npm uninstall sharp
sed -i "/^const sharp/d" ~/MILES-X9/commands/stickertelegram.js
```
The bot uses **jimp** (pure JS) for image processing, which works on all CPUs.

---

## 📦 Updating

```bash
git pull
npm install
pm2 restart MILESX9
```

To update Baileys specifically:
```bash
npm install @whiskeysockets/baileys@latest
```

---

## 📄 License

ISC
