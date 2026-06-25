/**
 * MILESX9- Utility Functions (myfunc.js)
 * Fixed: removed fs.watchFile self-reload loop (causes memory leak and SIGINT on reload),
 * removed unused/broken XeonMedia paths, removed defaultMaxListeners import,
 * fixed jam() timezone reference, fixed getSizeMedia() missing reject for non-http/buffer.
 */

const {
    proto,
    delay,
    getContentType
} = require('@whiskeysockets/baileys');
const chalk = require('chalk');
const fs = require('fs');
const Crypto = require('crypto');
const axios = require('axios');
const moment = require('moment-timezone');
const { sizeFormatter } = require('human-readable');
const util = require('util');
const Jimp = require('jimp');
const path = require('path');

const unixTimestampSeconds = (date = new Date()) => Math.floor(date.getTime() / 1000);
exports.unixTimestampSeconds = unixTimestampSeconds;

exports.generateMessageTag = (epoch) => {
    let tag = unixTimestampSeconds().toString();
    if (epoch) tag += '.--' + epoch;
    return tag;
};

exports.processTime = (timestamp, now) => {
    return moment.duration(now - moment(timestamp * 1000)).asSeconds();
};

exports.getRandom = (ext) => {
    return `${Math.floor(Math.random() * 10000)}${ext}`;
};

exports.getBuffer = async (url, options = {}) => {
    try {
        const res = await axios({
            method: 'get',
            url,
            headers: { 'DNT': 1, 'Upgrade-Insecure-Request': 1 },
            ...options,
            responseType: 'arraybuffer',
        });
        return res.data;
    } catch (err) {
        throw err;
    }
};

// getImg is an alias for getBuffer
exports.getImg = exports.getBuffer;

exports.fetchJson = async (url, options = {}) => {
    try {
        const res = await axios({
            method: 'GET',
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36'
            },
            ...options,
        });
        return res.data;
    } catch (err) {
        throw err;
    }
};

exports.runtime = function (seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    const dDisplay = d > 0 ? d + (d === 1 ? ' day, ' : ' days, ') : '';
    const hDisplay = h > 0 ? h + (h === 1 ? ' hour, ' : ' hours, ') : '';
    const mDisplay = m > 0 ? m + (m === 1 ? ' minute, ' : ' minutes, ') : '';
    const sDisplay = s > 0 ? s + (s === 1 ? ' second' : ' seconds') : '';
    return dDisplay + hDisplay + mDisplay + sDisplay;
};

exports.clockString = (ms) => {
    const h = isNaN(ms) ? '--' : Math.floor(ms / 3600000);
    const m = isNaN(ms) ? '--' : Math.floor(ms / 60000) % 60;
    const s = isNaN(ms) ? '--' : Math.floor(ms / 1000) % 60;
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
};

exports.sleep = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.isUrl = (url) => {
    return url.match(new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/, 'gi'));
};

exports.getTime = (format, date) => {
    if (date) {
        return moment(date).locale('id').format(format);
    } else {
        return moment.tz('Africa/Kampala').locale('en').format(format);
    }
};

exports.formatDate = (n, locale = 'en') => {
    const d = new Date(n);
    return d.toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
};

exports.formatp = sizeFormatter({
    std: 'JEDEC',
    decimalPlaces: 2,
    keepTrailingZeroes: false,
    render: (literal, symbol) => `${literal} ${symbol}B`,
});

exports.json = (string) => JSON.stringify(string, null, 2);

exports.logic = (check, inp, out) => {
    if (inp.length !== out.length) throw new Error('Input and Output must have same length');
    for (let i in inp) {
        if (util.isDeepStrictEqual(check, inp[i])) return out[i];
    }
    return null;
};

exports.generateProfilePicture = async (buffer) => {
    const jimp = await Jimp.read(buffer);
    const min = jimp.getWidth();
    const max = jimp.getHeight();
    const cropped = jimp.crop(0, 0, min, max);
    return {
        img: await cropped.scaleToFit(720, 720).getBufferAsync(Jimp.MIME_JPEG),
        preview: await cropped.scaleToFit(720, 720).getBufferAsync(Jimp.MIME_JPEG),
    };
};

exports.bytesToSize = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

exports.getSizeMedia = (filePath) => {
    return new Promise((resolve, reject) => {
        if (/^https?:\/\//.test(filePath)) {
            axios.get(filePath).then((res) => {
                const length = parseInt(res.headers['content-length']);
                if (!isNaN(length)) resolve(exports.bytesToSize(length, 3));
                else reject(new Error('Could not determine content-length'));
            }).catch(reject);
        } else if (Buffer.isBuffer(filePath)) {
            const length = Buffer.byteLength(filePath);
            if (!isNaN(length)) resolve(exports.bytesToSize(length, 3));
            else reject(new Error('Could not determine buffer size'));
        } else {
            reject(new Error('Path must be a URL or Buffer'));
        }
    });
};

exports.parseMention = (text = '') => {
    return [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v => v[1] + '@s.whatsapp.net');
};

exports.getGroupAdmins = (participants) => {
    const admins = [];
    for (const i of participants) {
        if (i.admin === 'superadmin' || i.admin === 'admin') admins.push(i.id);
    }
    return admins;
};

exports.reSize = (buffer, ukur1, ukur2) => {
    return new Promise(async (resolve, reject) => {
        try {
            const baper = await Jimp.read(buffer);
            const ab = await baper.resize(ukur1, ukur2).getBufferAsync(Jimp.MIME_JPEG);
            resolve(ab);
        } catch (e) {
            reject(e);
        }
    });
};

// NOTE: smsg() intentionally removed — it depended on a store parameter that
// is no longer used in this rebuild. If you need it, pass store explicitly.
