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
                    genreOptions = genreOptions.concat(genres.map(g => g.title).filter(Boolean));
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

        // ADICIONADO: Aba de Filmes e Séries sem tocar na TV
        lists.forEach((l, i) => {
            catalogs.push({
                type: "movie",
                id: "stalker_mov_" + i,
                name: (l.name || ("Lista " + (i + 1))) + " 🎬",
                extra: [{ name: "skip", isRequired: false }]
            });
            catalogs.push({
                type: "series",
                id: "stalker_ser_" + i,
                name: (l.name || ("Lista " + (i + 1))) + " 🍿",
                extra: [{ name: "skip", isRequired: false }]
            });
        });

        return {
            id: "org.xulov.stalker.multi",
            version: "3.2.0", // Apenas aumentei a versão para o Stremio atualizar
            name: "XuloV Stalker Hub",
            description: "Suporte para até 5 Portais Stalker - Géneros reais + streams em Render",
            resources: ["catalog", "stream", "meta"],
            types: ["tv", "movie", "series"], // ADICIONADO: movie, series
            idPrefixes: ["xlv:"],
            catalogs: catalogs
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const listIdx = parseInt(id.replace("stalker_cat_", "").replace("stalker_mov_", "").replace("stalker_ser_", ""));
        const config = lists[listIdx];
        if (!config) return { metas: [] };

        const auth = await this.authenticate(config);
        if (!auth) return { metas: [] };

        try {
            // LÓGICA ORIGINAL DA TV INTACTA
            if (type === "tv") {
                var url = auth.api + "type=itv&action=get_all_channels&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
                var res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                var rawData = res.data?.js?.data || res.data?.js || [];
                var channels = Array.isArray(rawData) ? rawData : Object.values(rawData);

                let filteredChannels = channels;
                if (extra && extra.genre && extra.genre !== "Predefinido") {
                    try {
                        const gUrl = auth.api + "type=itv&action=get_genres&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
                        const gRes = await axios.get(gUrl, { headers: auth.authData.headers, timeout: 5000 });
                        const genres = Array.isArray(gRes.data?.js) ? gRes.data.js : [];
                        const genreMap = {};
                        genres.forEach(g => {
                            if (g.title && g.id !== undefined) genreMap[g.title.trim()] = g.id;
                        });
                        const genreId = genreMap[extra.genre.trim()];
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
            } 
            
            // ADICIONADO: LÓGICA DE FILMES E SÉRIES
            else if (type === "movie" || type === "series") {
                const stalkerType = type === "movie" ? "vod" : "series";
                const page = extra.skip ? Math.floor(extra.skip / 14) + 1 : 1; // 14 é o default de algumas boxes
                const url = auth.api + `type=${stalkerType}&action=get_ordered_list&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                
                const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
                const rawData = res.data?.js?.data || res.data?.js || [];
                const items = Array.isArray(rawData) ? rawData : Object.values(rawData);

                return {
                    metas: items.map(m => ({
                        id: `xlv:${listIdx}:${m.id}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title,
                        type: type,
                        poster: m.screenshot_uri || m.logo || "",
                        posterShape: "poster"
                    }))
                };
            }
        } catch (e) { return { metas: [] }; }
    },

    // ADICIONADO: NOVA FUNÇÃO DE META PARA LER OS EPISÓDIOS DAS SÉRIES
    async getMeta(type, id, configBase64) {
        const parts = id.split(":");
        if (parts.length < 4) return { meta: { id, type } };
        
        const listIdx = parseInt(parts[1]);
        const contentId = parts[2];
        const contentName = decodeURIComponent(parts[3] || "Conteúdo");

        // Se for TV ou Filme, devolve o metadado simples
        if (type === "tv" || type === "movie") {
            return { meta: { id: id, type: type, name: contentName, posterShape: type === "tv" ? "square" : "poster" } };
        }

        // Se for série, pede a lista de episódios ao Stalker
        if (type === "series") {
            const lists = this.parseConfig(configBase64);
            const auth = await this.authenticate(lists[listIdx]);
            if (!auth) return { meta: { id, type, name: contentName } };

            try {
                const url = auth.api + `type=series&action=get_ordered_list&movie_id=${contentId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
                const episodesData = res.data?.js?.data || res.data?.js || [];
                const eps = Array.isArray(episodesData) ? episodesData : Object.values(episodesData);

                const videos = eps.map((ep, idx) => {
                    const season = parseInt(ep.season) || 1;
                    const episodeNum = parseInt(ep.episode || ep.series) || (idx + 1);
                    return {
                        id: `xlv:${listIdx}:${encodeURIComponent(ep.cmd || ep.id)}:ep_${season}_${episodeNum}`,
                        title: ep.name || `Episódio ${episodeNum}`,
                        season: season,
                        episode: episodeNum
                    };
                });

                return {
                    meta: { id: id, type: "series", name: contentName, posterShape: "poster", videos: videos }
                };
            } catch (e) {
                return { meta: { id, type, name: contentName } };
            }
        }
    },

    async getStreams(type, id, configBase64, host) {
        console.log(`[STREAM] ID recebido: ${id} | Tipo: ${type}`);

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
        // Para séries/filmes o nome pode estar no índice 3 ou noutro formato, fallback "Conteúdo"
        const channelName = decodeURIComponent(parts[3] || (type === "tv" ? "Canal" : "Reproduzir"));

        const protocol = host.includes("localhost") ? "http" : "https";

        // ADICIONADO: ?type=${type} no proxyUrl para o server.cjs saber o que pedir
        const proxyUrl = `${protocol}://${host}/proxy/${encodeURIComponent(configBase64)}/${listIdx}/${encodeURIComponent(channelId)}?type=${type}`;

        console.log(`[STREAM] ✅ Redirecionado para Proxy Tizen: ${proxyUrl}`);

        const lists = this.parseConfig(configBase64);
        const listName = lists[listIdx]?.name || "XuloV Stalker Hub";

        return {
            streams: [{
                name: listName,  
                url: proxyUrl,
                title: "▶️ " + (type === "tv" ? channelName : "Reproduzir Video"),
                behaviorHints: { notWebReady: true }
            }]
        };
    }
};

module.exports = addon;

