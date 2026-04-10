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

// GERAÇÃO DE PERFIL MAG PROFISSIONAL
const getStalkerAuth = function(config, token) {
    const mac = (config.mac || "").toUpperCase();
    const seed = crypto.createHash('md5').update(mac || 'vazio').digest('hex').toUpperCase();
    const sn  = config.sn  || seed.substring(0, 14); 
    const id1 = config.id1 || seed; 
    const id2 = config.id2 || seed;
    const sig = config.sig || "";
    const model = config.model || "MAG254";
    
    // Rotação de User-Agents para evitar Fingerprinting
    const ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 272 Safari/533.3";
    const xua = `Model: ${model}; SW: 0.2.18-r14; Device ID: ${id1}; Device ID 2: ${id2}; Signature: ${sig}`;
    
    let cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`;
    if (token) cookie += ` access_token=${token};`;

    return { sn, id1, headers: { 
        "User-Agent": ua, "X-User-Agent": xua, "Cookie": cookie, 
        "Accept": "*/*", "Referer": config.url.replace(/\/$/, "") + "/c/",
        "Connection": "Keep-Alive", "X-Runtime": Date.now().toString()
    }};
};

const addon = {
    getAxiosOpts(config, extraOpts = {}) {
        let opts = { ...extraOpts };
        if (config?.proxy?.startsWith('socks')) {
            const agent = new SocksProxyAgent(config.proxy);
            opts.httpAgent = agent; opts.httpsAgent = agent;
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
        const cacheKey = `auth_${config.url}_${config.mac}`;
        const cached = getCache(cacheKey);
        if (cached) return cached;

        const authData = getStalkerAuth(config, null);
        let baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const api = baseUrl + "portal.php";

        try {
            // HANDSHAKE INTELIGENTE
            const hUrl = `${api}?type=stb&action=handshake&sn=${authData.sn}&device_id=${authData.id1}&JsHttpRequest=1-0`;
            const res = await axios.get(hUrl, this.getAxiosOpts(config, { headers: authData.headers, timeout: 5000 }));
            const token = res.data?.js?.token || res.data?.token;

            if (token) {
                // PROFILE LOAD (Enganar o servidor que somos uma BOX ativa)
                const pUrl = `${api}?type=stb&action=get_profile&sn=${authData.sn}&stb_type=MAG254&device_id=${authData.id1}&token=${token}&JsHttpRequest=1-0`;
                await axios.get(pUrl, this.getAxiosOpts(config, { headers: getStalkerAuth(config, token).headers }));
                
                const finalAuth = { token, api: api + "?", authData: getStalkerAuth(config, token) };
                setCache(cacheKey, finalAuth, 60);
                return finalAuth;
            }
        } catch (e) { console.error("Auth Fail:", e.message); }
        return null;
    },

    async getManifest(configBase64) {
        return { 
            id: "org.xulov.stalker.v1100", version: "11.0.0", 
            name: "XuloV Hub ULTRA", 
            resources: ["catalog", "stream", "meta"], 
            types: ["tv", "movie", "series"], 
            idPrefixes: ["xlv1100:"],
            catalogs: this.parseConfig(configBase64).map((l, i) => ([
                { type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}` },
                { type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬` },
                { type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿` }
            ])).flat()
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const lIdx = parseInt(id.split('_')[1]);
        const config = this.parseConfig(configBase64)[lIdx];
        const auth = await this.authenticate(config);
        if (!auth) return { metas: [] };

        try {
            const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
            const page = Math.floor((parseInt(extra.skip) || 0) / 14) + 1;
            const url = `${auth.api}type=${sType}&action=get_ordered_list&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers }));
            const raw = res.data?.js?.data || res.data?.js || [];
            
            return { metas: (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                id: `xlv1100:${lIdx}:${encodeURIComponent(m.id || m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
                name: m.name || m.title, type, 
                poster: m.logo || m.screenshot_uri, 
                posterShape: type === "tv" ? "landscape" : "poster"
            }))};
        } catch (e) { return { metas: [] }; }
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":");
        const lIdx = parseInt(parts[1]);
        const sId = decodeURIComponent(parts[2]);
        const mainName = decodeURIComponent(parts[3] || "Série");
        let meta = { id, type, name: mainName, posterShape: "poster", videos: [] };

        if (type === "series") {
            const config = this.parseConfig(configBase64)[lIdx];
            const auth = await this.authenticate(config);
            if (!auth) return { meta };

            try {
                const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const opts = this.getAxiosOpts(config, { headers: auth.authData.headers });
                
                // 1. EXTRAÇÃO DE TEMPORADAS COM SCAN DE ID
                const rSeasons = await axios.get(`${apiBase}&type=series&action=get_ordered_list&movie_id=${sId.split(':')[0]}`, opts);
                const seasons = Object.values(rSeasons.data?.js?.data || rSeasons.data?.js || {});

                for (const s of seasons) {
                    const sNum = parseInt((s.name || "").match(/\d+/)?.[0] || 1);
                    const folderId = s.id || s.cmd;
                    
                    // 2. SCAN AGRESSIVO DE EPISÓDIOS (FORÇANDO PAGINAÇÃO)
                    let foundAny = false;
                    for (let p = 1; p <= 5; p++) {
                        const rEps = await axios.get(`${apiBase}&type=series&action=get_ordered_list&movie_id=${encodeURIComponent(folderId)}&p=${p}`, opts);
                        const eps = Object.values(rEps.data?.js?.data || rEps.data?.js || {});
                        
                        // Detetar se o servidor está a repetir a pasta (Bloqueio de Navegação)
                        if (eps.length === 0 || (eps[0] && eps[0].id === s.id)) break;

                        eps.forEach((ep, idx) => {
                            foundAny = true;
                            meta.videos.push({
                                id: `xlv1100:${lIdx}:${encodeURIComponent(ep.cmd || ep.id)}:${sNum}:${meta.videos.length + 1}`,
                                title: ep.name || ep.title || `Episódio ${meta.videos.length + 1}`,
                                season: sNum, episode: meta.videos.length + 1
                            });
                        });
                        if (eps.length < 5) break;
                    }

                    // 3. ULTIMA TENTATIVA: Se a pasta parece vazia, mas tem um CMD, o episódio é o próprio item
                    if (!foundAny && (s.cmd || s.id)) {
                        meta.videos.push({
                            id: `xlv1100:${lIdx}:${encodeURIComponent(s.cmd || s.id)}:${sNum}:1`,
                            title: s.name || s.title, season: sNum, episode: 1
                        });
                    }
                }
            } catch (e) { console.error("Meta Scan Error:", e.message); }
        }
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":");
        const lIdx = parseInt(parts[1]);
        const cmd = decodeURIComponent(parts[2]);
        const config = this.parseConfig(configBase64)[lIdx];
        const auth = await this.authenticate(config);
        if (!auth) return { streams: [] };

        const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 8000 });
        let streams = [];

        // SNIPER DE STREAM: Tenta itv e series em paralelo
        const targetTypes = ['itv', 'series', 'vod'];
        for (const t of targetTypes) {
            try {
                const url = `${auth.api}type=${t}&action=create_link&cmd=${encodeURIComponent(cmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, opts);
                const data = res.data?.js || res.data;
                
                let link = data.cmd || data.url || (typeof data === 'string' && data.includes('://') ? data : null);
                if (link && typeof link === 'string' && link.includes('://')) {
                    const finalUrl = link.replace(/^(ffrt|ffmpeg)\s+/, "").trim();
                    streams.push({ 
                        name: `⚡ Link Direto (${t.toUpperCase()})`, 
                        url: finalUrl,
                        behaviorHints: { notWebReady: true }
                    });
                    break; 
                }
            } catch(e) {}
        }

        // PROXY DE EMERGÊNCIA (Caso o ISP bloqueie o IP direto)
        streams.push({ 
            name: "🔄 Rota de Proteção (Proxy)", 
            url: `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(cmd)}?type=itv`,
            behaviorHints: { notWebReady: true } 
        });
        
        return { streams };
    }
};

module.exports = addon;
