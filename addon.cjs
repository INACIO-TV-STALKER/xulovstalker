const axios = require("axios");
const crypto = require("crypto");
const { SocksProxyAgent } = require('socks-proxy-agent');

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
    const seed = crypto.createHash('md5').update(mac || 'vazio').digest('hex').toUpperCase();
    const sn  = config.sn  || seed.substring(0, 14); 
    const id1 = config.id1 || seed; 
    const sig = config.sig || "";

    const model = config.model || "MAG250";
    let ua = "";
    let xua = "";

    switch(model) {
        case "MAG322":
            ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 27211 Safari/533.3";
            xua = `Model: MAG322; SW: 2.20.05-322; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;
            break;
        case "MAG254":
            ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 254 Safari/533.3";
            xua = `Model: MAG254; SW: 0.2.18-r22; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;
            break;
        default:
            ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
            xua = `Model: MAG250; SW: 0.2.18-r14; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;
    }

    let cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`;
    if (token) cookie += ` access_token=${token};`;

    return {
        sn: sn, id1: id1, sig: sig,
        headers: {
            "User-Agent": ua,
            "X-User-Agent": xua,
            "Cookie": cookie,
            "Referer": config.url.replace(/\/$/, "") + "/c/",
            "Accept": "*/*",
            "Connection": "Keep-Alive"
        }
    };
};

const addon = {
    getAxiosOpts(config, extraOpts = {}) {
        let opts = { ...extraOpts };
        if (config && config.proxy) {
            const proxyStr = config.proxy.trim();
            if (proxyStr.startsWith('socks')) {
                const agent = new SocksProxyAgent(proxyStr);
                opts.httpAgent = agent; opts.httpsAgent = agent;
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
        try { 
            const decoded = Buffer.from(decodeURIComponent(configBase64), 'base64').toString('utf8');
            return JSON.parse(decoded).lists || []; 
        } catch (e) { return []; }
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
            var res = await axios.get(hUrl, this.getAxiosOpts(config, { headers: authData.headers, timeout: 10000 }));
            var token = res.data?.js?.token || res.data?.token || null;
            if (token) {
                const finalAuth = { token: token, api: url + "?", authData: getStalkerAuth(config, token) };
                setCache(cacheKey, finalAuth, 60);
                return finalAuth;
            }
            return null;
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        let catalogs = [];
        await Promise.all(lists.map(async (l, i) => {
            catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: ["Predefinido"] }, { name: "skip" }] });
            catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: ["Predefinido"] }, { name: "skip" }] });
            catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: ["Predefinido"] }, { name: "skip" }] });
        }));
        return { id: "org.xulov.stalker", version: "5.4.0", name: "XuloV Hub", resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
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
                const res = await axios.get(`${api}&action=${act}`, this.getAxiosOpts(config, {timeout: 10000}));
                metas = (Array.isArray(res.data) ? res.data : []).slice(skip, skip + 100).map(item => ({
                    id: `xlv:${lIdx}:${item.series_id || item.stream_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}`,
                    name: item.name || item.title, type: type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                }));
            } else {
                const auth = await addon.authenticate(config);
                if (auth) {
                    const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                    const url = `${auth.api}type=${sType}&action=get_ordered_list&sn=${auth.authData.sn}&token=${auth.token}&p=${Math.floor(skip/14)+1}&JsHttpRequest=1-0`;
                    const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                    const raw = res.data?.js?.data || res.data?.js || [];
                    metas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                        id: `xlv:${lIdx}:${encodeURIComponent(m.id || m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                    }));
                }
            }
        } catch (e) { }
        return { metas };
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); 
        const sId = decodeURIComponent(parts[2]);
        const name = decodeURIComponent(parts[3] || "Conteúdo");
        let meta = { id, type, name, posterShape: type === "tv" ? "landscape" : "poster" };

        if (type === "series") {
            const lists = addon.parseConfig(configBase64);
            const config = lists[lIdx];
            if (config && config.type !== 'xtream') {
                const auth = await addon.authenticate(config);
                if (auth) {
                    try {
                        // 1. Entra na pasta principal da série
                        let url = `${auth.api}type=series&action=get_ordered_list&category=${sId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        let res = await axios.get(url, addon.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 8000 }));
                        let raw = res.data?.js?.data || res.data?.js || [];
                        let list = Array.isArray(raw) ? raw : Object.values(raw);

                        let videos = [];
                        // 2. Procura por Temporadas (Pastas) ou Episódios Diretos
                        const folders = list.filter(i => i && (i.is_dir == 1 || i.is_dir === "1"));
                        const files = list.filter(i => i && i.cmd && (i.is_dir == 0 || i.is_dir === "0" || !i.is_dir));

                        if (folders.length > 0) {
                            for (let f of folders) {
                                let epUrl = `${auth.api}type=series&action=get_ordered_list&category=${f.id}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                                let epRes = await axios.get(epUrl, addon.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 8000 }));
                                let epRaw = epRes.data?.js?.data || epRes.data?.js || [];
                                let epList = Array.isArray(epRaw) ? epRaw : Object.values(epRaw);
                                
                                epList.forEach((ep, index) => {
                                    if (ep.cmd) {
                                        const epTitle = ep.name || ep.title || `Episódio ${index + 1}`;
                                        const sMatch = (f.name || "").match(/\d+/);
                                        const eMatch = epTitle.match(/[Ee]p?(?:is[oó]dio)?\s*(\d+)/i) || [null, index + 1];
                                        videos.push({
                                            id: `xlv:${lIdx}:${encodeURIComponent(ep.cmd)}:${encodeURIComponent(epTitle)}`,
                                            title: epTitle,
                                            season: sMatch ? parseInt(sMatch[0]) : 1,
                                            episode: parseInt(eMatch[1])
                                        });
                                    }
                                });
                            }
                        } else {
                            files.forEach((ep, index) => {
                                const epTitle = ep.name || ep.title || `Episódio ${index + 1}`;
                                videos.push({
                                    id: `xlv:${lIdx}:${encodeURIComponent(ep.cmd)}:${encodeURIComponent(epTitle)}`,
                                    title: epTitle, season: 1, episode: index + 1
                                });
                            });
                        }
                        meta.videos = videos;
                    } catch (e) { }
                }
            } else if (config && config.type === 'xtream') {
                // Lógica Xtream mantida igual
                const b = config.url.trim().replace(/\/$/, "");
                const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}&action=get_series_info&series_id=${sId}`;
                const res = await axios.get(api, addon.getAxiosOpts(config, { timeout: 10000 }));
                const episodes = res.data?.episodes || {};
                let videos = [];
                Object.keys(episodes).forEach(s => {
                    episodes[s].forEach(ep => {
                        videos.push({
                            id: `xlv:${lIdx}:${ep.id}.${ep.container_extension || 'mp4'}:${encodeURIComponent(ep.title || name)}`,
                            title: ep.title || `S${s} E${ep.episode_num}`,
                            season: parseInt(s), episode: parseInt(ep.episode_num)
                        });
                    });
                });
                meta.videos = videos;
            }
        }
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const name = decodeURIComponent(parts[3] || "Stream");
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;

        if (type === 'movie' || type === 'series') {
            return { streams: [{ name: name, url: pUrl, title: `🎬 Reproduzir`, behaviorHints: { notWebReady: true } }] };
        }
        return { streams: [{ name: name, url: pUrl, title: `🔄 Proxy Estável`, behaviorHints: { notWebReady: true } }] };
    }
};

module.exports = addon;
