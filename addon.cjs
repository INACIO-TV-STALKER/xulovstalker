const axios = require("axios");
const crypto = require("crypto");

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
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3",
            "X-User-Agent": "Model: " + (config.model || 'MAG254') + "; SW: 2.18-r14-254; Device ID: " + id1 + "; Device ID2: " + id2 + "; Signature: " + sig + ";",
            "Cookie": cookie,
            "Accept": "*/*",
            "Referer": config.url.replace(/\/$/, "") + "/c/"
        }
    };
};

const addon = {
    parseConfig(configBase64) {
        try {
            if (!configBase64) return null;
            return JSON.parse(Buffer.from(configBase64, 'base64').toString());
        } catch (e) { return null; }
    },

    async authenticate(portalUrl, config) {
        if (!config || !portalUrl) return null;
        var authData = getStalkerAuth(config, null);
        var baseUrl = portalUrl.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        var url = baseUrl + "portal.php";
        
        try {
            var hUrl = url + "?type=stb&action=handshake&sn=" + authData.sn + "&device_id=" + authData.id1 + "&JsHttpRequest=1-0";
            var res = await axios.get(hUrl, { headers: authData.headers, timeout: 6000 });
            var token = res.data?.js?.token || res.data?.token || null;
            if (token) {
                var fullAuth = getStalkerAuth(config, token);
                var pUrl = url + "?type=stb&action=get_profile&sn=" + fullAuth.sn + "&stb_type=" + (config.model || 'MAG254') + "&device_id=" + fullAuth.id1 + "&JsHttpRequest=1-0";
                await axios.get(pUrl, { headers: fullAuth.headers });
                return { token: token, api: url + "?", authData: fullAuth };
            }
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const config = this.parseConfig(configBase64);
        let options = ["Todas"];
        if (config) {
            const auth = await this.authenticate(config.url, config);
            if (auth) {
                try {
                    const catUrl = `${auth.api}type=itv&action=get_genres&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const catRes = await axios.get(catUrl, { headers: auth.authData.headers });
                    const rawCats = catRes.data?.js?.data || catRes.data?.js || [];
                    const categories = Array.isArray(rawCats) ? rawCats : Object.values(rawCats);
                    categories.forEach(c => { if (c.title) options.push(c.title); });
                } catch (e) {}
            }
        }
        return {
            id: "org.xulov.stalker.tizen",
            version: "2.0.1",
            name: "XuloV Stalker Tizen" + (config ? " ✅" : ""),
            description: "Otimizado para Samsung TV",
            resources: ["catalog", "stream", "meta"],
            types: ["tv"],
            idPrefixes: ["stalker:"],
            catalogs: config ? [{
                type: "tv",
                id: "stalker_live",
                name: "Canais IPTV",
                extra: [{ name: "genre", options: options, isRequired: false }]
            }] : []
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const config = this.parseConfig(configBase64);
        const auth = await this.authenticate(config.url, config);
        if (!auth) return { metas: [] };
        try {
            var genreSelected = (extra && extra.genre) ? extra.genre.trim() : "Todas";
            var url = auth.api + "type=itv&action=get_all_channels&sn=" + auth.authData.sn + "&token=" + auth.token + "&to_ch=10000&JsHttpRequest=1-0";
            var res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
            var rawData = res.data?.js?.data || res.data?.js || res.data?.data || [];
            var allChannels = Array.isArray(rawData) ? rawData : Object.values(rawData);

            if (genreSelected !== "Todas") {
                const catUrl = `${auth.api}type=itv&action=get_genres&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const catRes = await axios.get(catUrl, { headers: auth.authData.headers });
                const cats = Array.isArray(catRes.data?.js?.data) ? catRes.data.js.data : Object.values(catRes.data?.js?.data || {});
                const foundCat = cats.find(c => c.title === genreSelected);
                if (foundCat) {
                    allChannels = allChannels.filter(ch => (ch.category_id || ch.tv_genre_id || "").toString() === foundCat.id.toString());
                }
            }

            var metas = [];
            var seenIds = new Set();
            allChannels.forEach(function(ch) {
                if (ch && ch.id && !seenIds.has(ch.id)) {
                    seenIds.add(ch.id);
                    metas.push({
                        id: "stalker:live:" + ch.id + ":" + encodeURIComponent(ch.name || "Canal"),
                        name: ch.name || "Canal",
                        type: "tv",
                        poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "",
                        posterShape: "square"
                    });
                }
            });
            return { metas: metas };
        } catch (e) { return { metas: [] }; }
    }, // ESTA VÍRGULA AQUI É O QUE FALTA!

    async getStreams(type, id, configBase64, reqHost) {
        var parts = id.split(":");
        var channelId = parts[2];
        var channelName = parts.length >= 4 ? decodeURIComponent(parts[3]) : "Canal";
        const config = this.parseConfig(configBase64);
        const auth = await this.authenticate(config.url, config);
        if (!auth) return { streams: [] };

        try {
            const cmd = encodeURIComponent(`ffrt http://localhost/ch/${channelId}`);
            const sUrl = `${auth.api}type=itv&action=create_link&cmd=${cmd}&sn=${auth.authData.sn}&JsHttpRequest=1-0`;
            const linkRes = await axios.get(sUrl, { headers: auth.authData.headers });
            let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;
            
            if (typeof streamUrl === 'string') {
                const finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                return {
                    streams: [{
                        url: finalUrl,
                        title: "▶️ " + channelName,
                        behaviorHints: { notWeb: true, isLive: true }
                    }]
                };
            }
        } catch (e) {}
        return { streams: [] };
    }
};

module.exports = addon;

