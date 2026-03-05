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
        const catalogs = await Promise.all(lists.map(async (l, i) => {
            let genreOptions = ["Predefinido"]; 
            const auth = await this.authenticate(l);
            if (auth) {
                try {
                    const gUrl = auth.api + "type=itv&action=get_genres&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
                    const gRes = await axios.get(gUrl, { headers: auth.authData.headers, timeout: 5000 });
                    const genres = Array.isArray(gRes.data?.js) ? gRes.data.js : [];
                    
                    // FILTRO MÁGICO: Remove "All" e "Predefinido" vindos do portal para não haver duplicados
                    const portalGenres = genres
                        .map(g => g.title ? g.title.trim() : "")
                        .filter(title => title && title.toLowerCase() !== "all" && title.toLowerCase() !== "predefinido");
                    
                    genreOptions = [...genreOptions, ...portalGenres];
                } catch (e) {}
            }
            return {
                type: "tv",
                id: "stalker_cat_" + i,
                name: l.name || ("Lista " + (i + 1)),
                extra: [{
                    name: "genre",
                    isRequired: false,
                    options: genreOptions
                }]
            };
        }));

        return {
            id: "org.xulov.stalker.multi",
            version:"3.3.0",
            name: "XuloV Stalker Hub",
            description: "Suporte para até 5 Portais Stalker - Géneros reais + streams em Render",
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

            let filteredChannels = channels;
            
            const selectedGenre = extra?.genre ? extra.genre.trim() : "";
            
            // SE O UTILIZADOR ESCOLHER "Predefinido" ou "All", NÃO FILTRA NADA (Mostra tudo!)
            if (selectedGenre && selectedGenre !== "Predefinido" && selectedGenre.toLowerCase() !== "all") {
                try {
                    const gUrl = auth.api + "type=itv&action=get_genres&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
                    const gRes = await axios.get(gUrl, { headers: auth.authData.headers, timeout: 5000 });
                    const genres = Array.isArray(gRes.data?.js) ? gRes.data.js : [];
                    const genreMap = {};
                    genres.forEach(g => {
                        if (g.title && g.id !== undefined) genreMap[g.title.trim()] = g.id;
                    });
                    
                    const genreId = genreMap[selectedGenre];
                    if (genreId !== undefined) {
                        filteredChannels = channels.filter(ch => String(ch.tv_genre_id || "") === String(genreId));
                    }
                } catch (e) {}
            }

            return {
                metas: filteredChannels.map(ch => ({
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
