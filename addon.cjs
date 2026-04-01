const axios = require("axios");
const crypto = require("crypto");
const { SocksProxyAgent } = require('socks-proxy-agent');
const http = require('http');
const https = require('https');

// Configuração de agentes globais para manter as ligações abertas (Keep-Alive)
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const memCache = {};
function getCache(key) {
    const cached = memCache[key];
    return (cached && cached.expire > Date.now()) ? cached.data : null;
}
function setCache(key, data, ttlMinutes = 30) {
    memCache[key] = { data, expire: Date.now() + (ttlMinutes * 60 * 1000) };
}

const agentCache = {}; 

const getStalkerAuth = function(config, token) {
    const mac = (config.mac || "").toUpperCase();
    const seed = crypto.createHash('md5').update(mac || 'vazio').digest('hex').toUpperCase();

    const sn  = config.sn  || seed.substring(0, 14); 
    const id1 = config.id1 || seed; 
    const sig = config.sig || "";

    const model = config.model || "MAG250";
    let ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
    let xua = `Model: ${model}; SW: 0.2.18-r14; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;

    let cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`;
    if (token) cookie += ` access_token=${token};`;

    return {
        sn, id1, sig,
        headers: {
            "User-Agent": ua,
            "X-User-Agent": xua,
            "Cookie": cookie,
            "Referer": config.url.replace(/\/$/, "") + "/c/",
            "Accept": "*/*",
            "Connection": "keep-alive" // 🔥 Força a ligação a não fechar
        }
    };
};

const addon = {
    getAxiosOpts(config, extraOpts = {}) {
        let opts = { 
            ...extraOpts,
            httpAgent: httpAgent, 
            httpsAgent: httpsAgent,
            timeout: extraOpts.timeout || 8000 // Timeout ligeiramente mais curto para não prender a TV
        };
        
        if (config && config.proxy) {
            const proxyStr = config.proxy.trim();
            if (proxyStr.startsWith('socks')) {
                if (!agentCache[proxyStr]) {
                    agentCache[proxyStr] = new SocksProxyAgent(proxyStr, { keepAlive: true });
                }
                opts.httpAgent = agentCache[proxyStr];
                opts.httpsAgent = agentCache[proxyStr];
            } else if (proxyStr.startsWith('http')) {
                try {
                    const p = new URL(proxyStr);
                    opts.proxy = {
                        protocol: p.protocol.replace(':', ''),
                        host: p.hostname,
                        port: parseInt(p.port),
                        auth: p.username ? { username: decodeURIComponent(p.username), password: decodeURIComponent(p.password) } : undefined
                    };
                } catch(e) {}
            }
        }
        return opts;
    },

    parseConfig(configBase64) {
        const cacheKey = `parsed_${configBase64}`;
        const cached = getCache(cacheKey);
        if (cached) return cached;
        try { 
            const decoded = Buffer.from(decodeURIComponent(configBase64), 'base64').toString('utf8');
            const data = JSON.parse(decoded);
            const res = data.lists || [];
            setCache(cacheKey, res, 60);
            return res;
        } catch (e) { return []; }
    },

    async authenticate(config) {
        if (config.type === 'xtream') return true;
        const cacheKey = `auth_${config.url}_${config.mac || 'nomac'}`;
        const cachedAuth = getCache(cacheKey);
        if (cachedAuth) return cachedAuth;

        const authData = getStalkerAuth(config, null);
        let baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const url = baseUrl + "portal.php";

        try {
            const hUrl = `${url}?type=stb&action=handshake&sn=${authData.sn}&device_id=${authData.id1}&JsHttpRequest=1-0`;
            const res = await axios.get(hUrl, this.getAxiosOpts(config, { headers: authData.headers }));
            const token = res.data?.js?.token || res.data?.token || null;

            if (token) {
                const finalAuth = { token: token, api: url + "?", authData: getStalkerAuth(config, token) };
                setCache(cacheKey, finalAuth, 50); // Cache ligeiramente inferior ao timeout do portal
                return finalAuth;
            }
            return null;
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const cacheKey = `manifest_${configBase64}`;
        const cached = getCache(cacheKey); if (cached) return cached;
        const lists = this.parseConfig(configBase64);
        
        let catalogs = [];
        // 🔥 PERFORMANCE: Carregamento paralelo ultra-rápido
        await Promise.all(lists.map(async (l, i) => {
            const listCacheKey = `list_cats_${i}_${configBase64}`;
            let listCats = getCache(listCacheKey);
            
            if (!listCats) {
                let tvG = ["Predefinido"]; let movG = ["Predefinido"]; let serG = ["Predefinido"];
                try {
                    if (l.type === 'xtream') {
                        const b = l.url.trim().replace(/\/$/, "");
                        const api = `${b}/player_api.php?username=${encodeURIComponent(l.user)}&password=${encodeURIComponent(l.pass)}`;
                        const f = async (a) => {
                            const r = await axios.get(`${api}&action=${a}`, this.getAxiosOpts(l, { timeout: 4000 }));
                            return Array.isArray(r.data) ? r.data : [];
                        };
                        const [c1, c2, c3] = await Promise.all([f('get_live_categories'), f('get_vod_categories'), f('get_series_categories')]);
                        setCache(`xcats_${b}_get_live_categories`, c1, 120);
                        setCache(`xcats_${b}_get_vod_categories`, c2, 120);
                        setCache(`xcats_${b}_get_series_categories`, c3, 120);
                        tvG = tvG.concat(c1.map(g => g.category_name));
                        movG = movG.concat(c2.map(g => g.category_name));
                        serG = serG.concat(c3.map(g => g.category_name));
                    } else {
                        const auth = await this.authenticate(l);
                        if (auth) {
                            const fSt = async (t, a) => {
                                const r = await axios.get(`${auth.api}type=${t}&action=${a}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(l, { headers: auth.authData.headers, timeout: 4000 }));
                                const items = r.data?.js?.data || r.data?.js || [];
                                setCache(`scats_${auth.api}_${a}`, items, 120);
                                return (Array.isArray(items) ? items : Object.values(items)).map(g => g.title || g.name).filter(Boolean);
                            };
                            const [g1, g2, g3] = await Promise.all([fSt('itv', 'get_genres'), fSt('vod', 'get_categories'), fSt('series', 'get_categories')]);
                            tvG = tvG.concat(g1); movG = movG.concat(g2); serG = serG.concat(g3);
                        }
                    }
                } catch(e) {}
                listCats = { tvG, movG, serG };
                setCache(listCacheKey, listCats, 30);
            }

            catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: listCats.tvG.filter(Boolean) }, { name: "skip" }] });
            catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: listCats.movG.filter(Boolean) }, { name: "skip" }] });
            catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: listCats.serG.filter(Boolean) }, { name: "skip" }] });
        }));

        const m = { id: "org.xulov.stalker", version: "5.4.0", name: "XuloV Ultra Fast", resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs };
        setCache(cacheKey, m, 60); return m;
    },

    async getCatalog(type, id, extra, configBase64) {
        const skip = parseInt(extra.skip) || 0;
        const catalogCacheKey = `catres_${id}_${type}_${extra.genre || 'all'}_${skip}_${configBase64}`;
        const cached = getCache(catalogCacheKey); if (cached) return cached;

        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx]; if (!config) return { metas: [] };
        
        let metas = [];
        try {
            if (config.type === 'xtream') {
                const b = config.url.trim().replace(/\/$/, "");
                const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                let act = type === "tv" ? "get_live_streams" : (type === "movie" ? "get_vod_streams" : "get_series");
                if (extra.genre && extra.genre !== "Predefinido") {
                    const cAct = type === "tv" ? "get_live_categories" : (type === "movie" ? "get_vod_categories" : "get_series_categories");
                    let cats = getCache(`xcats_${b}_${cAct}`);
                    if (!cats) {
                        const cRes = await axios.get(`${api}&action=${cAct}`, this.getAxiosOpts(config));
                        cats = cRes.data || [];
                    }
                    const cat = cats.find(c => c.category_name === extra.genre);
                    if (cat) act += `&category_id=${cat.category_id}`;
                }
                const res = await axios.get(`${api}&action=${act}`, this.getAxiosOpts(config));
                metas = (Array.isArray(res.data) ? res.data : []).slice(skip, skip + 100).map(item => ({
                    id: `xlv:${lIdx}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}`,
                    name: item.name || item.title, type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                }));
            } else {
                const auth = await this.authenticate(config);
                if (auth) {
                    const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                    let catP = "";
                    if (extra.genre && extra.genre !== "Predefinido") {
                        const cAct = sType === "itv" ? "get_genres" : "get_categories";
                        let cats = getCache(`scats_${auth.api}_${cAct}`);
                        if (!cats) {
                            const cRes = await axios.get(`${auth.api}type=${sType}&action=${cAct}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers }));
                            cats = cRes.data?.js?.data || cRes.data?.js || [];
                        }
                        const cat = (Array.isArray(cats) ? cats : Object.values(cats)).find(c => (c.title || c.name) === extra.genre);
                        if (cat) catP = sType === "itv" ? `&genre=${cat.id}` : `&category=${cat.id}`;
                    }
                    const page = Math.floor(skip / 14) + 1;
                    const url = `${auth.api}type=${sType}&action=get_ordered_list${catP}&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                    const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers }));
                    const raw = res.data?.js?.data || res.data?.js || [];
                    metas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                        id: `xlv:${lIdx}:${encodeURIComponent(m.cmd || m.id)}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title, type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                    }));
                }
            }
        } catch (e) {}
        
        const result = { metas };
        setCache(catalogCacheKey, result, 20);
        return result;
    },

    async getMeta(type, id) {
        const parts = id.split(":");
        const name = decodeURIComponent(parts[3] || "Conteúdo");
        return { meta: { id, type, name, posterShape: type === "tv" ? "landscape" : "poster" } };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;

        if (type !== 'tv') return { streams: [{ url: pUrl, title: `🎬 Reproduzir (Proxy)`, behaviorHints: { notWebReady: true } }] };

        if (config?.type === 'xtream') {
            const b = config.url.trim().replace(/\/$/, "");
            return { streams: [{ url: `${b}/${config.user}/${config.pass}/${sId}`, title: `📺 Directo`, behaviorHints: { notWebReady: true } }, { url: pUrl, title: `🛡️ Proxy`, behaviorHints: { notWebReady: true } }] };
        }

        let streams = [];
        try {
            const auth = await this.authenticate(config);
            if (auth) {
                const linkUrl = `${auth.api}type=itv&action=create_link&cmd=${encodeURIComponent(decodeURIComponent(sId))}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(linkUrl, this.getAxiosOpts(config, { headers: auth.authData.headers }));
                let cmdUrl = res.data?.js?.cmd || res.data?.js;
                if (typeof cmdUrl === 'string') {
                    let cleanUrl = cmdUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                    if (cleanUrl.startsWith('http')) streams.push({ url: cleanUrl, title: `⚡ Directo TV`, behaviorHints: { notWebReady: true } });
                }
            }
        } catch(e) {}

        streams.push({ url: pUrl, title: `🔄 Proxy Estável`, behaviorHints: { notWebReady: true } });
        return { streams };
    }
};

module.exports = addon;