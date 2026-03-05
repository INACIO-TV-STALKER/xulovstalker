const axios = require('axios');

class StalkerAddon {
    parseConfig(configBase64) {
        try {
            return JSON.parse(Buffer.from(configBase64, 'base64').toString());
        } catch (e) {
            return [];
        }
    }

    async authenticate(config) {
        const { url, mac } = config;
        const api = url.endsWith('/') ? url + 'portal.php?' : url + '/portal.php?';
        const authData = {
            sn: "00:1A:79:" + Math.random().toString(16).slice(2, 8).toUpperCase(),
            headers: {
                "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) Mag200/2.0.1 Safari/533.3",
                "Cookie": `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`
            }
        };

        try {
            const res = await axios.get(`${api}type=stb&action=handshake&JsHttpRequest=1-0`, { headers: authData.headers, timeout: 5000 });
            const token = res.data?.js?.token;
            if (!token) return null;

            const profileRes = await axios.get(`${api}type=stb&action=get_profile&token=${token}&JsHttpRequest=1-0`, { headers: authData.headers, timeout: 5000 });
            return { api, token, authData, profile: profileRes.data?.js };
        } catch (e) {
            return null;
        }
    }

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        const catalogs = [];

        for (let i = 0; i < lists.length; i++) {
            const l = lists[i];
            let genreOptions = ["Predefinido"];
            
            // Tenta buscar os géneros reais para o menu aparecer
            const auth = await this.authenticate(l);
            if (auth) {
                try {
                    const gUrl = `${auth.api}type=itv&action=get_genres&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const gRes = await axios.get(gUrl, { headers: auth.authData.headers, timeout: 5000 });
                    const genres = Array.isArray(gRes.data?.js) ? gRes.data.js : [];
                    genres.forEach(g => { if (g.title) genreOptions.push(g.title); });
                } catch (e) {}
            }

            catalogs.push({
                type: "tv",
                id: `stalker_tv_${i}`,
                name: `${l.name || 'Lista '+(i+1)} 📺`,
                extra: [{ name: "genre", options: genreOptions, isRequired: false }]
            });

            catalogs.push({
                type: "movie",
                id: `stalker_mov_${i}`,
                name: `${l.name || 'Lista '+(i+1)} 🎬`,
                extra: [{ name: "skip", isRequired: false }]
            });
        }

        return {
            id: "org.xulov.stalker.multi",
            version: "3.5.0",
            name: "XuloV Stalker Hub",
            description: "Canais e Filmes - Full Support",
            resources: ["catalog", "stream", "meta"],
            types: ["tv", "movie"],
            idPrefixes: ["xlv:"],
            catalogs: catalogs
        };
    }

    async getCatalog(type, id, extra, configBase64) {
        const listIdx = parseInt(id.split("_").pop());
        const lists = this.parseConfig(configBase64);
        const config = lists[listIdx];
        if (!config) return { metas: [] };

        const auth = await this.authenticate(config);
        if (!auth) return { metas: [] };

        try {
            if (type === "tv") {
                const url = `${auth.api}type=itv&action=get_all_channels&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                const rawData = res.data?.js?.data || res.data?.js || [];
                let channels = Array.isArray(rawData) ? rawData : Object.values(rawData);

                const selectedGenre = extra?.genre;
                if (selectedGenre && selectedGenre !== "Predefinido") {
                    const gUrl = `${auth.api}type=itv&action=get_genres&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const gRes = await axios.get(gUrl, { headers: auth.authData.headers });
                    const genres = Array.isArray(gRes.data?.js) ? gRes.data.js : [];
                    const genreObj = genres.find(g => g.title === selectedGenre);
                    if (genreObj) {
                        channels = channels.filter(ch => String(ch.tv_genre_id) === String(genreObj.id));
                    }
                }

                return {
                    metas: channels.map(ch => ({
                        id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name)}`,
                        name: ch.name,
                        type: "tv",
                        poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "",
                        posterShape: "square"
                    }))
                };
            }

            if (type === "movie") {
                const pageSize = 60;
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
                        posterShape: "poster"
                    }))
                };
            }
        } catch (e) {
            console.error("Erro no catálogo:", e.message);
        }
        return { metas: [] };
    }

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":");
        const listIdx = parseInt(parts[1]);
        const contentId = parts[2];
        const contentName = decodeURIComponent(parts[3] || "Conteúdo");

        const lists = this.parseConfig(configBase64);
        const listName = lists[listIdx]?.name || "XuloV Stalker Hub";
        
        const protocol = host.includes("localhost") ? "http" : "https";
        // Adicionamos o tipo no final para o proxy saber o que fazer
        const proxyUrl = `${protocol}://${host}/proxy/${encodeURIComponent(configBase64)}/${listIdx}/${contentId}?type=${type}`;

        return {
            streams: [{
                name: listName,
                url: proxyUrl,
                title: "▶️ " + contentName,
                behaviorHints: { notWebReady: true }
            }]
        };
    }
}

module.exports = StalkerAddon;

