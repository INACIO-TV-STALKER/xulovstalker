const axios = require("axios");
const crypto = require("crypto");

const cache = { auth: {}, channels: {}, categories: {}, lastFetch: {} };

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
            "X-User-Agent": `Model: MAG254; SW: 2.18-r14-254; Device ID: ${id1}; Device ID2: ${id1}; Signature: ;`,
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
        } catch (e) { return []; }
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
            const hUrl = `${url}?type=stb&action=handshake&sn=${authData.sn}&JsHttpRequest=1-0`;
            const res = await axios.get(hUrl, { headers: authData.headers, timeout: 8000 });
            const token = res.data?.js?.token || res.data?.token;
            if (token) {
                const result = { token, api: url + "?", authData: getStalkerAuth(config, token) };
                cache.auth[cacheKey] = result;
                cache.lastFetch[cacheKey] = Date.now();
                return result;
            }
        } catch (e) { return null; }
    },

    // 1. O MANIFESTO AGORA TENTA BUSCAR CATEGORIAS REAIS
    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        const catalogs = [];

        for (let i = 0; i < lists.length; i++) {
            const config = lists[i];
            const cacheKey = "cats_" + config.url + config.mac;
            let genres = ["Todos"];

            // Tenta buscar categorias reais se estiverem em cache (ou usa genéricas na primeira vez)
            if (cache.categories[cacheKey]) {
                genres = cache.categories[cacheKey].map(c => c.name);
            } else {
                // Categorias temporárias para o Stremio não ficar vazio no primeiro load
                genres = ["Carregando...", "Portugal", "Sports", "Movies", "Kids"];
            }

            catalogs.push({
                type: "tv",
                id: `stalker_cat_${i}`,
                name: config.name || `Lista ${i + 1}`,
                extra: [{ name: "genre", isRequired: false, options: genres }]
            });
        }

        return {
            id: "org.xulov.stalker.v3",
            version: "3.5.0",
            name: "XuloV Stalker Hub",
            description: "Categorias Reais do Servidor",
            resources: ["catalog", "stream"],
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
            const cacheKeyCats = "cats_" + config.url + config.mac;
            const cacheKeyChans = "ch_" + config.url + config.mac;

            // 1. BUSCAR AS CATEGORIAS REAIS DO PORTAL
            if (!cache.categories[cacheKeyCats]) {
                const catUrl = `${auth.api}type=itv&action=get_categories&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const catRes = await axios.get(catUrl, { headers: auth.authData.headers });
                const rawCats = catRes.data?.js || [];
                cache.categories[cacheKeyCats] = Array.isArray(rawCats) ? rawCats : Object.values(rawCats);
                console.log(`✅ Categorias reais carregadas para lista ${listIdx}`);
            }

            // 2. BUSCAR OS CANAIS
            if (!cache.channels[cacheKeyChans]) {
                const url = `${auth.api}type=itv&action=get_all_channels&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
                const rawData = res.data?.js?.data || res.data?.js || [];
                cache.channels[cacheKeyChans] = Array.isArray(rawData) ? rawData : Object.values(rawData);
            }

            let filteredChannels = cache.channels[cacheKeyChans];

            // 3. FILTRAR PELA CATEGORIA REAL SELECIONADA
            if (extra && extra.genre && extra.genre !== "Todos" && extra.genre !== "Carregando...") {
                const selectedGenre = extra.genre.toLowerCase();
                const category = cache.categories[cacheKeyCats].find(c => 
                    c.name.toLowerCase().trim() === selectedGenre.trim()
                );
                
                if (category) {
                    filteredChannels = filteredChannels.filter(ch => ch.category_id === category.id || ch.tv_genre_id === category.id);
                }
            } else {
                // Se não houver filtro, mostra os primeiros 300
                filteredChannels = filteredChannels.slice(0, 300);
            }

            const metas = filteredChannels.map(ch => ({
                id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name || "Canal")}`,
                name: ch.name || "Canal",
                type: "tv",
                poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "https://telegra.ph/file/a85d95e09f6e3c0919313.png",
                posterShape: "square"
            }));

            return { metas };
        } catch (e) {
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

