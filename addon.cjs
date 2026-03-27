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
    const mac = (config.mac || "").toUpperCase();
    const sn  = config.sn  || "123456789012"; 
    const id1 = config.id1 || "5A6B7C8D9E0F1A2B3C4D5E6F"; 
    const sig = config.sig || "6D884C699E2A89C71D2D5E1E6B9E8A7F";

    let cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`;
    if (token) cookie += ` access_token=${token};`;

    const xUserAgent = `Model: MAG250; SW: 0.2.18-r14; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;

    return {
        sn: sn,
        id1: id1,
        sig: sig,
        headers: {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
            "X-User-Agent": xUserAgent,
            "Cookie": cookie,
            "Referer": config.url.replace(/\/$/, "") + "/c/",
            "Accept": "*/*",
            "Connection": "Keep-Alive"
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

        const cacheKey = `auth_${config.url}_${config.mac || 'nomac'}`;
        const cachedAuth = getCache(cacheKey);
        if (cachedAuth) return cachedAuth;

        var authData = getStalkerAuth(config, null);
        var baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        var url = baseUrl + "portal.php";
        
        try {
            var hUrl = url + "?type=stb&action=handshake&sn=" + authData.sn + "&device_id=" + authData.id1 + "&JsHttpRequest=1-0";
            var res = await axios.get(hUrl, { headers: authData.headers, timeout: 5000 });
            var token = res.data?.js?.token || res.data?.token || null;
            
            if (token) {
                const finalAuth = { token: token, api: url + "?", authData: getStalkerAuth(config, token) };
                setCache(cacheKey, finalAuth, 60);
                return finalAuth;
            }
            return null;
        } catch (e) { 
            console.error("[AUTH ERROR] Falha no login Stalker:", e.message);
            return null; 
        }
    },

    async getManifest(configBase64) {
        const cacheKey = `manifest_${configBase64}`;
        const cached = getCache(cacheKey); if (cached) return cached;
        const lists = this.parseConfig(configBase64);
        let catalogs = [];
        
        await Promise.all(lists.map(async (l, i) => {
            try {
                if (l.type === 'xtream') {
                    let tvG = ["Predefinido"], movG = ["Predefinido"], serG = ["Predefinido"];
                    const b = l.url.trim().replace(/\/$/, "");
                    const api = `${b}/player_api.php?username=${encodeURIComponent(l.user)}&password=${encodeURIComponent(l.pass)}`;
                    const f = async (a) => { const r = await axios.get(`${api}&action=${a}`, { timeout: 3000 }); return Array.isArray(r.data) ? r.data.map(g => g.category_name) : []; };
                    const [c1, c2, c3] = await Promise.all([f('get_live_categories'), f('get_vod_categories'), f('get_series_categories')]);
                    
                    catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: tvG.concat(c1).filter(Boolean) }, { name: "skip" }] });
                    catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: movG.concat(c2).filter(Boolean) }, { name: "skip" }] });
                    catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: serG.concat(c3).filter(Boolean) }, { name: "skip" }] });
                } else {
                    // 🔥 STALKER: Apenas TV, sem Filmes nem Séries!
                    const auth = await addon.authenticate(l);
                    if (auth) {
                        const r = await axios.get(`${auth.api}type=itv&action=get_genres&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers, timeout: 4000 });
                        const items = r.data?.js?.data || r.data?.js || [];
                        const genres = (Array.isArray(items) ? items : Object.values(items)).map(g => g.title || g.name).filter(Boolean);
                        
                        catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: ["Predefinido"].concat(genres) }, { name: "skip" }] });
                    }
                }
            } catch(e) { console.error(`[MANIFEST ERROR] Falha ao carregar lista ${i}:`, e.message); }
        }));

        const addonName = lists.map(l => l.name).filter(Boolean).join(" + ") || "XuloV Hub";
        const m = { id: "org.xulov.stalker", version: "6.0.0", name: addonName, resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
        setCache(cacheKey, m, 60); return m;
    },

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx]; if (!config) return { metas: [] };
        
        // 🔥 PROTEÇÃO: Se for Stalker e pedirem Filmes/Séries, ignora sem dar erro.
        if (config.type !== 'xtream' && type !== 'tv') return { metas: [] };

        const skip = parseInt(extra.skip) || 0;
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
                metas = (Array.isArray(res.data) ? res.data : []).slice(skip, skip + 100).map(item => ({
                    id: `xlv:${lIdx}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}`,
                    name: item.name || item.title, type: type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                }));
            } else {
                // 🔥 STALKER: Lógica 100% dedicada aos canais (itv)
                const auth = await addon.authenticate(config);
                if (auth) {
                    let catP = "";
                    if (extra.genre && extra.genre !== "Predefinido") {
                        const cRes = await axios.get(`${auth.api}type=itv&action=get_genres&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers, timeout: 4000 });
                        const cats = cRes.data?.js?.data || cRes.data?.js || [];
                        const cat = (Array.isArray(cats) ? cats : Object.values(cats)).find(c => (c.title || c.name) === extra.genre);
                        if (cat) catP = `&genre=${cat.id}`;
                    }
                    
                    let sAct = catP ? "get_ordered_list" : "get_all_channels";
                    const page = Math.floor(skip / 14) + 1;
                    const url = `${auth.api}type=itv&action=${sAct}${catP}&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                    const raw = res.data?.js?.data || res.data?.js || [];
                    metas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                        id: `xlv:${lIdx}:${encodeURIComponent(m.cmd || m.id)}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: "landscape"
                    }));
                }
            }
        } catch (e) { console.error("[CATALOG ERROR]", e.message); }
        return { metas };
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":"); const name = decodeURIComponent(parts[3] || "Conteúdo");
        return { meta: { id, type, name, posterShape: type === "tv" ? "landscape" : "poster" } };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;

        // 🔥 PROTEÇÃO STREAM: Bloqueia streams de filmes/séries no Stalker
        if (config?.type !== 'xtream' && type !== 'tv') return { streams: [] };

        if (config?.type === 'xtream') {
            const b = config.url.trim().replace(/\/$/, "");
            if (type === 'tv') {
                return { streams: [{ url: `${b}/${config.user}/${config.pass}/${sId}`, title: `📺 Directo`, behaviorHints: { notWebReady: true } }, { url: pUrl, title: `🛡️ Proxy`, behaviorHints: { notWebReady: true } }] };
            }
            return { streams: [{ url: pUrl, title: `🎬 Reproduzir Xtream`, behaviorHints: { notWebReady: true } }] };
        }

        // 🔥 STALKER: Apenas gera links para Canais de TV ('itv')
        let streams = [];
        try {
            const auth = await addon.authenticate(config);
            if (auth) {
                const linkUrl = `${auth.api}type=itv&action=create_link&cmd=${encodeURIComponent(decodeURIComponent(sId))}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(linkUrl, { headers: auth.authData.headers, timeout: 5000 });
                let cmdUrl = res.data?.js?.cmd || res.data?.js;
                if (typeof cmdUrl === 'string') {
                    let cleanUrl = cmdUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                    if (cleanUrl.startsWith('http')) streams.push({ url: cleanUrl, title: `⚡ Directo TV`, behaviorHints: { notWebReady: true } });
                }
            }
        } catch(e) { console.error("[STREAM ERROR]", e.message); }
        
        streams.push({ url: pUrl, title: `🔄 Proxy Estável`, behaviorHints: { notWebReady: true } });
        return { streams };
    }
};

module.exports = addon;


