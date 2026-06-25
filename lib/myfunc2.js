/**
 * MILESX9- Extended Utility Functions (myfunc2.js)
 * Fixed: removed broken buffergif() that wrote to non-existent XeonMedia paths,
 * removed broken WAVersion() that hit an invalid WA endpoint,
 * added proper timeout to all axios calls,
 * cleaned up unused imports.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const util = require('util');
const BodyForm = require('form-data');
const { fromBuffer } = require('file-type');
const fs = require('fs');
const path = require('path');
const { unlink } = require('fs').promises;

exports.sleep = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.fetchJson = async (url, options = {}) => {
    try {
        const res = await axios({
            method: 'GET',
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36',
            },
            timeout: 15000,
            ...options,
        });
        return res.data;
    } catch (err) {
        throw err;
    }
};

exports.fetchBuffer = async (url, options = {}) => {
    try {
        const res = await axios({
            method: 'GET',
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.70 Safari/537.36',
                'DNT': 1,
                'Upgrade-Insecure-Request': 1,
            },
            timeout: 30000,
            ...options,
            responseType: 'arraybuffer',
        });
        return res.data;
    } catch (err) {
        throw err;
    }
};

exports.fetchUrl = async (url, options = {}) => {
    try {
        const res = await axios({
            method: 'GET',
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36',
            },
            timeout: 15000,
            ...options,
        });
        return res.data;
    } catch (err) {
        throw err;
    }
};

exports.getRandom = (ext) => `${Math.floor(Math.random() * 10000)}${ext}`;

exports.isUrl = (url) => {
    return url.match(new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/, 'gi'));
};

exports.isNumber = (number) => {
    const int = parseInt(number);
    return typeof int === 'number' && !isNaN(int);
};

/**
 * Upload a file to telegra.ph.
 * @param {string} filePath - Absolute path to the file on disk.
 */
exports.TelegraPh = (filePath) => {
    return new Promise(async (resolve, reject) => {
        if (!fs.existsSync(filePath)) return reject(new Error('File not Found'));
        try {
            const form = new BodyForm();
            form.append('file', fs.createReadStream(filePath));
            const data = await axios({
                url: 'https://telegra.ph/upload',
                method: 'POST',
                headers: { ...form.getHeaders() },
                data: form,
                timeout: 20000,
            });
            return resolve('https://telegra.ph' + data.data[0].src);
        } catch (err) {
            return reject(new Error(String(err)));
        }
    });
};

/**
 * Convert a WebP file to MP4 via ezgif.com.
 * NOTE: This depends on an external service and may break if ezgif changes their API.
 */
exports.webp2mp4File = (filePath) => {
    return new Promise((resolve, reject) => {
        const form = new BodyForm();
        form.append('new-image-url', '');
        form.append('new-image', fs.createReadStream(filePath));
        axios({
            method: 'post',
            url: 'https://s6.ezgif.com/webp-to-mp4',
            data: form,
            headers: { 'Content-Type': `multipart/form-data; boundary=${form._boundary}` },
            timeout: 30000,
        }).then(({ data }) => {
            const bodyFormThen = new BodyForm();
            const $ = cheerio.load(data);
            const file = $('input[name="file"]').attr('value');
            if (!file) return reject(new Error('ezgif: no file value found'));
            bodyFormThen.append('file', file);
            bodyFormThen.append('convert', 'Convert WebP to MP4!');
            axios({
                method: 'post',
                url: 'https://ezgif.com/webp-to-mp4/' + file,
                data: bodyFormThen,
                headers: { 'Content-Type': `multipart/form-data; boundary=${bodyFormThen._boundary}` },
                timeout: 30000,
            }).then(({ data }) => {
                const $2 = cheerio.load(data);
                const result = 'https:' + $2('div#output > p.outfile > video > source').attr('src');
                resolve({ status: true, message: 'Converted', result });
            }).catch(reject);
        }).catch(reject);
    });
};
