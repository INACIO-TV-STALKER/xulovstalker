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
        if (config.type === 'xtream') return true; 

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
            let tvGenres = ["Predefinido"];
            let movGenres = ["Predefinido"];
            let serGenres = ["Predefinido"];

            if (l.type === 'xtream') {
                try {
                    const baseUrl = l.url.trim().replace(/\/$/, "");
                    const apiBase = `${baseUrl}/player_api.php?username=${encodeURIComponent(l.user)}&password=${encodeURIComponent(l.pass)}`;

                    const fetchXtreamCats = async (action) => {
                        try {
                            const res = await axios.get(`${apiBase}&action=${action}`, { timeout: 5000 });
                            if (Array.isArray(res.data)) return res.data.map(g => g.category_name).filter(Boolean);
                        } catch(e) {}
                        return [];
                    };

                    tvGenres = tvGenres.concat(await fetchXtreamCats('get_live_categories'));
                    movGenres = movGenres.concat(await fetchXtreamCats('get_vod_categories'));
                    serGenres = serGenres.concat(await fetchXtreamCats('get_series_categories'));
                } catch(e) {}
            } 
            else {
                const auth = await this.authenticate(l);
                if (auth) {
                    const fetchStalkerCats = async (sType, sAction) => {
                        try {
                            const gUrl = auth.api + `type=${sType}&action=${sAction}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                            const gRes = await axios.get(gUrl, { headers: auth.authData.headers, timeout: 5000 });
                            const items = Array.isArray(gRes.data?.js) ? gRes.data.js : (Array.isArray(gRes.data?.js?.data) ? gRes.data.js.data : []);
                            return items.map(g => g.title).filter(Boolean);
                        } catch(e) {}
                        return [];
                    };

                    tvGenres = tvGenres.concat(await fetchStalkerCats('itv', 'get_genres'));
                    movGenres = movGenres.concat(await fetchStalkerCats('vod', 'get_categories'));
                    serGenres = serGenres.concat(await fetchStalkerCats('series', 'get_categories'));
                }
            }

            catalogs.push({ type: "tv", id: "stalker_cat_" + i, name: l.name || ("Lista " + (i + 1)), extra: [{ name: "genre", isRequired: false, options: tvGenres }] });
            catalogs.push({ type: "movie", id: "stalker_mov_" + i, name: (l.name || ("Lista " + (i + 1))) + " 🎬", extra: [{ name: "genre", isRequired: false, options: movGenres }, { name: "skip", isRequired: false }] });
            catalogs.push({ type: "series", id: "stalker_ser_" + i, name: (l.name || ("Lista " + (i + 1))) + " 🍿", extra: [{ name: "genre", isRequired: false, options: serGenres }, { name: "skip", isRequired: false }] });
        }));

        return {
            id: "org.xulov.stalker.multi", version: "4.0.0", name: "XuloV Multi-Hub",
            description: "Suporte para Stalker e Xtream Codes (Até 5 Listas)", resources: ["catalog", "stream", "meta"],
            types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const listIdx = parseInt(id.replace("stalker_cat_", "").replace("stalker_mov_", "").replace("stalker_ser_", ""));
        const config = lists[listIdx];
        if (!config) return { metas: [] };

        if (config.type === 'xtream') {
            try {
                const baseUrl = config.url.trim().replace(/\/$/, "");
                const apiBase = `${baseUrl}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;

                if (type === "tv") {
                    let action = "get_live_streams";
                    if (extra && extra.genre && extra.genre !== "Predefinido") {
                        const catRes = await axios.get(`${apiBase}&action=get_live_categories`, {timeout: 5000});
                        const cat = catRes.data.find(c => c.category_name === extra.genre);
                        if (cat) action += `&category_id=${cat.category_id}`;
                    }
                    const res = await axios.get(`${apiBase}&action=${action}`, {timeout: 10000});
                    const channels = Array.isArray(res.data) ? res.data : [];
                    return { metas: channels.map(ch => ({ id: `xlv:${listIdx}:${ch.stream_id}:${encodeURIComponent(ch.name || 'Canal')}`, name: ch.name, type: "tv", poster: ch.stream_icon, posterShape: "landscape" })) };
                } else if (type === "movie") {
                    let action = "get_vod_streams";
                    if (extra && extra.genre && extra.genre !== "Predefinido") {
                        const catRes = await axios.get(`${apiBase}&action=get_vod_categories`, {timeout: 5000});
                        const cat = catRes.data.find(c => c.category_name === extra.genre);
                        if (cat) action += `&category_id=${cat.category_id}`;
                    }
                    const res = await axios.get(`${apiBase}&action=${action}`, {timeout: 15000});
                    let items = Array.isArray(res.data) ? res.data : [];
                    return { metas: items.map(m => ({ id: `xlv:${listIdx}:${m.stream_id}.${m.container_extension || 'mp4'}:${encodeURIComponent(m.name || 'Filme')}`, name: m.name, type: "movie", poster: m.stream_icon, posterShape: "poster" })) };
                } else if (type === "series") {
                    let action = "get_series";
                    if (extra && extra.genre && extra.genre !== "Predefinido") {
                        const catRes = await axios.get(`${apiBase}&action=get_series_categories`, {timeout: 5000});
                        const cat = catRes.data.find(c => c.category_name === extra.genre);
                        if (cat) action += `&category_id=${cat.category_id}`;
                    }
                    const res = await axios.get(`${apiBase}&action=${action}`, {timeout: 15000});
                    let items = Array.isArray(res.data) ? res.data : [];
                    return { metas: items.map(m => ({ id: `xlv:${listIdx}:${m.series_id}:${encodeURIComponent(m.name || 'Série')}`, name: m.name, type: "series", poster: m.cover, posterShape: "poster" })) };
                }
            } catch (e) { return { metas: [] }; }
        }

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
                return { metas: filteredChannels.map(ch => ({ id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name || 'Canal')}`, name: ch.name, type: "tv", poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "", posterShape: "landscape" })) };
            } else {
                const stalkerType = type === "movie" ? "vod" : "series";
                let categoryParam = "";

                if (extra && extra.genre && extra.genre !== "Predefinido") {
                    try {
                        const cUrl = auth.api + `type=${stalkerType}&action=get_categories&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        const cRes = await axios.get(cUrl, { headers: auth.authData.headers, timeout: 5000 });
                        const cats = Array.isArray(cRes.data?.js) ? cRes.data.js : (Array.isArray(cRes.data?.js?.data) ? cRes.data.js.data : []);
                        const cat = cats.find(c => c.title === extra.genre);
                        if (cat && cat.id !== undefined) categoryParam = `&category=${cat.id}`;
                    } catch (e) {}
                }

                const page = extra.skip ? Math.floor(extra.skip / 14) + 1 : 1;
                const url = auth.api + `type=${stalkerType}&action=get_ordered_list${categoryParam}&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
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
            const config = lists[listIdx];

            if (config.type === 'xtream') {
                try {
                    const baseUrl = config.url.trim().replace(/\/$/, "");
                    const url = `${baseUrl}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}&action=get_series_info&series_id=${contentId}`;
                    const res = await axios.get(url, { timeout: 15000 });
                    const epsInfo = res.data?.episodes;
                    let videos = [];
                    if (epsInfo) {
                        for (const season in epsInfo) {
                            epsInfo[season].forEach(ep => {
                                videos.push({
                                    id: `xlv:${listIdx}:${ep.id}.${ep.container_extension || 'mp4'}:ep_${season}_${ep.episode_num}`,
                                    title: ep.title || `Episódio ${ep.episode_num}`,
                                    season: parseInt(season),
                                    episode: parseInt(ep.episode_num)
                                });
                            });
                        }
                    }
                    return { meta: { id: id, type: "series", name: contentName, posterShape: "poster", videos: videos } };
                } catch (e) { return { meta: { id, type, name: contentName } }; }
            }

            const auth = await this.authenticate(config);
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
        return { streams: [{ name: lists[listIdx]?.name || "XuloV Hub", url: proxyUrl, title: "▶️ " + (type === "tv" ? channelName : "Reproduzir Video"), behaviorHints: { notWebReady: true } }] };
    }
};

module.exports = addon;
