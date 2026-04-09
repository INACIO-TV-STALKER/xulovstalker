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
        case "MAG256":
            ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 27211 Safari/533.3";
            xua = `Model: MAG256; SW: 2.20.05-256; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;
            break;
        default: 
            ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
            xua = `Model: MAG250; SW: 0.2.18-r14; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;
    }

    let cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`;
    if (token) cookie += ` access_token=${token};`;

    return {
        sn: sn,
        id1: id1,
        sig: sig,
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
                opts.httpAgent = agent;
                opts.httpsAgent = agent;
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
            const data = JSON.parse(decoded);
            return data.lists || []; 
        } 
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
            var res = await axios.get(hUrl, this.getAxiosOpts(config, { headers: authData.headers, timeout: 10000 }));
            var token = res.data?.js?.token || res.data?.token || null;
            if (token) {
                const finalAuth = { token: token, api: url + "?", authData: getStalkerAuth(config, token) };
                setCache(cacheKey, finalAuth, 60);
                return finalAuth;
            }
            return null;
        } catch (e) { 
            console.error("[AUTH ERROR]", e.message);
            return null; 
        }
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
                    const f = async (a) => { const r = await axios.get(`${api}&action=${a}`, this.getAxiosOpts(l, { timeout: 5000 })); return Array.isArray(r.data) ? r.data.map(g => g.category_name) : []; };
                    const [c1, c2, c3] = await Promise.all([f('get_live_categories'), f('get_vod_categories'), f('get_series_categories')]);
                    tvG = tvG.concat(c1); movG = movG.concat(c2); serG = serG.concat(c3);
                } else {
                    const auth = await addon.authenticate(l);
                    if (auth) {
                        const fetchSt = async (t, a) => {
                            const r = await axios.get(`${auth.api}type=${t}&action=${a}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(l, { headers: auth.authData.headers, timeout: 5000 }));
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
        const m = { id: "org.xulov.stalker", version: "5.4.0", name: "XuloV Hub", resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
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
                    const cRes = await axios.get(`${api}&action=${cAct}`, this.getAxiosOpts(config, {timeout: 5000}));
                    const cat = (cRes.data || []).find(c => c.category_name === extra.genre);
                    if (cat) act += `&category_id=${cat.category_id}`;
                }
                const res = await axios.get(`${api}&action=${act}`, this.getAxiosOpts(config, {timeout: 10000}));
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
                        const cRes = await axios.get(`${auth.api}type=${sType}&action=get_categories&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 }));
                        const cats = cRes.data?.js?.data || cRes.data?.js || [];
                        const cat = (Array.isArray(cats) ? cats : Object.values(cats)).find(c => (c.title || c.name) === extra.genre);
                        if (cat) catP = sType === "itv" ? `&genre=${cat.id}` : `&category=${cat.id}`;
                    }
                    const page = Math.floor(skip / 14) + 1;
                    const url = `${auth.api}type=${sType}&action=get_ordered_list${catP}&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                    const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                    const raw = res.data?.js?.data || res.data?.js || [];
                    metas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                        id: `xlv:${lIdx}:${encodeURIComponent(m.id || m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                    }));
                }
            }
        } catch (e) {}
        return { metas };
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":");
        const lIdx = parseInt(parts[1]);
        const sId = decodeURIComponent(parts[2]);
        const name = decodeURIComponent(parts[3] || "Série");
        let meta = { id, type, name, posterShape: "poster", videos: [] };

        if (type === "series") {
            const lists = this.parseConfig(configBase64);
            const config = lists[lIdx];
            if (!config) return { meta };

            try {
                if (config.type === 'xtream') {
                    const b = config.url.trim().replace(/\/$/, "");
                    const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                    const res = await axios.get(`${api}&action=get_series_info&series_id=${sId}`, this.getAxiosOpts(config, { timeout: 10000 }));
                    if (res.data && res.data.episodes) {
                        Object.keys(res.data.episodes).forEach(sNum => {
                            res.data.episodes[sNum].forEach(ep => {
                                meta.videos.push({
                                    id: `xlv:${lIdx}:${ep.id}.${ep.container_extension || 'mp4'}:${encodeURIComponent(ep.title || 'Ep')}`,
                                    title: ep.title || `Episódio ${ep.episode_num || 1}`,
                                    season: parseInt(sNum) || 1, episode: parseInt(ep.episode_num) || 1
                                });
                            });
                        });
                    }
                } else {
                    const auth = await addon.authenticate(config);
                    if (auth) {
                        const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 });

                        // FUNÇÃO DE BUSCA AGRESSIVA
                        const discoverEpisodes = async (id) => {
                            const paths = [
                                { t: 'series', a: 'get_ordered_list', p: 'category' },
                                { t: 'vod', a: 'get_ordered_list', p: 'category' },
                                { t: 'series', a: 'get_ordered_list', p: 'movie_id' },
                                { t: 'vod', a: 'get_ordered_list', p: 'movie_id' },
                                { t: 'series', a: 'get_ordered_list', p: 'season_id' }
                            ];
                            for (let path of paths) {
                                try {
                                    const r = await axios.get(`${apiBase}&type=${path.t}&action=${path.a}&${path.p}=${id}&v_type=series`, opts);
                                    const data = r.data?.js?.data || r.data?.js || [];
                                    const items = Array.isArray(data) ? data : Object.values(data);
                                    if (items.length > 0 && items[0].id) return items;
                                } catch(e) {}
                            }
                            return [];
                        };

                        const processItems = async (items, depth = 0) => {
                            if (depth > 2) return;
                            for (let item of items) {
                                if (item.is_dir == 1 || item.is_dir === "1") {
                                    const sub = await discoverEpisodes(item.id);
                                    await processItems(sub, depth + 1);
                                } else {
                                    const sNum = parseInt(item.season_number) || 1;
                                    const eNum = parseInt(item.episode_number) || meta.videos.length + 1;
                                    meta.videos.push({
                                        id: `xlv:${lIdx}:${encodeURIComponent(item.cmd || item.id)}:${encodeURIComponent(item.name || item.title)}`,
                                        title: item.name || item.title || `Episódio ${eNum}`,
                                        season: sNum, episode: eNum
                                    });
                                }
                            }
                        };

                        let found = await discoverEpisodes(sId);
                        if (found.length === 0) {
                            // TENTATIVA FINAL: Ver se os episódios estão dentro do video_info
                            try {
                                const rInfo = await axios.get(`${apiBase}&type=vod&action=get_video_info&video_id=${sId}`, opts);
                                const vInfo = rInfo.data?.js?.data || rInfo.data?.js || {};
                                if (vInfo.series && Array.isArray(vInfo.series)) {
                                    vInfo.series.forEach((ep, i) => {
                                        meta.videos.push({
                                            id: `xlv:${lIdx}:${encodeURIComponent(ep.cmd || sId + '|' + (i+1))}:${encodeURIComponent(ep.name || 'Ep ' + (i+1))}`,
                                            title: ep.name || `Episódio ${i+1}`,
                                            season: 1, episode: i + 1
                                        });
                                    });
                                }
                            } catch(e) {}
                        } else {
                            await processItems(found);
                        }
                    }
                }
            } catch (e) { console.log("[META ERROR]", e.message); }
            
            if (meta.videos.length === 0) {
                meta.videos.push({ id: `xlv:${lIdx}:empty:empty`, title: "Sem episódios no servidor", season: 1, episode: 1 });
            }
        }
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const name = decodeURIComponent(parts[3] || "Stream");
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;
        let streams = [];

        if (config?.type === 'xtream') {
            const b = config.url.trim().replace(/\/$/, "");
            const route = type === 'tv' ? '' : (type === 'movie' ? 'movie/' : 'series/');
            streams.push({ name: name, url: `${b}/${route}${config.user}/${config.pass}/${sId}`, title: `⚡ Directo`, behaviorHints: { notWebReady: true } });
        } else {
            try {
                const auth = await addon.authenticate(config);
                if (auth) {
                    const decoded = decodeURIComponent(sId);
                    let cmd = decoded; let epNum = "";
                    if (decoded.includes('|')) { [cmd, epNum] = decoded.split('|'); }
                    const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 });
                    const linkUrl = `${auth.api}type=vod&action=create_link&cmd=${encodeURIComponent(cmd)}${epNum ? '&series=' + epNum : ''}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const res = await axios.get(linkUrl, opts);
                    const cmdUrl = res.data?.js?.cmd || res.data?.js?.url || res.data?.js;
                    if (typeof cmdUrl === 'string' && cmdUrl.includes('://')) {
                        streams.push({ name: name, url: cmdUrl.replace(/^(ffrt|ffmpeg)\s+/, "").trim(), title: `⚡ Directo`, behaviorHints: { notWebReady: true } });
                    }
                }
            } catch(e) {}
        }
        streams.push({ name: name, url: pUrl, title: `🔄 Proxy`, behaviorHints: { notWebReady: true } });
        return { streams };
    }
};

module.exports = addon;
