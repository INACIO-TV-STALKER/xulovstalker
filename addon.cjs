const axios = require("axios");
const crypto = require("crypto");
const { SocksProxyAgent } = require('socks-proxy-agent');
const http = require('http');
const https = require('https');

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

    return { sn, id1, sig, headers: { "User-Agent": ua, "X-User-Agent": xua, "Cookie": cookie, "Referer": config.url.replace(/\/$/, "") + "/c/", "Accept": "*/*", "Connection": "keep-alive" } };
};

const addon = {
    getAxiosOpts(config, extraOpts = {}) {
        let opts = { ...extraOpts, httpAgent: httpAgent, httpsAgent: httpsAgent, timeout: extraOpts.timeout || 10000 };
        if (config && config.proxy) {
            const proxyStr = config.proxy.trim();
            if (proxyStr.startsWith('socks')) {
                if (!agentCache[proxyStr]) agentCache[proxyStr] = new SocksProxyAgent(proxyStr, { keepAlive: true });
                opts.httpAgent = agentCache[proxyStr]; opts.httpsAgent = agentCache[proxyStr];
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
        const cacheKey = `parsed_${configBase64}`;
        const cached = getCache(cacheKey); if (cached) return cached;
        try { 
            const decoded = Buffer.from(decodeURIComponent(configBase64), 'base64').toString('utf8');
            const data = JSON.parse(decoded); const res = data.lists || [];
            setCache(cacheKey, res, 60); return res;
        } catch (e) { return []; }
    },

    async authenticate(config) {
        if (config.type === 'xtream') return true;
        const cacheKey = `auth_${config.url}_${config.mac || 'nomac'}`;
        const cachedAuth = getCache(cacheKey); if (cachedAuth) return cachedAuth;
        const authData = getStalkerAuth(config, null);
        let baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const url = baseUrl + "portal.php";
        try {
            const hUrl = `${url}?type=stb&action=handshake&sn=${authData.sn}&device_id=${authData.id1}&JsHttpRequest=1-0`;
            const res = await axios.get(hUrl, this.getAxiosOpts(config));
            const token = res.data?.js?.token || res.data?.token || null;
            if (token) {
                const finalAuth = { token: token, api: url + "?", authData: getStalkerAuth(config, token) };
                setCache(cacheKey, finalAuth, 50); return finalAuth;
            }
            return null;
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        const catalogs = [];

        // Recuperar as categorias/géneros para cada lista
        for (let i = 0; i < lists.length; i++) {
            const l = lists[i];
            const name = l.name || `Lista ${i + 1}`;
            
            // Adicionamos os catálogos com suporte a "genre" (categorias)
            catalogs.push({ type: "tv", id: `cat_${i}`, name: name, extra: [{ name: "genre" }, { name: "skip" }] });
            catalogs.push({ type: "movie", id: `mov_${i}`, name: `${name} 🎬`, extra: [{ name: "genre" }, { name: "skip" }] });
            catalogs.push({ type: "series", id: `ser_${i}`, name: `${name} 🍿`, extra: [{ name: "genre" }, { name: "skip" }] });
        }

        return { 
            id: "org.xulov.stalker", 
            version: "5.4.4", 
            name: "XuloV Ultra Fast", 
            resources: ["catalog", "stream", "meta"], 
            types: ["tv", "movie", "series"], 
            idPrefixes: ["xlv:"], 
            catalogs 
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const skip = parseInt(extra.skip) || 0;
        const genre = extra.genre;
        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx]; if (!config) return { metas: [] };
        
        let metas = [];
        try {
            if (config.type === 'xtream') {
                const b = config.url.trim().replace(/\/$/, "");
                const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                
                // Se o utilizador abriu o catálogo mas ainda não escolheu género, podemos mostrar as categorias como "Genres"
                if (!genre) {
                    let catAct = type === "tv" ? "get_live_categories" : (type === "movie" ? "get_vod_categories" : "get_series_categories");
                    const catRes = await axios.get(`${api}&action=${catAct}`, this.getAxiosOpts(config));
                    const categories = Array.isArray(catRes.data) ? catRes.data : [];
                    
                    // Nota: O Stremio carrega os géneros no manifest. Para rapidez, aqui carregamos o conteúdo global ou filtrado.
                }

                let act = type === "tv" ? "get_live_streams" : (type === "movie" ? "get_vod_streams" : "get_series");
                let url = `${api}&action=${act}`;
                if (genre) {
                    const catParam = type === "tv" ? "category_id" : "category_id"; // Simplificado
                    // Aqui a lógica de filtro por género
                }

                const res = await axios.get(url, this.getAxiosOpts(config));
                let data = Array.isArray(res.data) ? res.data : [];
                
                // Filtro por categoria (se selecionada)
                if (genre) {
                    data = data.filter(item => item.category_name === genre || item.category_id === genre);
                }

                metas = data.slice(skip, skip + 150).map(item => ({
                    id: `xlv:${lIdx}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}`,
                    name: item.name || item.title, type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                }));

            } else {
                // Lógica Stalker com suporte a categorias
                const auth = await this.authenticate(config);
                if (auth) {
                    const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                    const page = Math.floor(skip / 14) + 1;
                    let url = `${auth.api}type=${sType}&action=get_ordered_list&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                    
                    if (genre) {
                        // Se houver género, a API stalker usa movie_genre ou category
                        url += `&category=${encodeURIComponent(genre)}`;
                    }

                    const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers }));
                    const raw = res.data?.js?.data || res.data?.js || [];
                    const items = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd));
                    
                    metas = items.map(m => ({
                        id: `xlv:${lIdx}:${encodeURIComponent(m.cmd || m.id)}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title, type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                    }));
                }
            }
        } catch (e) {}
        return { metas };
    },

    async getMeta(type, id) {
        const parts = id.split(":");
        const name = decodeURIComponent(parts[3] || "Conteúdo");
        return { meta: { id, type, name, posterShape: type === "tv" ? "landscape" : "poster" } };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":"); 
        const lIdx = parseInt(parts[1]); 
        const sId = parts[2];
        const channelName = decodeURIComponent(parts[3] || "Canal");
        
        const lists = this.parseConfig(configBase64); 
        const config = lists[lIdx]; 
        if (!config) return { streams: [] };

        const listName = config.name || `Lista ${lIdx + 1}`;
        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;

        let streams = [];
        
        if (config.type === 'xtream') {
            const b = config.url.trim().replace(/\/$/, "");
            streams.push({ 
                name: listName, 
                url: `${b}/${config.user}/${config.pass}/${sId}`, 
                title: `${channelName}\n📺 direto tv`, 
                behaviorHints: { notWebReady: true } 
            });
        } else {
            try {
                const auth = await this.authenticate(config);
                if (auth) {
                    const linkUrl = `${auth.api}type=itv&action=create_link&cmd=${encodeURIComponent(decodeURIComponent(sId))}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const res = await axios.get(linkUrl, this.getAxiosOpts(config, { headers: auth.authData.headers }));
                    let cmdUrl = res.data?.js?.cmd || res.data?.js;
                    if (typeof cmdUrl === 'string') {
                        let cleanUrl = cmdUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                        if (cleanUrl.startsWith('http')) {
                            streams.push({ 
                                name: listName, 
                                url: cleanUrl, 
                                title: `${channelName}\n📺 direto tv`, 
                                behaviorHints: { notWebReady: true } 
                            });
                        }
                    }
                }
            } catch(e) {}
        }

        streams.push({ 
            name: listName, 
            url: pUrl, 
            title: `${channelName}\n🔄 proxy estável`, 
            behaviorHints: { notWebReady: true } 
        });
        
        return { streams };
    }
};

module.exports = addon;