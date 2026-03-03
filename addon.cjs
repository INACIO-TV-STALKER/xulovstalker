const axios = require("axios");
const crypto = require("crypto");

const getStalkerAuth = function(config, token) {
    var mac = (config.mac || "").toUpperCase();
    var seed = mac.replace(/:/g, "");
    var id1 = config.id1 || crypto.createHash('md5').update(seed + "id1").digest('hex').toUpperCase();
    var id2 = config.id2 || crypto.createHash('md5').update(seed + "id2").digest('hex').toUpperCase();
    var sig = config.sig || crypto.createHash('md5').update(seed + "sig").digest('hex').toUpperCase();
    var sn = config.sn || seed.substring(0, 13).toUpperCase();
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
            var hUrl = url + "?type=stb&action=handshake&sn=" + authData.sn + "&JsHttpRequest=1-0";
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
        
        // Categorias padrão que forçam o Stremio a mostrar o menu de Géneros
        const defaultGenres = ["Todas", "Portugal", "Desporto", "Cinema", "Infantil", "Documentários", "Música"];

        const catalogs = lists.map((l, i) => ({
            type: "tv",
            id: "stalker_cat_" + i,
            name: l.name || ("Lista " + (i + 1)),
            extra: [
                { name: "genre", options: defaultGenres, isRequired: false },
                { name: "search", isRequired: false }
            ]
        }));

        return {
            id: "org.xulov.stalker.multi.v5",
            version: "5.0.0",
            name: "XuloV Stalker Hub",
            description: "Categorias e Multi-Portal",
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
            const genreSelected = extra.genre || "Todas";
            let categoryId = null;

            // 1. Tentar obter as categorias REAIS do portal para mapear o nome
            if (genreSelected !== "Todas") {
                const catUrl = `${auth.api}type=itv&action=get_genres&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const catRes = await axios.get(catUrl, { headers: auth.authData.headers });
                const categories = catRes.data?.js?.data || catRes.data?.js || [];
                
                const found = categories.find(c => 
                    (c.title || c.name || "").toLowerCase().includes(genreSelected.toLowerCase())
                );
                if (found) categoryId = found.id;
            }

            // 2. Buscar Canais
            var url = auth.api + "type=itv&action=get_all_channels&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
            var res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
            var rawData = res.data?.js?.data || res.data?.js || [];
            var channels = Array.isArray(rawData) ? rawData : Object.values(rawData);

            // 3. Filtrar
            if (categoryId) {
                channels = channels.filter(ch => (ch.category_id || ch.tv_genre_id || "").toString() === categoryId.toString());
            } else if (genreSelected !== "Todas") {
                // Fallback: se não achou ID, filtra por nome do canal
                channels = channels.filter(ch => ch.name.toLowerCase().includes(genreSelected.toLowerCase()));
            }

            return {
                metas: channels.slice(0, 400).map(ch => ({
                    id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name)}`,
                    name: ch.name,
                    type: "tv",
                    poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "",
                    posterShape: "square"
                }))
            };
        } catch (e) { return { metas: [] }; }
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":");
        const listIdx = parts[1];
        const channelId = parts[2];
        const channelName = decodeURIComponent(parts[3] || "Canal");

        // O link de stream agora aponta para o nosso PROXY no server.cjs
        const proxyUrl = `https://${host}/proxy/${configBase64}/${channelId}`;

        return {
            streams: [{
                url: proxyUrl,
                title: "▶️ Reproduzir: " + channelName,
                behaviorHints: { notWeb: true, isLive: true }
            }]
        };
    }
};

module.exports = addon;

