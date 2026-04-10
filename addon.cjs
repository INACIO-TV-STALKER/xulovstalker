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
    const model = config.model || "MAG254";
    let ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 272 Safari/533.3";
    let xua = `Model: ${model}; SW: 0.2.18-r14; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;
    let cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`;
    if (token) cookie += ` access_token=${token};`;
    return { sn, id1, sig, headers: { 
        "User-Agent": ua, "X-User-Agent": xua, "Cookie": cookie, 
        "Referer": config.url.replace(/\/$/, "") + "/c/", "Accept": "*/*", "Connection": "Keep-Alive"
    }};
};

const addon = {
    getAxiosOpts(config, extraOpts = {}) {
        let opts = { ...extraOpts };
        if (config?.proxy) {
            const proxyStr = config.proxy.trim();
            if (proxyStr.startsWith('socks')) {
                const agent = new SocksProxyAgent(proxyStr);
                opts.httpAgent = agent; opts.httpsAgent = agent;
            } else if (proxyStr.startsWith('http')) {
                try {
                    const p = new URL(proxyStr);
                    opts.proxy = { protocol: p.protocol.replace(':', ''), host: p.hostname, port: parseInt(p.port), auth: p.username ? { username: decodeURIComponent(p.username), password: decodeURIComponent(p.password) } : undefined };
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
        const cacheKey = `auth_${config.url}_${config.mac || 'nomac'}`;
        const cachedAuth = getCache(cacheKey);
        if (cachedAuth) return cachedAuth;
        const authData = getStalkerAuth(config, null);
        let baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const url = baseUrl + "portal.php";
        try {
            const hUrl = `${url}?type=stb&action=handshake&sn=${authData.sn}&device_id=${authData.id1}&JsHttpRequest=1-0`;
            const res = await axios.get(hUrl, this.getAxiosOpts(config, { headers: authData.headers, timeout: 5000 }));
            const token = res.data?.js?.token || res.data?.token || null;
            if (token) {
                const finalAuth = { token, api: url + "?", authData: getStalkerAuth(config, token) };
                setCache(cacheKey, finalAuth, 60);
                return finalAuth;
            }
        } catch (e) {}
        return null;
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        let catalogs = lists.map((l, i) => ([
            { type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}` },
            { type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬` },
            { type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿` }
        ])).flat();
        return { 
            id: "org.xulov.stalker.v710", version: "7.1.0", 
            name: "XuloV Hub PRO", 
            resources: ["catalog", "stream", "meta"], 
            types: ["tv", "movie", "series"], 
            idPrefixes: ["xlv710:"], catalogs 
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx]; if (!config) return { metas: [] };
        try {
            const auth = await addon.authenticate(config);
            if (auth) {
                const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                const page = Math.floor((parseInt(extra.skip) || 0) / 14) + 1;
                const url = `${auth.api}type=${sType}&action=get_ordered_list&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers }));
                const raw = res.data?.js?.data || res.data?.js || [];
                return { metas: (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                    id: `xlv710:${lIdx}:${encodeURIComponent(m.id || m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
                    name: m.name || m.title, type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                }))};
            }
        } catch (e) {}
        return { metas: [] };
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":");
        const lIdx = parseInt(parts[1]);
        const sId = decodeURIComponent(parts[2]);
        const mainName = decodeURIComponent(parts[3] || "Série");
        let meta = { id, type, name: mainName, posterShape: "poster", videos: [] };

        if (type === "series") {
            const config = this.parseConfig(configBase64)[lIdx];
            const auth = await addon.authenticate(config);
            if (auth) {
                try {
                    const opts = this.getAxiosOpts(config, { headers: auth.authData.headers });
                    const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    
                    const rSeasons = await axios.get(`${apiBase}&type=series&action=get_ordered_list&movie_id=${sId}`, opts);
                    const seasons = Object.values(rSeasons.data?.js?.data || rSeasons.data?.js || {});

                    for (const s of seasons) {
                        const sNum = parseInt((s.name || "").match(/\d+/)?.[0] || 1);
                        const seasonId = s.id || s.cmd;
                        
                        const rEps = await axios.get(`${apiBase}&type=series&action=get_ordered_list&movie_id=${seasonId}`, opts);
                        let eps = Object.values(rEps.data?.js?.data || rEps.data?.js || []);

                        eps.forEach((ep, idx) => {
                            const finalCmd = ep.cmd || ep.id;
                            if (finalCmd) {
                                meta.videos.push({
                                    id: `xlv710:${lIdx}:${encodeURIComponent(finalCmd)}:${sNum}:${idx + 1}`,
                                    title: ep.name || `Episódio ${idx + 1}`,
                                    season: sNum, episode: idx + 1
                                });
                            }
                        });
                    }
                } catch (e) {}
            }
        }
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":");
        const lIdx = parseInt(parts[1]);
        const cmd = decodeURIComponent(parts[2]);
        
        const config = this.parseConfig(configBase64)[lIdx];
        let streams = [];
        let successType = 'itv'; // Vamos diretos ao "segredo" que o teu log revelou!

        try {
            const auth = await addon.authenticate(config);
            if (auth) {
                const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 });
                
                // Coloquei o ITV em primeiro lugar porque sabemos que é o que o teu servidor quer
                const probes = [
                    { t: 'itv', q: `&cmd=${encodeURIComponent(cmd)}` },
                    { t: 'vod', q: `&cmd=${encodeURIComponent(cmd)}` },
                    { t: 'series', q: `&cmd=${encodeURIComponent(cmd)}` }
                ];

                for (let probe of probes) {
                    try {
                        const url = `${auth.api}type=${probe.t}&action=create_link${probe.q}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        const res = await axios.get(url, opts);
                        const data = res.data?.js || res.data;
                        
                        let link = data.cmd || data.url || (typeof data === 'string' && data.includes('://') ? data : null);
                        
                        if (link && typeof link === 'string' && link.includes('://')) {
                            successType = probe.t; // Captura o tipo exato que o servidor aceitou
                            const cleanLink = link.replace(/^(ffrt|ffmpeg)\s+/, "").trim();
                            
                            // 1. O Proxy Hub AGORA USA O TIPO CORRETO DINAMICAMENTE (Foi isto que faltou antes!)
                            streams.push({ 
                                name: `🔄 Proxy Hub (${probe.t.toUpperCase()})`, 
                                url: `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(cmd)}?type=${successType}`,
                                behaviorHints: { notWebReady: true } 
                            });

                            // 2. Link Direto caso o Stremio não precise de User-Agent neste server
                            streams.push({ 
                                name: `⚡ Directo`, 
                                url: cleanLink,
                                behaviorHints: { notWebReady: true }
                            });
                            
                            break; 
                        }
                    } catch(e) {}
                }
            }
        } catch(e) {}

        // Fallback de segurança caso a API engasgue
        if (streams.length === 0) {
            streams.push({ 
                name: "🔄 Proxy Fallback", 
                url: `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(cmd)}?type=${successType}`,
                behaviorHints: { notWebReady: true } 
            });
        }
        
        return { streams };
    }
};

module.exports = addon;
