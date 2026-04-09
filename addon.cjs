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

    return {
        sn: sn, id1: id1, sig: sig,
        headers: {
            "User-Agent": ua,
            "X-User-Agent": xua,
            "Cookie": cookie,
            "Referer": config.url.replace(/\/$/, "") + "/c/",
            "Accept": "*/*"
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
            console.log("[AUTH ERROR]", e.message);
            return null; 
        }
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
            id: "org.xulov.stalker.v56", 
            version: "5.6.0", 
            name: "XuloV Hub PRO", 
            resources: ["catalog", "stream", "meta"], 
            types: ["tv", "movie", "series"], 
            idPrefixes: ["xlvnew:"], 
            catalogs: catalogs 
        };
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
                    id: `xlvnew:${lIdx}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}`,
                    name: item.name || item.title, type: type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                }));
            } else {
                const auth = await addon.authenticate(config);
                if (auth) {
                    const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                    const page = Math.floor(skip / 14) + 1;
                    const url = `${auth.api}type=${sType}&action=get_ordered_list&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                    const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                    const raw = res.data?.js?.data || res.data?.js || [];
                    metas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => ({
                        id: `xlvnew:${lIdx}:${encodeURIComponent(m.id || m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
                        name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                    }));
                }
            }
        } catch (e) { console.log("[CATALOG ERROR]", e.message); }
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
                                    id: `xlvnew:${lIdx}:${ep.id}.${ep.container_extension || 'mp4'}:${encodeURIComponent(ep.title || 'Ep')}`,
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

                        console.log(`[STALKER] A iniciar exploração de pastas para ID: ${sId}`);
                        
                        const exploreFolder = async (idToExplore, cmdObjStr, depth = 0) => {
                            if (depth > 3) return;
                            
                            let found = [];
                            let urlsToTry = [
                                `${apiBase}&type=series&action=get_ordered_list&category=${idToExplore}`,
                                `${apiBase}&type=series&action=get_ordered_list&movie_id=${idToExplore}`,
                                `${apiBase}&type=series&action=get_ordered_list&season_id=${idToExplore}`,
                                `${apiBase}&type=vod&action=get_ordered_list&category=${idToExplore}`
                            ];

                            // Se o servidor envia parâmetros escondidos em Base64, nós descodificamos
                            if (cmdObjStr && cmdObjStr.startsWith('ey')) {
                                try {
                                    let decStr = Buffer.from(cmdObjStr, 'base64').toString('utf8');
                                    let dec = JSON.parse(decStr);
                                    if (dec.series_id) {
                                        let u = `${apiBase}&type=series&action=get_ordered_list&series_id=${dec.series_id}`;
                                        if (dec.season_num) u += `&season_num=${dec.season_num}`;
                                        urlsToTry.unshift(u); 
                                    }
                                } catch(e){}
                            }

                            for (let u of urlsToTry) {
                                try {
                                    let r = await axios.get(u, opts);
                                    let data = r.data?.js?.data || r.data?.js || [];
                                    let arr = Array.isArray(data) ? data : Object.values(data);
                                    if (arr.length > 0 && (arr[0].id || arr[0].cmd)) {
                                        found = arr;
                                        break;
                                    }
                                } catch(e){}
                            }

                            for (let item of found) {
                                // O segredo está aqui: Verifica se é uma pasta ou um ficheiro
                                let isFolder = item.is_dir == 1 || item.is_dir === "1" || (item.name && item.name.toLowerCase().includes('season ') && !item.cmd?.includes('episode'));
                                
                                if (isFolder) {
                                    console.log(`[STALKER] Encontrada pasta: ${item.name || item.id}. A entrar...`);
                                    await exploreFolder(item.id, item.cmd, depth + 1);
                                } else {
                                    let sNum = parseInt(item.season_number) || 1;
                                    let eNum = parseInt(item.episode_number) || (meta.videos.length + 1);
                                    
                                    if (!item.episode_number && item.name) {
                                        let m = item.name.match(/ep(?:isodio)?\s*(\d+)/i);
                                        if (m) eNum = parseInt(m[1]);
                                    }

                                    meta.videos.push({
                                        id: `xlvnew:${lIdx}:${encodeURIComponent(item.cmd || item.id)}:${encodeURIComponent(item.name || item.title)}`,
                                        title: item.name || item.title || `Episódio ${eNum}`,
                                        season: sNum,
                                        episode: eNum
                                    });
                                }
                            }
                        };

                        await exploreFolder(sId, null, 0);

                        // Fallback de segurança
                        if (meta.videos.length === 0) {
                            try {
                                let r3 = await axios.get(`${apiBase}&type=vod&action=get_video_info&video_id=${sId}`, opts);
                                let vInfo = r3.data?.js?.data || r3.data?.js || {};
                                if (vInfo.series && Array.isArray(vInfo.series)) {
                                    vInfo.series.forEach((ep, i) => {
                                        meta.videos.push({
                                            id: `xlvnew:${lIdx}:${encodeURIComponent(ep.cmd || sId + '|' + (i+1))}:${encodeURIComponent(ep.name || 'Ep ' + (i+1))}`,
                                            title: ep.name || `Episódio ${i+1}`, season: 1, episode: i + 1
                                        });
                                    });
                                }
                            } catch(e){}
                        }
                    }
                }
            } catch (e) { console.log("[META ERROR]", e.message); }
        }
        
        if (meta.videos.length === 0) {
            meta.videos.push({ id: `xlvnew:${lIdx}:empty:empty`, title: "Pasta não encontrada no servidor", season: 1, episode: 1 });
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
                    let cmdUrl = res.data?.js?.cmd || res.data?.js?.url || res.data?.js;
                    
                    if (typeof cmdUrl === 'string' && cmdUrl.includes('://')) {
                        streams.push({ name: name, url: cmdUrl.replace(/^(ffrt|ffmpeg)\s+/, "").trim(), title: `⚡ Directo`, behaviorHints: { notWebReady: true } });
                    }
                }
            } catch(e) {}
        }

        streams.push({ name: "🔄 Proxy", url: pUrl, title: "Streaming via Hub", behaviorHints: { notWebReady: true } });
        return { streams };
    }
};

module.exports = addon;
