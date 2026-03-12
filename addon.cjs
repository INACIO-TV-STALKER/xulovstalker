const axios = require("axios");
const crypto = require("crypto");

const getStalkerAuth = function(config, token) {
    var mac = (config.mac || "").toUpperCase();
    var seed = mac.replace(/:/g, "");

    var id1 = config.id1 || crypto.createHash('md5').update(seed + "id1").digest('hex').toUpperCase();
    var id2 = config.id2 || crypto.createHash('md5').update(seed + "id2").digest('hex').toUpperCase();
    var sig = config.sig || crypto.createHash('md5').update(seed + "sig").digest('hex').toUpperCase();
    var sn  = config.sn  || crypto.createHash('md5').update(seed + "sn").digest('hex').substring(0, 13).toUpperCase();

    var cookie = "mac=" + encodeURIComponent(mac) + "; stb_lang=en; timezone=Europe/Lisbon;";
    if (token) cookie += " access_token=" + token + ";";

    return {
        sn: sn, id1: id1, id2: id2, sig: sig,
        headers: {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 27211 Safari/533.3",
            "X-User-Agent": "Model: MAG322; SW: 2.20.0-r19-322; Device ID: " + id1 + "; Device ID2: " + id2 + "; Signature: " + sig + ";",
            "X-Stb-Source": "stb-emu",
            "Cookie": cookie,
            "Accept": "*/*",
            "Referer": config.url.replace(/\/$/, "") + "/c/",
            "Connection": "keep-alive"
        }
    };
};

const addon = {
    parseConfig(configBase64) {
        try { return JSON.parse(Buffer.from(configBase64, 'base64').toString()).lists || [JSON.parse(Buffer.from(configBase64, 'base64').toString())]; } 
        catch (e) { return []; }
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
            return null;
        } catch (e) {
            console.error("[AUTH ERRO] Falha no handshake:", e.message);
            return null;
        }
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        let catalogs = [];

        await Promise.all(lists.map(async (l, i) => {
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
            catalogs.push({ type: "tv", id: "stalker_cat_" + i, name: l.name || ("Lista " + (i + 1)), extra: [{ name: "genre", isRequired: false, options: genreOptions }] });
            catalogs.push({ type: "movie", id: "stalker_mov_" + i, name: (l.name || ("Lista " + (i + 1))) + " 🎬", extra: [{ name: "skip", isRequired: false }] });
            catalogs.push({ type: "series", id: "stalker_ser_" + i, name: (l.name || ("Lista " + (i + 1))) + " 🍿", extra: [{ name: "skip", isRequired: false }] });
        }));

        return {
            id: "org.xulov.stalker.multi", version: "3.2.1", name: "XuloV Stalker Hub",
            description: "Suporte para até 5 Portais Stalker", resources: ["catalog", "stream", "meta"],
            types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs
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
            if (type === "tv") {
                var url = auth.api + "type=itv&action=get_all_channels&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
                var res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                var channels = Array.isArray(res.data?.js?.data || res.data?.js) ? (res.data?.js?.data || res.data?.js) : Object.values(res.data?.js?.data || res.data?.js || {});

                let filteredChannels = channels;
                if (extra && extra.genre && extra.genre !== "Predefinido") {
                    try {
                        const gUrl = auth.api + "type=itv&action=get_genres&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
                        const gRes = await axios.get(gUrl, { headers: auth.authData.headers, timeout: 5000 });
                        const genres = Array.isArray(gRes.data?.js) ? gRes.data.js : [];
                        const genreMap = {};
                        genres.forEach(g => { if (g.title && g.id !== undefined) genreMap[g.title.trim()] = g.id; });
                        const genreId = genreMap[extra.genre.trim()];
                        if (genreId !== undefined) filteredChannels = channels.filter(ch => String(ch.tv_genre_id || "") === String(genreId));
                    } catch (e) {}
                }
                return { metas: filteredChannels.map(ch => ({ id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name || 'Canal')}`, name: ch.name, type: "tv", poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "", posterShape: "square" })) };
            } else {
                const stalkerType = type === "movie" ? "vod" : "series";
                const page = extra.skip ? Math.floor(extra.skip / 14) + 1 : 1;
                const url = auth.api + `type=${stalkerType}&action=get_ordered_list&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
                const items = Array.isArray(res.data?.js?.data || res.data?.js) ? (res.data?.js?.data || res.data?.js) : Object.values(res.data?.js?.data || res.data?.js || {});
                return { metas: items.map(m => ({ id: `xlv:${listIdx}:${m.id}:${encodeURIComponent(m.name || m.title || 'Conteúdo')}`, name: m.name || m.title, type: type, poster: m.screenshot_uri || m.logo || "", posterShape: "poster" })) };
            }
        } catch (e) { return { metas: [] }; }
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":");
        if (parts.length < 4) return { meta: { id, type } };
        const listIdx = parseInt(parts[1]); const contentId = parts[2]; const contentName = decodeURIComponent(parts[3] || "Conteúdo");

        if (type === "tv" || type === "movie") return { meta: { id: id, type: type, name: contentName, posterShape: type === "tv" ? "square" : "poster" } };

        if (type === "series") {
            const lists = this.parseConfig(configBase64);
            const auth = await this.authenticate(lists[listIdx]);
            if (!auth) return { meta: { id, type, name: contentName } };
            try {
                const url = auth.api + `type=series&action=get_ordered_list&movie_id=${contentId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
                const eps = Array.isArray(res.data?.js?.data || res.data?.js) ? (res.data?.js?.data || res.data?.js) : Object.values(res.data?.js?.data || res.data?.js || {});
                const videos = eps.map((ep, idx) => ({ id: `xlv:${listIdx}:${encodeURIComponent(ep.cmd || ep.id)}:ep_${parseInt(ep.season) || 1}_${parseInt(ep.episode || ep.series) || (idx + 1)}`, title: ep.name || `Episódio ${parseInt(ep.episode || ep.series) || (idx + 1)}`, season: parseInt(ep.season) || 1, episode: parseInt(ep.episode || ep.series) || (idx + 1) }));
                return { meta: { id: id, type: "series", name: contentName, posterShape: "poster", videos: videos } };
            } catch (e) { return { meta: { id, type, name: contentName } }; }
        }
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":"); let listIdx = NaN;
        if (parts[0] === "xlv" && parts.length >= 3) { listIdx = parseInt(parts[1]); }
        if (isNaN(listIdx)) return { streams: [] };
        const channelId = parts[2]; const channelName = decodeURIComponent(parts[3] || (type === "tv" ? "Canal" : "Reproduzir"));
        const proxyUrl = `http://${host}/proxy/${encodeURIComponent(configBase64)}/${listIdx}/${encodeURIComponent(channelId)}?type=${type}`;
        
        const lists = this.parseConfig(configBase64);
        return { streams: [{ name: lists[listIdx]?.name || "XuloV Stalker Hub", url: proxyUrl, title: "▶️ " + (type === "tv" ? channelName : "Reproduzir Video"), behaviorHints: { notWebReady: true } }] };
    }
};

module.exports = addon;

