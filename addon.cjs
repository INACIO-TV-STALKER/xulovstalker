const axios = require("axios");
const crypto = require("crypto");

const cache = { auth: {}, channels: {}, lastFetch: {} };

const getStalkerAuth = function(config, token) {
    const mac = (config.mac || "").toUpperCase().trim();
    const seed = mac.replace(/:/g, "");
    const id1 = config.id1 || crypto.createHash('md5').update(seed + "id1").digest('hex').toUpperCase();
    const sn = config.sn || "1234567890ABC";
    const cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;${token ? " access_token=" + token + ";" : ""}`;
    
    return {
        sn: sn,
        headers: {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3",
            "X-User-Agent": `Model: ${config.model || 'MAG254'}; SW: 2.18-r14-254; Device ID: ${id1}; Device ID2: ${id1}; Signature: ;`,
            "Cookie": cookie,
            "Referer": config.url.replace(/\/$/, "") + "/c/"
        }
    };
};

const addon = {
    parseConfig(configBase64) {
        try {
            const decoded = Buffer.from(configBase64, 'base64').toString();
            const data = JSON.parse(decoded);
            return data.lists || (data.url ? [data] : []);
        } catch (e) { 
            console.error("❌ Erro ao ler configuração Base64");
            return []; 
        }
    },

    async authenticate(config) {
        if (!config || !config.url) return null;
        const cacheKey = config.url + config.mac;

        if (cache.auth[cacheKey] && (Date.now() - cache.lastFetch[cacheKey] < 3000000)) {
            return cache.auth[cacheKey];
        }

        const authData = getStalkerAuth(config, null);
        let baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const url = baseUrl + "portal.php";

        try {
            console.log(`[Auth] A tentar login em: ${baseUrl} com MAC: ${config.mac}`);
            const hUrl = `${url}?type=stb&action=handshake&sn=${authData.sn}&JsHttpRequest=1-0`;
            const res = await axios.get(hUrl, { headers: authData.headers, timeout: 8000 });
            const token = res.data?.js?.token || res.data?.token;

            if (token) {
                console.log(`✅ Login com Sucesso! Token: ${token.substring(0,5)}...`);
                const result = { token, api: url + "?", authData: getStalkerAuth(config, token) };
                cache.auth[cacheKey] = result;
                cache.lastFetch[cacheKey] = Date.now();
                return result;
            } else {
                console.error("❌ Portal recusou o aperto de mão (Handshake). MAC ou URL podem estar errados.");
            }
        } catch (e) {
            console.error(`❌ Erro de Rede na Auth: ${e.message}`);
        }
        return null;
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        console.log(`[Manifest] Carregadas ${lists.length} listas.`);
        return {
            id: "org.xulov.stalker.v3",
            version: "3.3.0",
            name: "XuloV Stalker Hub",
            description: "IPTV Multi-Lista Estável",
            resources: ["catalog", "stream", "meta"],
            types: ["tv"],
            idPrefixes: ["xlv:"],
            catalogs: lists.map((l, i) => ({ 
                type: "tv", 
                id: `stalker_cat_${i}`, 
                name: l.name || `Lista ${i+1}` 
            }))
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
            console.log(`[Catalog] A carregar canais da lista ${listIdx}...`);
            const url = `${auth.api}type=itv&action=get_all_channels&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
            const rawData = res.data?.js?.data || res.data?.js || [];
            const channels = Array.isArray(rawData) ? rawData : Object.values(rawData);

            console.log(`✅ Foram encontrados ${channels.length} canais.`);

            const metas = channels.map(ch => ({
                id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name || "Canal")}`,
                name: ch.name || "Canal",
                type: "tv",
                poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "https://telegra.ph/file/a85d95e09f6e3c0919313.png",
                posterShape: "square"
            }));

            if (metas.length > 0) cache.channels[cacheKey] = metas;
            return { metas };
        } catch (e) {
            console.error(`❌ Erro ao obter catálogo: ${e.message}`);
            return { metas: [] };
        }
    },

    async getStreams(type, id, configBase64) {
        const parts = id.split(":");
        const listIdx = parseInt(parts[1]);
        const channelId = parts[2];
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
                        name: "XuloV Stalker",
                        title: channelName,
                        behaviorHints: { notWeb: true, isLive: true }
                    }]
                };
            }
        } catch (e) {}
        return { streams: [] };
    }
};

module.exports = addon;

