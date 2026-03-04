const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");
const https = require("https");

// Ignorar erros de certificado SSL (Bypass para o erro que reportaste)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
axios.defaults.httpsAgent = new https.Agent({ rejectUnauthorized: false });

const DATA_PATH = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_PATH, "lists.json");

fs.ensureDirSync(DATA_PATH);
if (!fs.existsSync(DATA_FILE)) { fs.writeJsonSync(DATA_FILE, []); }

const getStalkerAuth = function(config, token) {
    var mac = config.mac.toUpperCase();
    var seed = mac.replace(/:/g, "");
    var id1 = config.id1 || crypto.createHash('md5').update(seed + "id1").digest('hex').toUpperCase();
    var id2 = config.id2 || crypto.createHash('md5').update(seed + "id2").digest('hex').toUpperCase();
    var sig = config.sig || crypto.createHash('md5').update(seed + "sig").digest('hex').toUpperCase();
    var sn = config.sn || crypto.createHash('md5').update(seed + "sn").digest('hex').substring(0, 13).toUpperCase();
    var cookie = "mac=" + encodeURIComponent(mac) + "; stb_lang=en; timezone=Europe/Lisbon;";
    if (token) cookie += " access_token=" + token + ";";
    return {
        sn: sn, id1: id1, id2: id2, sig: sig,
        headers: {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
            "X-User-Agent": "Model: " + (config.model || 'MAG254') + "; SW: 2.18-r14-254; Device ID: " + id1 + "; Device ID2: " + id2 + "; Signature: " + sig + ";",
            "Cookie": cookie,
            "Accept": "*/*",
            "Referer": config.url.replace(/\/$/, "") + "/c/"
        }
    };
};

const addon = {
    // Variável interna para guardar o host dinamicamente
    currentHost: "",

    loadLists: function() { try { return fs.readJsonSync(DATA_FILE); } catch (e) { return []; } },

    deleteList: function(id) {
        try {
            var lists = this.loadLists();
            var updated = lists.filter(function(l) { return l.id.toString() !== id.toString(); });
            fs.writeJsonSync(DATA_FILE, updated, { spaces: 2 });
            return true;
        } catch (err) { return false; }
    },

    async authenticate(portalUrl, config) {
        var authData = getStalkerAuth(config, null);
        var baseUrl = portalUrl.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        var url = baseUrl + "portal.php";
        try {
            var hUrl = url + "?type=stb&action=handshake&sn=" + authData.sn + "&device_id=" + authData.id1 + "&JsHttpRequest=1-0";
            var res = await axios.get(hUrl, { headers: authData.headers, timeout: 6000 });
            var token = res.data && res.data.js ? res.data.js.token : (res.data ? res.data.token : null);
            if (token) {
                var fullAuth = getStalkerAuth(config, token);
                var pUrl = url + "?type=stb&action=get_profile&sn=" + fullAuth.sn + "&stb_type=" + (config.model || 'MAG254') + "&device_id=" + fullAuth.id1 + "&JsHttpRequest=1-0";
                await axios.get(pUrl, { headers: fullAuth.headers });
                return { token: token, api: url + "?", authData: fullAuth };
            }
        } catch (e) { return null; }
    },

    async addList(d) {
        try {
            var lists = this.loadLists();
            var auth = await this.authenticate(d.url, d);
            if (!auth) return false;

            var catUrl = auth.api + "type=itv&action=get_genres&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
            var catRes = await axios.get(catUrl, { headers: auth.authData.headers });
            var rawCats = catRes.data?.js?.data || catRes.data?.js || catRes.data?.data || [];
            var categories = Array.isArray(rawCats) ? rawCats : Object.values(rawCats);

            var chanUrl = auth.api + "type=itv&action=get_all_channels&sn=" + auth.authData.sn + "&token=" + auth.token + "&to_ch=10000&JsHttpRequest=1-0";
            var chanRes = await axios.get(chanUrl, { headers: auth.authData.headers });
            var rawChans = chanRes.data?.js?.data || chanRes.data?.js || chanRes.data?.data || [];
            var allChannels = Array.isArray(rawChans) ? rawChans : Object.values(rawChans);

            var categoriesWithCount = categories.map(function(cat) {
                var count = allChannels.filter(function(ch) {
                    return (ch.category_id || ch.tv_genre_id || "").toString() === cat.id.toString();
                }).length;
                return { id: cat.id, title: count > 0 ? cat.title + " (" + count + ")" : cat.title };
            });

            lists.push({ id: Date.now().toString(), name: d.name, url: d.url, mac: d.mac, model: d.model, cachedCategories: categoriesWithCount });
            fs.writeJsonSync(DATA_FILE, lists, { spaces: 2 });
            return true;
        } catch (err) { return false; }
    },

    getManifest: function() {
        var lists = this.loadLists();
        var catalogs = lists.map(function(l) {
            var options = (l.cachedCategories || []).map(function(c) { return c.title; });
            if (options.length > 0 && !options.includes("Todas")) options.unshift("Todas");
            else if (options.length === 0) options = ["Todas"];

            return {
                type: "tv",
                id: "stalker_list_" + l.id,
                name: l.name,
                extra: [
                    { name: "genre", options: options, isRequired: false },
                    { name: "search", isRequired: false }
                ]
            };
        });

        return {
            id: "org.xulov.stalker.pro.v23",
            version: "31.8.0",
            name: "XuloV Stalker Pro",
            resources: ["catalog", "stream", "meta"],
            types: ["tv"],
            idPrefixes: ["stalker:"],
            catalogs: catalogs,
            behaviorHints: { configurable: true, configurationRequired: false }
        };
    },

    async getCatalog(type, id, extra) {
        var listId = id.split("_")[2];
        var config = this.loadLists().find(function(l) { return l.id === listId; });
        if (!config) return { metas: [] };
        var auth = await this.authenticate(config.url, config);
        if (!auth) return { metas: [] };

        try {
            var genreSelected = (extra && extra.genre) ? extra.genre.trim() : "Todas";
            var categoryId = "0";

            if (genreSelected !== "Todas" && config.cachedCategories) {
                var found = config.cachedCategories.find(function(c) { return c.title === genreSelected; });
                if (found) categoryId = found.id.toString();
            }

            var url = auth.api + "type=itv&action=get_all_channels&sn=" + auth.authData.sn + "&token=" + auth.token + "&to_ch=10000&JsHttpRequest=1-0";
            var res = await axios.get(url, { headers: auth.authData.headers, timeout: 25000 });
            var rawData = res.data?.js?.data || res.data?.js || res.data?.data || [];
            var allChannels = Array.isArray(rawData) ? rawData : Object.values(rawData);

            var filteredChannels = allChannels;
            if (categoryId !== "0") {
                filteredChannels = allChannels.filter(function(ch) {
                    return (ch.category_id || ch.tv_genre_id || "").toString() === categoryId;
                });
            }

            var seenIds = new Set();
            var metas = [];
            filteredChannels.forEach(function(ch) {
                if (ch && ch.id && !seenIds.has(ch.id)) {
                    seenIds.add(ch.id);
                    metas.push({
                        id: "stalker:" + listId + ":" + ch.id + ":" + encodeURIComponent(ch.name || "Canal"),
                        name: ch.name || "Canal",
                        type: "tv",
                        poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "",
                        posterShape: "square",
                        description: ch.name || ""
                    });
                }
            });
            return { metas: metas };
        } catch (e) { return { metas: [] }; }
    },

    async getStreams(type, id) {
        var parts = id.split(":");
        var listId = parts[1];
        var channelId = parts[2];
        var channelName = parts.length >= 4 ? decodeURIComponent(parts[3]) : "Canal";
        
        // Link dinâmico detetado pelo server.cjs
        var proxyUrl = `https://${this.currentHost}/proxy/${listId}/${channelId}`;

        return {
            streams: [{
                url: proxyUrl,
                title: "▶️ " + channelName,
                behaviorHints: { notWeb: true, isLive: true }
            }]
        };
    }
};

module.exports = addon;

