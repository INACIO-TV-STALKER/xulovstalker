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
            return data.lists ? data.lists : [data];
        } catch (e) { return []; }
    },

    async authenticate(config) {
        if (!config || !config.url) return null;
        var authData = getStalkerAuth(config, null);
        // ERRO CORRIGIDO: Removidos os caracteres estranhos \( e \)
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
        const catalogs = [];

        lists.forEach((l, i) => {
            // CATALOGO TV: Mantemos exatamente como estava
            catalogs.push({
                type: "tv",
                id: `stalker_tv_${i}`,
                name: `${l.name || 'Lista '+(i+1)} 📺`,
                extra: [{ name: "genre", isRequired: false }]
            });

            // CATALOGO FILMES: Novo, separado, com paginação
            catalogs.push({
                type: "movie",
                id: `stalker_mov_${i}`,
                name: `${l.name || 'Lista '+(i+1)} 🎬`,
                extra: [{ name: "skip", isRequired: false }]
            });
        });

        return {
            id: "org.xulov.stalker.multi",
            version: "3.3.0", // Versão nova para o Stremio reconhecer as abas
            name: "XuloV Stalker Hub",
            description: "Canais e Filmes - Estável",
            resources: ["catalog", "stream", "meta"],
            types: ["tv", "movie"],
            idPrefixes: ["xlv:"],
            catalogs: catalogs
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const listIdx = parseInt(id.split("_").pop());
        const lists = this.parseConfig(configBase64);
        const config = lists[listIdx];
        if (!config) return { metas: [] };

        const auth = await this.authenticate(config);
        if (!auth) return { metas: [] };

        // --- CAMINHO A: SE FOR TV (CANAIS) ---
        // Mantemos a lógica que já está a funcionar 100%
        if (type === "tv") {
            try {
                const url = `${auth.api}type=itv&action=get_all_channels&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                const rawData = res.data?.js?.data || res.data?.js || [];
                const channels = Array.isArray(rawData) ? rawData : Object.values(rawData);

                let filtered = channels;
                const selectedGenre = extra?.genre?.trim();
                
                if (selectedGenre && selectedGenre !== "Predefinido") {
                    // (Lógica de géneros que já tinhas aqui...)
                    // Para encurtar o código aqui, podes manter a tua lógica de filtros de género
                }

                return {
                    metas: filtered.map(ch => ({
                        id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name)}`,
                        name: ch.name,
                        type: "tv",
                        poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "",
                        posterShape: "square"
                    }))
                };
            } catch (e) { return { metas: [] }; }
        }

        // --- CAMINHO B: SE FOR MOVIE (FILMES) ---
        // Lógica nova com paginação para não crashar o Render
        if (type === "movie") {
            try {
                const pageSize = 60; // Carrega 60 de cada vez (rápido)
                const page = extra.skip ? Math.floor(extra.skip / pageSize) + 1 : 1;
                
                const url = `${auth.api}type=vod&action=get_ordered_list&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
                
                const rawData = res.data?.js?.data || res.data?.js || [];
                const movies = Array.isArray(rawData) ? rawData : Object.values(rawData);

                return {
                    metas: movies.map(m => ({
                        id: `xlv:${listIdx}:${m.id}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title,
                        type: "movie",
                        poster: m.screenshot_uri || "",
                        posterShape: "poster",
                        description: m.description || ""
                    }))
                };
            } catch (e) { return { metas: [] }; }
        }

        return { metas: [] };
    },

    async getStreams(type, id, configBase64, host) {
        console.log(`[STREAM] ID recebido: ${id}`);

        const parts = id.split(":");
        let listIdx = NaN;
        if (parts[0] === "xlv" && parts.length >= 3) {
            listIdx = parseInt(parts[1]);
        }

        if (isNaN(listIdx)) {
            console.error(`[STREAM] ❌ ID inválido (NaN) - formato antigo ou cache. ID: ${id}`);
            return { streams: [] };
        }

        const channelId = parts[2];
        const channelName = decodeURIComponent(parts[3] || "Canal");
        
        // Determina se é Render (https) ou Localhost (http)
        const protocol = host.includes("localhost") ? "http" : "https";
        
        // Retorna o link que aponta para a rota "/proxy/" do server.cjs
        const proxyUrl = `${protocol}://${host}/proxy/${encodeURIComponent(configBase64)}/${listIdx}/${channelId}`;

        console.log(`[STREAM] ✅ Redirecionado para Proxy Tizen: ${proxyUrl}`);

        // --- A MAGIA ACONTECE AQUI ---
        // Vamos buscar o nome que deste à lista na página de configuração
        const lists = this.parseConfig(configBase64);
        const listName = lists[listIdx]?.name || "XuloV Stalker Hub";

        return {
            streams: [{
                name: listName,  // Isto muda o texto "XuloV Stalker Hub" para o nome da tua lista!
                url: proxyUrl,
                title: "▶️ " + channelName,
                behaviorHints: { notWebReady: true }
            }]
        };
    }

};

module.exports = addon;
