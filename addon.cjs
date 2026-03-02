const axios = require("axios");
const crypto = require("crypto");

// Cache em memória para dar velocidade instantânea
const cache = {
    auth: {},     // Guarda tokens
    channels: {}, // Guarda listas de canais
    lastFetch: {} // Controla o tempo
};

const getStalkerAuth = function(config, token) {
    var mac = (config.mac || "").toUpperCase();
    var seed = mac.replace(/:/g, "");
    var id1 = config.id1 || crypto.createHash('md5').update(seed + "id1").digest('hex').toUpperCase();
    var id2 = config.id2 || crypto.createHash('md5').update(seed + "id2").digest('hex').toUpperCase();
    var sn = config.sn || "1234567890ABC";
    var cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;${token ? " access_token=" + token + ";" : ""}`;
    
    return {
        sn: sn,
        headers: {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3",
            "X-User-Agent": `Model: ${config.model || 'MAG254'}; SW: 2.18-r14-254; Device ID: ${id1}; Device ID2: ${config.id2 || id1}; Signature: ${config.sig || ''};`,
            "Cookie": cookie,
            "Referer": config.url.replace(/\/$/, "") + "/c/"
        }
    };
};

const addon = {
    parseConfig(configBase64) {
        try {
            const data = JSON.parse(Buffer.from(configBase64, 'base64').toString());
            return data.lists ? data.lists : [data];
        } catch (e) { return []; }
    },

    async authenticate(config, force = false) {
        const cacheKey = config.url + config.mac;
        if (!force && cache.auth[cacheKey] && (Date.now() - cache.lastFetch[cacheKey] < 3600000)) {
            return cache.auth[cacheKey];
        }

        var authData = getStalkerAuth(config, null);
        var baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        var url = (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/') + "portal.php";
        
        try {
            var hUrl = `${url}?type=stb&action=handshake&sn=${authData.sn}&JsHttpRequest=1-0`;
            var res = await axios.get(hUrl, { headers: authData.headers, timeout: 5000 });
            var token = res.data?.js?.token || res.data?.token;
            
            if (token) {
                const result = { token, api: url + "?", authData: getStalkerAuth(config, token) };
                cache.auth[cacheKey] = result;
                cache.lastFetch[cacheKey] = Date.now();
                return result;
            }
        } catch (e) { console.error("Erro Auth:", e.message); }
        return null;
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        return {
            id: "org.xulov.stalker.multi.v3",
            version: "3.1.0",
            name: "XuloV Stalker Hub",
            description: "Zapping Rápido - Otimizado Tizen",
            resources: ["catalog", "stream", "meta"],
            types: ["tv"],
            idPrefixes: ["xlv:"],
            catalogs: lists.map((l, i) => ({ type: "tv", id: `stalker_cat_${i}`, name: l.name || `Lista ${i+1}` }))
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const listIdx = parseInt(id.replace("stalker_cat_", ""));
        const config = lists[listIdx];
        if (!config) return { metas: [] };

        // Verifica se temos os canais em cache para esta lista
        const cacheKey = "ch_" + config.url + config.mac;
        if (cache.channels[cacheKey]) return { metas: cache.channels[cacheKey] };

        const auth = await this.authenticate(config);
        if (!auth) return { metas: [] };

        try {
            var url = `${auth.api}type=itv&action=get_all_channels&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            var res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
            var rawData = res.data?.js?.data || res.data?.js || [];
            var channels = Array.isArray(rawData) ? rawData : Object.values(rawData);

            const metas = channels.map(ch => ({
                id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name)}`,
                name: ch.name,
                type: "tv",
                poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "",
                posterShape: "square"
            }));

            cache.channels[cacheKey] = metas; // Guarda no cache!
            return { metas };
        } catch (e) { return { metas: [] }; }
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
                const finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|rtmp)\s+/, "").trim();
                return {
                    streams: [{
                        url: finalUrl,
                        title: "▶️ " + channelName,
                        behaviorHints: { 
                            notWeb: true, 
                            isLive: true,
                            proxyHeaders: { "User-Agent": auth.authData.headers["User-Agent"] } 
                        }
                    }]
                };
            }
        } catch (e) {}
        return { streams: [] };
    }
};

module.exports = addon;

