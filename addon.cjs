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
            catalogs.push({ type: "tv", id: `stalker_tv_${i}`, name: `${l.name || 'Lista '+(i+1)} 📺` });
            catalogs.push({ type: "movie", id: `stalker_mov_${i}`, name: `${l.name || 'Lista '+(i+1)} 🎬`, extra: [{ name: "skip", isRequired: false }] });
            catalogs.push({ type: "series", id: `stalker_ser_${i}`, name: `${l.name || 'Lista '+(i+1)} 🍿`, extra: [{ name: "skip", isRequired: false }] });
        });

        return {
            id: "org.xulov.stalker.multi",
            version: "3.9.0",
            name: "XuloV Stalker Hub",
            description: "TV, Filmes e Séries",
            resources: ["catalog", "stream", "meta"],
            types: ["tv", "movie", "series"],
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
            const stalkerType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
            const action = type === "tv" ? "get_all_channels" : "get_ordered_list";
            const pageSize = 60;
            const page = extra?.skip ? Math.floor(extra.skip / pageSize) + 1 : 1;
            
            let url = `${auth.api}type=${stalkerType}&action=${action}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            if (type !== "tv") url += `&p=${page}`;

            const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
            const rawData = res.data?.js?.data || res.data?.js || [];
            const items = Array.isArray(rawData) ? rawData : Object.values(rawData);

            return {
                metas: items.map(m => ({
                    id: `xlv:${listIdx}:${m.id}:${encodeURIComponent(m.name || m.title)}`,
                    name: m.name || m.title,
                    type: type,
                    poster: m.screenshot_uri || m.logo || "",
                    posterShape: type === "tv" ? "square" : "poster"
                }))
            };
        } catch (e) { return { metas: [] }; }
    }

    async getMeta(type, id, configBase64) {
        if (type !== "series") return { meta: { id, type } };
        const parts = id.split(":");
        const listIdx = parseInt(parts[1]);
        const seriesId = parts[2];
        const seriesName = decodeURIComponent(parts[3]);
        const lists = this.parseConfig(configBase64);
        const auth = await this.authenticate(lists[listIdx]);
        if (!auth) return { meta: { id, type, name: seriesName } };

        try {
            const url = `${auth.api}type=series&action=get_ordered_list&movie_id=${seriesId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
            const episodesData = res.data?.js?.data || res.data?.js || [];
            const videos = (Array.isArray(episodesData) ? episodesData : Object.values(episodesData)).map((ep, index) => ({
                id: `xlv:${listIdx}:${encodeURIComponent(ep.cmd || ep.id)}:ep_${ep.season || 1}_${ep.series || index + 1}`,
                title: ep.name || `Episódio ${index + 1}`,
                season: parseInt(ep.season) || 1,
                episode: parseInt(ep.series || index + 1)
            }));
            return { meta: { id, type: "series", name: seriesName, posterShape: "poster", videos } };
        } catch (e) { return { meta: { id, type, name: seriesName } }; }
    }

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":");
        const protocol = host.includes("localhost") ? "http" : "https";
        return {
            streams: [{
                name: "XuloV Stream",
                url: `${protocol}://${host}/proxy/${encodeURIComponent(configBase64)}/${parts[1]}/${parts[2]}?type=${type}`,
                title: "▶️ Reproduzir",
                behaviorHints: { notWebReady: true }
            }]
        };
    }
}

module.exports = new StalkerAddon();

