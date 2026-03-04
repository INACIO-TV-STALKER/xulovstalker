const axios = require("axios");
const crypto = require("crypto");

const getStalkerAuth = function(config, token) {
    var mac = (config.mac || "").toUpperCase();
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
            "Cookie": cookie, "Accept": "*/*", "Referer": config.url.replace(/\/$/, "") + "/c/"
        }
    };
};

const addon = {
    parseConfig(configBase64) {
        try {
            const data = JSON.parse(Buffer.from(configBase64, 'base64').toString());
            // Compatibilidade: se for lista única, transforma em array
            return data.lists ? data.lists : [data];
        } catch (e) { return []; }
    },

    async authenticate(config) {
        if (!config || !config.url) return null;
        var authData = getStalkerAuth(config, null);
        var baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        var url = baseUrl + "portal.php";
        try {
            var hUrl = url + "?type=stb&action=handshake&sn=" + authData.sn + "&device_id=" + authData.id1 + "&JsHttpRequest=1-0";
            var res = await axios.get(hUrl, { headers: authData.headers, timeout: 5000 });
            var token = res.data?.js?.token || res.data?.token || null;
            if (token) {
                var fullAuth = getStalkerAuth(config, token);
                return { token: token, api: url + "?", authData: fullAuth };
            }
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        const catalogs = lists.map((l, i) => ({
              type: "tv",
              id: "stalker_cat_" + i,
              name: l.name || ("Lista " + (i + 1)),
              extra: [{ name: "genre", isRequired: false }],
              genres: []
        }));
        return {
            id: "org.xulov.stalker.multi",
            version: "3.0.0",
            name: "XuloV Stalker Hub",
            description: "Suporte para até 5 Portais Stalker",
            resources: ["catalog", "stream", "meta"],
            types: ["tv"],
            idPrefixes: ["xlv:"],
            catalogs: catalogs
        };
    },
async getCatalog(type, id, extra, configBase64) {
    const lists = this.parseConfig(configBase64);
    const listIdx = parseInt(id.replace("stalker_cat_", ""));
    const config = lists[listIdx];
    if (!config) return { metas: [] };

    const auth = await this.authenticate(config);
    if (!auth) return { metas: [] };

    try {
        var url = auth.api + "type=itv&action=get_all_channels&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
        var res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
        var rawData = res.data?.js?.data || res.data?.js || [];
        var channels = Array.isArray(rawData) ? rawData : Object.values(rawData);

        // Extrair categorias únicas
        const categories = [...new Set(
            channels
                .map(ch => ch.tv_genre || ch.category || ch.genre)
                .filter(Boolean)
        )];

        // Filtrar por género se existir
        let filtered = channels;
        if (extra && extra.genre) {
            filtered = channels.filter(ch =>
                (ch.tv_genre || ch.category || ch.genre) === extra.genre
            );
        }

        return {
            metas: filtered.map(ch => ({
                id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name)}`,
                name: ch.name,
                type: "tv",
                poster: ch.logo
                    ? (ch.logo.startsWith('http')
                        ? ch.logo
                        : config.url.replace(/\/$/, "") + "/c/" + ch.logo)
                    : "",
                posterShape: "square"
            })),
            genres: categories
        };

    } catch (e) {
        return { metas: [] };
    },

    async getStreams(type, id, configBase64) {
        const parts = id.split(":");
        const listIdx = parseInt(parts[1]);
        const channelId = parts[2];
        const channelName = decodeURIComponent(parts[3] || "Canal");
        
        const lists = this.parseConfig(configBase64);
        const config = lists[listIdx];
        const auth = await this.authenticate(config);
        if (!auth) return { streams: [] };

        try {
            const cmd = encodeURIComponent(`ffrt http://localhost/ch/${channelId}`);
            const sUrl = `${auth.api}type=itv&action=create_link&cmd=${cmd}&sn=${auth.authData.sn}&JsHttpRequest=1-0`;
            const linkRes = await axios.get(sUrl, { headers: auth.authData.headers });
            let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || "";
            if (streamUrl) {
                return { streams: [{ url: streamUrl.replace(/^(ffrt|ffmpeg|rtmp)\s+/, "").trim(), title: "▶️ " + channelName }] };
            }
        } catch (e) {}
        return { streams: [] };
    }
};

module.exports = addon;

