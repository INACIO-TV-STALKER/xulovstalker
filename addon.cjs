const axios = require("axios");
const crypto = require("crypto");

const memCache = {};
function getCache(key) {
    const cached = memCache[key];
    return (cached && cached.expire > Date.now()) ? cached.data : null;
}
function setCache(key, data, ttlMinutes = 30) {
    memCache[key] = { data, expire: Date.now() + (ttlMinutes * 60 * 1000) };
}

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
            "X-Stb-Source": "stb-emu", "Cookie": cookie, "Accept": "*/*",
            "Referer": config.url.replace(/\/$/, "") + "/c/", "Connection": "keep-alive"
        }
    };
};

const addon = {
    parseConfig(configBase64) {
        try { return JSON.parse(Buffer.from(configBase64, 'base64').toString()).lists || []; } 
        catch (e) { return []; }
    },

    async authenticate(config) {
        if (config.type === 'xtream') return true;
        var authData = getStalkerAuth(config, null);
        var baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        var url = baseUrl + "portal.php";
        try {
            var hUrl = url + "?type=stb&action=handshake&sn=" + authData.sn + "&device_id=" + authData.id1 + "&JsHttpRequest=1-0";
            var res = await axios.get(hUrl, { headers: authData.headers, timeout: 5000 });
            var token = res.data?.js?.token || res.data?.token || null;
            if (token) return { token: token, api: url + "?", authData: getStalkerAuth(config, token) };
            return null;
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const cacheKey = `manifest_${configBase64}`;
        const cached = getCache(cacheKey); if (cached) return cached;
        const lists = this.parseConfig(configBase64);
        let catalogs = [];
        await Promise.all(lists.map(async (l, i) => {
            let tvG = ["Predefinido"]; let movG = ["Predefinido"]; let serG = ["Predefinido"];
            try {
                if (l.type === 'xtream') {
                    const b = l.url.trim().replace(/\/$/, "");
                    const api = `${b}/player_api.php?username=${encodeURIComponent(l.user)}&password=${encodeURIComponent(l.pass)}`;
                    const f = async (a) => { const r = await axios.get(`${api}&action=${a}`, { timeout: 3000 }); return Array.isArray(r.data) ? r.data.map(g => g.category_name) : []; };
                    const [c1, c2, c3] = await Promise.all([f('get_live_categories'), f('get_vod_categories'), f('get_series_categories')]);
                    tvG = tvG.concat(c1); movG = movG.concat(c2); serG = serG.concat(c3);
                } else {
                    const auth = await addon.authenticate(l);
                    if (auth) {
                        const fetchSt = async (t, a) => {
                            const r = await axios.get(`${auth.api}type=${t}&action=${a}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers, timeout: 4000 });
                            const items = r.data?.js?.data || r.data?.js || [];
                            return (Array.isArray(items) ? items : Object.values(items)).map(g => g.title || g.name).filter(Boolean);
                        };
                        const [g1, g2, g3] = await Promise.all([fetchSt('itv', 'get_genres'), fetchSt('vod', 'get_categories'), fetchSt('series', 'get_categories')]);
                        tvG = tvG.concat(g1); movG = movG.concat(g2); serG = serG.concat(g3);
                    }
                }
            } catch(e) {}
            catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: tvG.filter(Boolean) }, { name: "skip" }] });
            catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: movG.filter(Boolean) }, { name: "skip" }] });
            catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: serG.filter(Boolean) }, { name: "skip" }] });
        }));

        const addonName = lists.map(l => l.name).filter(Boolean).join(" + ") || "XuloV Hub";
        const m = { id: "org.xulov.stalker", version: "5.1.14", name: addonName, resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
        setCache(cacheKey, m, 60); return m;
    },

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx]; if (!config) return { metas: [] };
        const skip = parseInt(extra.skip) || 0;
        let metas = [];
        try {
            if (config.type === 'xtream') {
                const b = config.url.trim().replace(/\/$/, "");
                const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                let act = type === "tv" ? "get_live_streams" : (type === "movie" ? "get_vod_streams" : "get_series");

                const cacheKey = `cat_data_${id}_${type}_${extra.genre || 'all'}`;
                let cachedMetas = getCache(cacheKey);

                if (!cachedMetas) {
                    if (extra.genre && extra.genre !== "Predefinido") {
                        const cAct = type === "tv" ? "get_live_categories" : (type === "movie" ? "get_vod_categories" : "get_series_categories");
                        const cRes = await axios.get(`${api}&action=${cAct}`, {timeout: 4000});
                        const cat = (cRes.data || []).find(c => c.category_name === extra.genre);
                        if (cat) act += `&category_id=${cat.category_id}`;
                    }
                    const res = await axios.get(`${api}&action=${act}`, {timeout: 10000});
                    cachedMetas = (Array.isArray(res.data) ? res.data : []).map(item => ({
                        id: `xlv:${lIdx}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}`,
                        name: item.name || item.title, type: type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                    }));
                    setCache(cacheKey, cachedMetas, 10);
                }
                metas = cachedMetas.slice(skip, skip + 100);
            } else {
                const cacheKey = `stalker_cat_${id}_${type}_${extra.genre || 'all'}_${skip}`;
                let cachedMetas = getCache(cacheKey);

                if (!cachedMetas) {
                    const auth = await this.authenticate(config);
                    if (auth) {
                        const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                        const sAct = type === "tv" ? "get_all_channels" : "get_ordered_list";
                        let catP = "";
                        if (extra.genre && extra.genre !== "Predefinido") {
                            const cAct = sType === "itv" ? "get_genres" : "get_categories";
                            const cRes = await axios.get(`${auth.api}type=${sType}&action=${cAct}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers, timeout: 4000 });
                            const cats = cRes.data?.js?.data || cRes.data?.js || [];
                            const cat = (Array.isArray(cats) ? cats : Object.values(cats)).find(c => (c.title || c.name) === extra.genre);
                            if (cat) catP = sType === "itv" ? `&genre=${cat.id}` : `&category=${cat.id}`;
                        }
                        const page = Math.floor(skip / 14) + 1;
                        const url = `${auth.api}type=${sType}&action=${sAct}${catP}&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        const res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                        const raw = res.data?.js?.data || res.data?.js || [];
                        cachedMetas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                            id: `xlv:${lIdx}:${encodeURIComponent(m.cmd || m.id)}:${encodeURIComponent(m.name || m.title)}`,
                            name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                        }));
                        setCache(cacheKey, cachedMetas, 10);
                    } else {
                        cachedMetas = [];
                    }
                }
                metas = cachedMetas;
            }
        } catch (e) {}
        return { metas };
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const name = decodeURIComponent(parts[3] || "Conteúdo");
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        let meta = { id, type, name, posterShape: type === "tv" ? "landscape" : "poster" };

        if (type === 'movie') {
            try {
                if (config?.type === 'xtream') {
                    const b = config.url.trim().replace(/\/$/, "");
                    const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                    const cleanId = sId.split('.')[0]; 
                    const res = await axios.get(`${api}&action=get_vod_info&vod_id=${cleanId}`, { timeout: 10000 });
                    if (res.data?.info) {
                        meta.description = res.data.info.plot || res.data.info.description || "";
                        meta.poster = res.data.info.cover || "";
                        meta.background = (res.data.info.backdrop_path && res.data.info.backdrop_path.length > 0) ? res.data.info.backdrop_path[0] : meta.poster;
                        if (res.data.info.director) meta.director = [res.data.info.director];
                        if (res.data.info.cast) meta.cast = res.data.info.cast.split(',').map(c => c.trim());
                    }
                } else {
                    const auth = await this.authenticate(config);
                    if (auth) {
                        const url = `${auth.api}type=vod&action=get_info&movie_id=${sId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        const res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                        const info = res.data?.js || {};
                        if (info) {
                            meta.description = info.description || info.plot || "";
                            meta.poster = info.screenshot_uri || info.logo || info.cover || "";
                            meta.background = info.screenshot_uri || meta.poster;
                            if (info.director) meta.director = [info.director];
                            if (info.actors) meta.cast = info.actors.split(',').map(c => c.trim());
                        }
                    }
                }
            } catch (e) {}
        }
        else if (type === 'series') {
            try {
                if (config?.type === 'xtream') {
                    const b = config.url.trim().replace(/\/$/, "");
                    const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                    const res = await axios.get(`${api}&action=get_series_info&series_id=${sId}`, { timeout: 10000 });

                    if (res.data?.info) {
                        meta.description = res.data.info.plot || res.data.info.description || "";
                        meta.poster = res.data.info.cover || "";
                        if (res.data.info.backdrop_path && res.data.info.backdrop_path.length > 0) {
                            meta.background = res.data.info.backdrop_path[0];
                        } else {
                            meta.background = meta.poster;
                        }
                    }

                    if (res.data?.episodes) {
                        let videos = [];
                        Object.keys(res.data.episodes).forEach(sN => {
                            const sNum = parseInt(sN);
                            res.data.episodes[sN].forEach((ep) => {
                                videos.push({
                                    id: `xlv:${lIdx}:${ep.id}.${ep.container_extension || 'mkv'}:${encodeURIComponent(ep.title || 'Ep')}`,
                                    title: ep.title || ep.info?.name || `Episódio ${ep.episode_num}`,
                                    season: sNum,
                                    episode: parseInt(ep.episode_num),
                                    thumbnail: ep.info?.movie_image || ep.info?.cover || meta.poster,
                                    overview: ep.info?.plot || ep.info?.description || ""
                                });
                            });
                        });
                        meta.videos = videos.sort((a, b) => a.season - b.season || a.episode - b.episode);
                    }
                } else {
                    const auth = await this.authenticate(config);
                    if (auth) {
                        const url = `${auth.api}type=series&action=get_ordered_list&movie_id=${sId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        const res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                        const items = res.data?.js?.data || res.data?.js || [];
                        const itemsArray = Array.isArray(items) ? items : Object.values(items);

                        let firstItem = itemsArray[0];
                        if (firstItem) {
                            meta.description = firstItem.description || firstItem.plot || "";
                            meta.poster = firstItem.logo || firstItem.screenshot_uri || firstItem.cover || "";
                            meta.background = firstItem.screenshot_uri || firstItem.logo || firstItem.cover || meta.poster;
                        }

                        let allVideos = [];
                        let flatEpCount = 1;

                        for (const item of itemsArray) {
                            // CÓDIGO INFALÍVEL PARA DETETAR PASTAS DE TEMPORADAS NO STALKER
                            const isDir = item.is_dir == 1 || item.type === 'season' || (item.name && /season|temporada|t\s*\d+/i.test(item.name) && !item.cmd);

                            if (isDir) {
                                // Encontrou uma pasta de Temporada. Vai ler o número da temporada.
                                let sMatch = item.name ? item.name.match(/(?:season|temporada|t)\s*(\d+)/i) : null;
                                let sNum = sMatch ? parseInt(sMatch[1]) : 1;

                                try {
                                    // Puxa os episódios DENTRO desta pasta
                                    const sUrl = `${auth.api}type=series&action=get_ordered_list&movie_id=${item.id}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                                    const sRes = await axios.get(sUrl, { headers: auth.authData.headers, timeout: 5000 });
                                    const eps = sRes.data?.js?.data || sRes.data?.js || [];
                                    const epsArray = Array.isArray(eps) ? eps : Object.values(eps);

                                    epsArray.forEach((ep, idx) => {
                                        let eMatch = ep.name ? ep.name.match(/(?:episode|episódio|ep|e)\s*(\d+)/i) : null;
                                        let seMatch = ep.name ? ep.name.match(/S(\d+).*?E(\d+)/i) : null;

                                        let finalS = seMatch ? parseInt(seMatch[1]) : sNum;
                                        let finalE = ep.episode ? parseInt(ep.episode) : (seMatch ? parseInt(seMatch[2]) : (eMatch ? parseInt(eMatch[1]) : (idx + 1)));

                                        const playId = ep.cmd || ep.id;
                                        if (playId) {
                                            allVideos.push({
                                                id: `xlv:${lIdx}:${encodeURIComponent(playId)}:${encodeURIComponent(ep.name || 'Episódio ' + finalE)}`,
                                                title: ep.name || `Episódio ${finalE}`,
                                                season: finalS,
                                                episode: finalE,
                                                thumbnail: ep.screenshot_uri || ep.logo || meta.poster,
                                                overview: ep.description || ""
                                            });
                                        }
                                    });
                                } catch (e) {}
                            } else {
                                // É um episódio solto
                                let seMatch = item.name ? item.name.match(/S(\d+).*?E(\d+)/i) : null;
                                let sMatch = item.name ? item.name.match(/(?:season|temporada|t)\s*(\d+)/i) : null;
                                let eMatch = item.name ? item.name.match(/(?:episode|episódio|ep|e)\s*(\d+)/i) : null;

                                const sNum = item.season ? parseInt(item.season) : (seMatch ? parseInt(seMatch[1]) : (sMatch ? parseInt(sMatch[1]) : 1));
                                const eNum = item.episode ? parseInt(item.episode) : (seMatch ? parseInt(seMatch[2]) : (eMatch ? parseInt(eMatch[1]) : flatEpCount++));

                                const playId = item.cmd || item.id;
                                if (playId) {
                                    allVideos.push({
                                        id: `xlv:${lIdx}:${encodeURIComponent(playId)}:${encodeURIComponent(item.name || 'Episódio ' + eNum)}`,
                                        title: item.name || `Episódio ${eNum}`,
                                        season: sNum,
                                        episode: eNum,
                                        thumbnail: item.screenshot_uri || item.logo || meta.poster,
                                        overview: item.description || ""
                                    });
                                }
                            }
                        }
                        meta.videos = allVideos;
                    }
                }
            } catch (e) {}
        }
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const name = decodeURIComponent(parts[3] || "Stream");
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];

        if (config?.type === 'xtream') {
            const b = config.url.trim().replace(/\/$/, "");

            if (type === 'tv') {
                return { 
                    streams: [
                        { url: `${b}/${config.user}/${config.pass}/${sId}`, title: `📺 Directo (TS Original)`, behaviorHints: { notWebReady: true } },
                        { url: `${b}/live/${config.user}/${config.pass}/${sId}.m3u8`, title: `🚀 HLS (Samsung/Android)`, behaviorHints: { notWebReady: true } },
                        { url: `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`, title: `🛡️ Proxy (Anti-Queda)`, behaviorHints: { notWebReady: true } }
                    ] 
                };
            } else {
                let url = sId.includes('.') ? `${b}/${type === 'series' ? 'series' : 'movie'}/${config.user}/${config.pass}/${sId}` : `${b}/movie/${config.user}/${config.pass}/${sId}.mp4`;
                return { 
                    streams: [
                        { url, title: `🎬 Directo: ${name}`, behaviorHints: { notWebReady: true } },
                        { url: `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`, title: `🛡️ Proxy Estável`, behaviorHints: { notWebReady: true } }
                    ] 
                };
            }
        }

        let streams = [];
        try {
            const auth = await addon.authenticate(config);
            if (auth) {
                const cmdType = type === "tv" ? "itv" : "vod";
                let stalkerCmd = decodeURIComponent(sId);
                
                let cleanUrl = "";

                // Verifica se o URL direto já vem cravado no próprio ID/Cmd
                if (stalkerCmd.startsWith('http') || stalkerCmd.startsWith('ffmpeg http')) {
                    cleanUrl = stalkerCmd.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                } else {
                    // Pede a autorização e o link gerado ao portal Stalker
                    const linkUrl = `${auth.api}type=${cmdType}&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const res = await axios.get(linkUrl, { headers: auth.authData.headers, timeout: 5000 });
                    let cmdUrl = res.data?.js?.cmd || res.data?.js;
                    
                    if (typeof cmdUrl === 'string') {
                        cleanUrl = cmdUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                    }
                }

                if (cleanUrl) {
                    // Previne links relativos manhosos que alguns Stalkers enviam
                    if (cleanUrl.startsWith('//')) cleanUrl = 'http:' + cleanUrl;
                    else if (cleanUrl.startsWith('/')) {
                        const u = new URL(auth.api);
                        cleanUrl = `${u.protocol}//${u.host}${cleanUrl}`;
                    }

                    if (cleanUrl.startsWith('http')) {
                        const tituloDirecto = type === "tv" ? "⚡ Directo TV" : "🎬 Directo Filme/Série";
                        
                        streams.push({ 
                            url: cleanUrl, 
                            title: tituloDirecto, 
                            behaviorHints: { 
                                notWebReady: true,
                                // INJEÇÃO MAG BOX PARA VOD: Evita erro 403 Forbidden no portal!
                                proxyHeaders: {
                                    request: {
                                        "User-Agent": auth.authData.headers["User-Agent"],
                                        "Cookie": auth.authData.headers["Cookie"] || "",
                                        "Connection": "keep-alive"
                                    }
                                }
                            } 
                        });
                    }
                }
            }
        } catch(e) {}

        // O nosso proxy blindado do Render continua lá sempre como opção de fallback
        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;
        streams.push({ 
            url: pUrl, 
            title: `🛡️ Proxy Estável (Render)`, 
            behaviorHints: { notWebReady: true } 
        });

        return { streams };
    }
};

module.exports = addon;

