const axios = require("axios");
const crypto = require("crypto");

// --- UTILS & CACHE ---
const memCache = {};
function getCache(key) {
    const cached = memCache[key];
    return (cached && cached.expire > Date.now()) ? cached.data : null;
}
function setCache(key, data, ttlMinutes = 30) {
    memCache[key] = { data, expire: Date.now() + (ttlMinutes * 60 * 1000) };
}

// --- STALKER AUTH ENGINE ---
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
                    // ⚡ CORREÇÃO: Restaurada a leitura das Categorias do Stalker
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
            catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: tvG.filter(Boolean) }] });
            catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: movG.filter(Boolean) }, { name: "skip" }] });
            catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: serG.filter(Boolean) }, { name: "skip" }] });
        }));

        const m = { id: "org.xulov.stalker", version: "5.0.2", name: "XuloV Hub", resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
        setCache(cacheKey, m, 60); return m;
    },

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx]; if (!config) return { metas: [] };
        const skip = extra && extra.skip ? parseInt(extra.skip) : 0;
        let metas = [];

        try {
            if (config.type === 'xtream') {
                const b = config.url.trim().replace(/\/$/, "");
                const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                let act = type === "tv" ? "get_live_streams" : (type === "movie" ? "get_vod_streams" : "get_series");
                
                if (extra.genre && extra.genre !== "Predefinido") {
                    const cAct = type === "tv" ? "get_live_categories" : (type === "movie" ? "get_vod_categories" : "get_series_categories");
                    const cRes = await axios.get(`${api}&action=${cAct}`, {timeout: 4000});
                    const cat = (cRes.data || []).find(c => c.category_name === extra.genre);
                    if (cat) act += `&category_id=${cat.category_id}`;
                }

                const res = await axios.get(`${api}&action=${act}`, {timeout: 10000});
                metas = (Array.isArray(res.data) ? res.data : []).map(item => ({
                    id: `xlv:${lIdx}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}`,
                    name: item.name || item.title, type: type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                }));
            } else {
                const auth = await this.authenticate(config);
                if (auth) {
                    const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                    const sAct = type === "tv" ? "get_all_channels" : "get_ordered_list";
                    let categoryParam = "";

                    // ⚡ CORREÇÃO: Restaurado o mapeamento da Categoria Escolhida no Stalker
                    if (extra.genre && extra.genre !== "Predefinido") {
                        const cAct = sType === "itv" ? "get_genres" : "get_categories";
                        const cRes = await axios.get(`${auth.api}type=${sType}&action=${cAct}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers, timeout: 4000 });
                        const cats = cRes.data?.js?.data || cRes.data?.js || [];
                        const catArray = Array.isArray(cats) ? cats : Object.values(cats);
                        const cat = catArray.find(c => (c.title || c.name) === extra.genre);
                        if (cat) categoryParam = sType === "itv" ? `&genre=${cat.id}` : `&category=${cat.id}`;
                    }

                    const page = skip ? Math.floor(skip / 14) + 1 : 1;
                    const url = `${auth.api}type=${sType}&action=${sAct}${categoryParam}&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                    const rawData = res.data?.js?.data || res.data?.js || [];
                    const itemsArray = Array.isArray(rawData) ? rawData : Object.values(rawData);
                    
                    metas = itemsArray.filter(i => i && (i.id || i.cmd)).map(m => ({
                        id: `xlv:${lIdx}:${m.id || encodeURIComponent(m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                    }));
                }
            }
        } catch (e) {}
        return { metas: metas.slice(skip, skip + 100) };
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const name = decodeURIComponent(parts[3] || "Conteúdo");
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        let meta = { id, type, name, posterShape: type === "tv" ? "landscape" : "poster" };

        if (type === 'series' && config?.type === 'xtream') {
            try {
                const b = config.url.trim().replace(/\/$/, "");
                const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                const res = await axios.get(`${api}&action=get_series_info&series_id=${sId}`, { timeout: 10000 });
                if (res.data?.episodes) {
                    let videos = [];
                    Object.keys(res.data.episodes).forEach(sN => {
                        res.data.episodes[sN].forEach(ep => {
                            videos.push({
                                id: `xlv:${lIdx}:${ep.id}.${ep.container_extension || 'mkv'}:${encodeURIComponent(ep.title)}`,
                                title: ep.title || `T${sN} E${ep.episode_num}`,
                                season: parseInt(sN), number: parseInt(ep.episode_num)
                            });
                        });
                    });
                    meta.videos = videos;
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
            let url = "";
            
            // ⚡ CORREÇÃO XTREAM TV: Link exato e universal para os canais voltarem todos a abrir.
            if (type === 'tv') {
                url = `${b}/${config.user}/${config.pass}/${sId}`;
            } 
            else if (sId.includes('.')) {
                const path = type === 'series' ? 'series' : 'movie';
                url = `${b}/${path}/${config.user}/${config.pass}/${sId}`;
            } else {
                url = `${b}/movie/${config.user}/${config.pass}/${sId}.mp4`;
            }
            return { streams: [{ url, title: `🚀 ${name}`, behaviorHints: { notWebReady: true } }] };
        }
        
        const pUrl = `http://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;
        return { streams: [{ url: pUrl, title: `🛡️ Proxy: ${name}`, behaviorHints: { notWebReady: true } }] };
    }
};

module.exports = addon;

