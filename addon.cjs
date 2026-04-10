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
            id: "org.xulov.stalker.v900", version: "9.0.0", 
            name: "XuloV Hub PRO", 
            resources: ["catalog", "stream", "meta"], 
            types: ["tv", "movie", "series"], 
            idPrefixes: ["xlv900:"], catalogs 
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
                    id: `xlv900:${lIdx}:${encodeURIComponent(m.id || m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
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
            if (!auth) return { meta };

            try {
                const opts = this.getAxiosOpts(config, { headers: auth.authData.headers });
                const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                
                // 1. Obter primeira camada (Temporadas)
                const rSeasons = await axios.get(`${apiBase}&type=series&action=get_ordered_list&movie_id=${sId.split(':')[0]}`, opts);
                const firstLevelRaw = rSeasons.data?.js?.data || rSeasons.data?.js || [];
                const firstLevel = Array.isArray(firstLevelRaw) ? firstLevelRaw : Object.values(firstLevelRaw);

                for (const item of firstLevel) {
                    const sNumMatch = (item.name || "").match(/\d+/);
                    const sNum = sNumMatch ? parseInt(sNumMatch[0]) : 1;
                    const folderId = item.id || item.cmd;
                    let seasonVideos = [];

                    // 2. Extrair Episódios com Codificação Absoluta de URL
                    for (let p = 1; p <= 10; p++) {
                        const rEps = await axios.get(`${apiBase}&type=series&action=get_ordered_list&movie_id=${encodeURIComponent(folderId)}&p=${p}`, opts);
                        const epsRaw = rEps.data?.js?.data || rEps.data?.js || [];
                        const eps = Array.isArray(epsRaw) ? epsRaw : Object.values(epsRaw);
                        
                        if (eps.length === 0) break;
                        
                        // Proteção extrema: Se o servidor devolver as temporadas outra vez, sabemos que não tem pastas e este 'item' é o episódio!
                        if (eps.length > 0 && firstLevel.length > 0 && (eps[0].id === firstLevel[0].id || eps[0].cmd === firstLevel[0].cmd)) {
                            break; 
                        }

                        eps.forEach((ep) => {
                            const finalCmd = ep.cmd || ep.id;
                            if (finalCmd) {
                                let cleanTitle = ep.name || ep.title || "";
                                if (cleanTitle.toLowerCase().includes("season") || cleanTitle === "") {
                                    cleanTitle = `Episódio ${seasonVideos.length + 1}`;
                                }
                                seasonVideos.push({
                                    id: `xlv900:${lIdx}:${encodeURIComponent(finalCmd)}:${sNum}:${seasonVideos.length + 1}`,
                                    title: cleanTitle, season: sNum, episode: seasonVideos.length + 1
                                });
                            }
                        });
                        if (eps.length < 10) break; 
                    }

                    // Se não extraiu nada de dentro da pasta, o 'item' original era logo o episódio
                    if (seasonVideos.length === 0) {
                        meta.videos.push({
                            id: `xlv900:${lIdx}:${encodeURIComponent(folderId)}:${sNum}:${meta.videos.length + 1}`,
                            title: item.name || item.title || `Episódio ${meta.videos.length + 1}`,
                            season: sNum, episode: meta.videos.length + 1
                        });
                    } else {
                        meta.videos.push(...seasonVideos);
                    }
                }
            } catch (e) { console.log("[META ERROR]", e.message); }
        }
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":");
        const lIdx = parseInt(parts[1]);
        const cmd = decodeURIComponent(parts[2]);
        const config = this.parseConfig(configBase64)[lIdx];
        let streams = [];

        const auth = await addon.authenticate(config);
        if (auth) {
            const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 6000 });
            
            // PRIORIDADE ITV (Confirmado pelos logs)
            const typesToTry = ['itv', 'series', 'vod'];
            for (let t of typesToTry) {
                try {
                    const url = `${auth.api}type=${t}&action=create_link&cmd=${encodeURIComponent(cmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const res = await axios.get(url, opts);
                    const data = res.data?.js || res.data;
                    console.log(`[PLAY-LOG] Tentando ${t}:`, JSON.stringify(data).substring(0, 100));

                    let link = data.cmd || data.url || (typeof data === 'string' && data.includes('://') ? data : null);
                    if (link && typeof link === 'string' && link.includes('://')) {
                        streams.push({ 
                            name: "⚡ Directo MAG PRO", 
                            url: link.replace(/^(ffrt|ffmpeg)\s+/, "").trim(),
                            behaviorHints: { notWebReady: true }
                        });
                        break; 
                    }
                } catch(e) {}
            }
        }

        streams.push({ 
            name: "🔄 Proxy Hub", 
            url: `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(cmd)}?type=series`,
            behaviorHints: { notWebReady: true } 
        });
        
        return { streams };
    }
};

module.exports = addon;
