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
            "Cookie": cookie, 
            "Referer": config.url.replace(/\/$/, "") + "/c/", 
            "Connection": "keep-alive"
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
        const m = { id: "org.xulov.stalker", version: "5.2.1", name: addonName, resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
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
                const auth = await addon.authenticate(config);
                if (auth) {
                    const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                    let catP = "";
                    if (extra.genre && extra.genre !== "Predefinido") {
                        const cAct = sType === "itv" ? "get_genres" : "get_categories";
                        const cRes = await axios.get(`${auth.api}type=${sType}&action=${cAct}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers, timeout: 4000 });
                        const cats = cRes.data?.js?.data || cRes.data?.js || [];
                        const cat = (Array.isArray(cats) ? cats : Object.values(cats)).find(c => (c.title || c.name) === extra.genre);
                        if (cat) catP = sType === "itv" ? `&genre=${cat.id}` : `&category=${cat.id}`;
                    }
                    
                    // CORREÇÃO: Lógica para filtrar as categorias e manter listas rápidas
                    let sAct = "get_all_channels"; 
                    if (type === "tv") {
                        sAct = catP ? "get_ordered_list" : "get_all_channels";
                    } else {
                        sAct = "get_ordered_list";
                    }
                    
                    const page = Math.floor(skip / 14) + 1;
                    const url = `${auth.api}type=${sType}&action=${sAct}${catP}&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
                    const raw = res.data?.js?.data || res.data?.js || [];
                    metas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                        id: `xlv:${lIdx}:${encodeURIComponent(m.cmd || m.id)}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                    }));
                }
            }
        } catch (e) {}
        return { metas };
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const name = decodeURIComponent(parts[3] || "Conteúdo");
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        let meta = { id, type, name, posterShape: type === "tv" ? "landscape" : "poster" };
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        
        // A URL do nosso Proxy
        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;

        // Se for Xtream, devolve as duas opções rapidamente
        if (config?.type === 'xtream') {
            const b = config.url.trim().replace(/\/$/, "");
            let directUrl = "";
            if (type === 'tv') directUrl = `${b}/${config.user}/${config.pass}/${sId}`;
            else directUrl = sId.includes('.') ? `${b}/${type === 'series' ? 'series' : 'movie'}/${config.user}/${config.pass}/${sId}` : `${b}/movie/${config.user}/${config.pass}/${sId}.mp4`;
            
            return {
                streams: [
                    { url: directUrl, title: `⚡ Directo (Rápido)`, behaviorHints: { notWebReady: true } },
                    { url: pUrl, title: `🛡️ Proxy Estável`, behaviorHints: { notWebReady: true } }
                ]
            };
        }

        let streams = [];
        try {
            // Lógica Stalker: Vamos tentar ir buscar o link Direto real
            const auth = await addon.authenticate(config);
            if (auth) {
                const cmdType = type === "tv" ? "itv" : "vod";
                let stalkerCmd = decodeURIComponent(sId);

                const linkUrl = `${auth.api}type=${cmdType}&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(linkUrl, { headers: auth.authData.headers, timeout: 5000 });
                let cmdUrl = res.data?.js?.cmd || res.data?.js;

                if (typeof cmdUrl === 'string') {
                    let cleanUrl = cmdUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                    
                    if (!cleanUrl.startsWith('http')) {
                        const baseServer = config.url.replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
                        cleanUrl = baseServer + (cleanUrl.startsWith('/') ? cleanUrl : '/' + cleanUrl);
                    }

                    if (cleanUrl.startsWith('http')) {
                        // Adicionamos a opção DIRECTA que não passa pelo Render (Ideal para filmes pesados)
                        streams.push({ 
                            url: cleanUrl, 
                            title: `⚡ Directo ${type === 'tv' ? 'TV' : 'VOD'}`, 
                            behaviorHints: { 
                                notWebReady: true,
                                // Injetamos o User-Agent nativo para o Stremio imitar a box
                                proxyHeaders: { request: { "User-Agent": auth.authData.headers["User-Agent"] } }
                            } 
                        });
                    }
                }
            }
        } catch(e) {}

        // Adicionamos SEMPRE o Proxy como segunda opção (Para os que saltam fora)
        streams.push({ 
            url: pUrl, 
            title: `🛡️ Proxy (Evita Saltos)`, 
            behaviorHints: { notWebReady: true } 
        });

        return { streams };
    }
};

module.exports = addon;

