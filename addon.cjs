const axios = require("axios");
const crypto = require("crypto");

// Cache para evitar lentidão
const cache = {
    auth: {},     // Armazena tokens e APIs
    channels: {}, // Armazena a lista de canais
    lastFetch: {} // Controla o tempo de expiração
};

const getStalkerAuth = function(config, token) {
    var mac = (config.mac || "").toUpperCase();
    var seed = mac.replace(/:/g, "");
    var id1 = config.id1 || crypto.createHash('md5').update(seed + "id1").digest('hex').toUpperCase();
    var id2 = config.id2 || crypto.createHash('md5').update(seed + "id2").digest('hex').toUpperCase();
    var sn = config.sn || "1234567890ABC";
    var sig = config.sig || "";
    
    var cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;${token ? " access_token=" + token + ";" : ""}`;
    
    return {
        sn: sn,
        headers: {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3",
            "X-User-Agent": `Model: ${config.model || 'MAG254'}; SW: 2.18-r14-254; Device ID: ${id1}; Device ID2: ${id2}; Signature: ${sig};`,
            "Cookie": cookie,
            "Accept": "*/*",
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

    async authenticate(config) {
        const cacheKey = config.url + config.mac;
        // Se temos um token válido há menos de 30 min, usamos o cache (Zapping Ultra Rápido)
        if (cache.auth[cacheKey] && (Date.now() - cache.lastFetch[cacheKey] < 1800000)) {
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
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        return {
            id: "org.xulov.stalker.v3",
            version: "3.2.1",
            name: "XuloV Stalker Hub",
            description: "Otimizado para Samsung Tizen - Sem Headers",
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
                id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name || "Canal")}`, // <-- NOME AQUI
                name: ch.name || "Canal",
                type: "tv",
                poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "https://telegra.ph/file/a85d95e09f6e3c0919313.png",
                posterShape: "square"
            }));

            if (metas.length > 0) cache.channels[cacheKey] = metas;
            return { metas };
        } catch (e) { return { metas: [] }; }
    },
    async getStreams(type, id, configBase64) {
        const parts = id.split(":");
        const listIdx = parseInt(parts[1]);
        const channelId = parts[2];
        
        // RECUPERA O NOME DO CANAL PARA O BOTÃO VERDE
        const channelName = parts.length >= 4 ? decodeURIComponent(parts[3]) : "Canal IPTV";
        
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
                        name: "XuloV Stalker",    // Aparece no topo do botão
                        title: channelName,       // Aparece o NOME DO CANAL por baixo!
                        behaviorHints: { 
                            notWeb: true, 
                            isLive: true 
                        }
                    }]
                };
            }
        } catch (e) {
            console.log("Erro no Stream:", e.message);
        }
        return { streams: [] };
    }
};

module.exports = addon;

