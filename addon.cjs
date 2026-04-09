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
    let ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
    let xua = `Model: ${model}; SW: 0.2.18-r14; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;
    let cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`;
    if (token) cookie += ` access_token=${token};`;
    return { sn, id1, sig, headers: { "User-Agent": ua, "X-User-Agent": xua, "Cookie": cookie, "Referer": config.url.replace(/\/$/, "") + "/c/", "Accept": "*/*" } };
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
            const res = await axios.get(hUrl, this.getAxiosOpts(config, { headers: authData.headers, timeout: 10000 }));
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
        let catalogs = [];
        lists.forEach((l, i) => {
            catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}` });
            catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬` });
            catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿` });
        });
        return { 
            id: "org.xulov.stalker.v610", 
            version: "6.1.0", 
            name: "XuloV Hub PRO", 
            resources: ["catalog", "stream", "meta"], 
            types: ["tv", "movie", "series"], 
            idPrefixes: ["xlv101:"], 
            catalogs 
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx]; if (!config) return { metas: [] };
        const skip = parseInt(extra.skip) || 0;
        let metas = [];
        try {
            const auth = await addon.authenticate(config);
            if (auth) {
                const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                const page = Math.floor(skip / 14) + 1;
                const url = `${auth.api}type=${sType}&action=get_ordered_list&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                const raw = res.data?.js?.data || res.data?.js || [];
                metas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                    id: `xlv101:${lIdx}:${encodeURIComponent(m.id || m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
                    name: m.name || m.title, type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                }));
            }
        } catch (e) {}
        return { metas };
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":");
        const lIdx = parseInt(parts[1]);
        const sId = decodeURIComponent(parts[2]);
        const mainName = decodeURIComponent(parts[3] || "Série");
        let meta = { id, type, name: mainName, posterShape: "poster", videos: [] };

        if (type === "series") {
            const lists = this.parseConfig(configBase64);
            const config = lists[lIdx];
            if (!config) return { meta };

            try {
                const auth = await addon.authenticate(config);
                if (auth) {
                    const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 });

                    let rRoot = await axios.get(`${apiBase}&type=series&action=get_ordered_list&movie_id=${sId}`, opts);
                    let seasons = Object.values(rRoot.data?.js?.data || rRoot.data?.js || {});

                    for (let sFolder of seasons) {
                        let sName = (sFolder.name || "").toLowerCase();
                        if (sName.includes('season') || sFolder.is_dir == 1) {
                            let sNum = 1;
                            let m = sName.match(/season\s*(\d+)/i);
                            if (m) sNum = parseInt(m[1]);

                            let folderId = sFolder.id || sFolder.cmd || sId;
                            
                            // HIDRATAÇÃO 2.0: Detetamos se os episódios são apenas números
                            let epsArray = [];
                            if (sFolder.series && Array.isArray(sFolder.series)) {
                                sFolder.series.forEach((val, idx) => {
                                    let isObj = typeof val === 'object';
                                    let epId = isObj ? (val.id || val.cmd) : val;
                                    let epTitle = isObj ? (val.name || val.title) : `Episódio ${val}`;
                                    let epNum = isObj ? (val.episode_number || idx + 1) : val;

                                    meta.videos.push({
                                        id: `xlv101:${lIdx}:${encodeURIComponent(folderId)}:${encodeURIComponent(epId)}:${encodeURIComponent(epTitle)}`,
                                        title: epTitle, season: sNum, episode: parseInt(epNum)
                                    });
                                });
                            }
                        }
                    }
                }
            } catch (e) {}
        }
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        console.log(`[STALKER] --- INFILTRATOR MODE (v6.1.0) ---`);
        const parts = id.split(":"); 
        const lIdx = parseInt(parts[1]); 
        const folderId = decodeURIComponent(parts[2]);
        const targetEpId = decodeURIComponent(parts[3]);
        const name = decodeURIComponent(parts[4] || "Stream");
        
        const lists = this.parseConfig(configBase64); 
        const config = lists[lIdx];
        let streams = [];

        try {
            const auth = await addon.authenticate(config);
            if (auth) {
                const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 });
                
                // PASSO 1: Descobrir o CMD real do episódio
                console.log(`[STALKER] Buscando CMD real na pasta: ${folderId}`);
                const listUrl = `${auth.api}type=series&action=get_ordered_list&movie_id=${folderId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const resList = await axios.get(listUrl, opts);
                const items = resList.data?.js?.data || resList.data?.js || [];
                
                let finalCmd = targetEpId; // Default
                const found = (Array.isArray(items) ? items : Object.values(items)).find(i => 
                    i.id == targetEpId || i.cmd == targetEpId || i.episode_number == targetEpId
                );

                if (found && found.cmd) {
                    finalCmd = found.cmd;
                    console.log(`[STALKER] CMD REAL ENCONTRADO: ${finalCmd}`);
                }

                // PASSO 2: Pedir o link com o CMD limpo
                const playUrl = `${auth.api}type=vod&action=create_link&cmd=${encodeURIComponent(finalCmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                console.log(`[STALKER] Pedindo link final para: ${finalCmd}`);
                
                const resPlay = await axios.get(playUrl, opts);
                let streamUrl = resPlay.data?.js?.cmd || resPlay.data?.js?.url || resPlay.data?.js;

                if (typeof streamUrl === 'string' && streamUrl.includes('://')) {
                    streams.push({ 
                        name: "⚡ Directo", 
                        url: streamUrl.replace(/^(ffrt|ffmpeg)\s+/, "").trim(), 
                        behaviorHints: { notWebReady: true } 
                    });
                }
            }
        } catch(e) { console.log(`[STALKER] Erro:`, e.message); }

        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(targetEpId)}?type=${type}`;
        streams.push({ name: "🔄 Proxy Hub", url: pUrl, behaviorHints: { notWebReady: true } });
        
        return { streams };
    }
};

module.exports = addon;
