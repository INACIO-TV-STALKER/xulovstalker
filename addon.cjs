const axios = require('axios');

class StalkerAddon {
    parseConfig(configBase64) {
        try {
            return JSON.parse(Buffer.from(configBase64, 'base64').toString());
        } catch (e) { return []; }
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
            return { api, token, authData };
        } catch (e) { return null; }
    }

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        const catalogs = [];

        lists.forEach((l, i) => {
            catalogs.push({
                type: "tv",
                id: `stalker_tv_${i}`,
                name: `${l.name || 'Lista '+(i+1)} 📺`,
                extra: [{ name: "genre", isRequired: false }] // Removido o carregamento prévio de géneros
            });
            catalogs.push({
                type: "movie",
                id: `stalker_mov_${i}`,
                name: `${l.name || 'Lista '+(i+1)} 🎬`,
                extra: [{ name: "skip", isRequired: false }]
            });
        });

        return {
            id: "org.xulov.stalker.multi",
            version: "3.6.0",
            name: "XuloV Stalker Hub",
            description: "Canais e Filmes - Otimizado",
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
        } catch (e) { console.error("Erro catálogo:", e.message); }
        return { metas: [] };
    }

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":");
        const listIdx = parts[1];
        const contentId = parts[2];
        const contentName = decodeURIComponent(parts[3]);
        const protocol = host.includes("localhost") ? "http" : "https";
        const lists = this.parseConfig(configBase64);
        const listName = lists[listIdx]?.name || "XuloV Stalker Hub";

        return {
            streams: [{
                name: listName,
                url: `${protocol}://${host}/proxy/${encodeURIComponent(configBase64)}/${listIdx}/${contentId}?type=${type}`,
                title: "▶️ " + contentName,
                behaviorHints: { notWebReady: true }
            }]
        };
    }
}

module.exports = StalkerAddon;

