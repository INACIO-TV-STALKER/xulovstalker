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

    // Se não preencheres nada no painel, ele usa o gerado automaticamente.
    const sn  = config.sn  || seed.substring(0, 14); 
    const id1 = config.id1 || seed; 
    const sig = config.sig || "";

    // 2. MUDAR A IDENTIDADE DEPENDENDO DA BOX ESCOLHIDA
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
        default: // MAG250 (Padrão)
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
    // 🔥 HELPER PROFISSIONAL ATUALIZADO: Agora suporta SOCKS5 e HTTP
    getAxiosOpts(config, extraOpts = {}) {
        let opts = { ...extraOpts };
        if (config && config.proxy) {
            const proxyStr = config.proxy.trim();
            if (proxyStr.startsWith('socks')) {
                // Injeta o Agente SOCKS5 para a IPVanish/Outras
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
            // Aplica Proxy no Handshake com Timeout de 10s
            var res = await axios.get(hUrl, this.getAxiosOpts(config, { headers: authData.headers, timeout: 10000 }));
            var token = res.data?.js?.token || res.data?.token || null;

            if (token) {
                const finalAuth = { token: token, api: url + "?", authData: getStalkerAuth(config, token) };
                setCache(cacheKey, finalAuth, 60);
                return finalAuth;
            }
            return null;
        } catch (e) { 
            console.error("[AUTH ERROR] Falha no login Stalker:", e.message);
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
            } catch(e) { console.error(`[MANIFEST ERROR] Falha ao carregar lista ${i}:`, e.message); }
            catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: tvG.filter(Boolean) }, { name: "skip" }] });
            catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: movG.filter(Boolean) }, { name: "skip" }] });
            catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: serG.filter(Boolean) }, { name: "skip" }] });
        }));
        const addonName = lists.map(l => l.name).filter(Boolean).join(" + ") || "XuloV Hub";
        const m = { id: "org.xulov.stalker", version: "5.3.0", name: addonName, resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
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
                // CORREÇÃO CIRÚRGICA XTREAM: Garantir que usa o ID correcto se for série
                metas = (Array.isArray(res.data) ? res.data : []).slice(skip, skip + 100).map(item => {
                    let sId = item.stream_id || item.series_id;
                    if (type === "series") sId = item.series_id || item.stream_id;
                    return {
                        id: `xlv:${lIdx}:${sId}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}`,
                        name: item.name || item.title, type: type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                    };
                });
            } else {
                const auth = await addon.authenticate(config);
                if (auth) {
                    const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                    let catP = "";
                    if (extra.genre && extra.genre !== "Predefinido") {
                        const cAct = sType === "itv" ? "get_genres" : "get_categories";
                        const cRes = await axios.get(`${auth.api}type=${sType}&action=${cAct}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 }));
                        const cats = cRes.data?.js?.data || cRes.data?.js || [];
                        const cat = (Array.isArray(cats) ? cats : Object.values(cats)).find(c => (c.title || c.name) === extra.genre);
                        if (cat) catP = sType === "itv" ? `&genre=${cat.id}` : `&category=${cat.id}`;
                    }

                    let sAct = "get_ordered_list"; 

                    const page = Math.floor(skip / 14) + 1;
                    const url = `${auth.api}type=${sType}&action=${sAct}${catP}&p=${page}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                    const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                    const raw = res.data?.js?.data || res.data?.js || [];
                    
                    // CORREÇÃO CIRÚRGICA STALKER: Priorizar o m.id (Pasta) nas séries para o painelbest.online funcionar
                    metas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => {
                        let sId = m.cmd || m.id;
                        if (type === "series") sId = m.id || m.cmd;
                        return {
                            id: `xlv:${lIdx}:${encodeURIComponent(sId)}:${encodeURIComponent(m.name || m.title)}`,
                            name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                        };
                    });
                }
            }
        } catch (e) { console.error("[CATALOG ERROR]", e.message); }
        return { metas };
    },

    async getMeta(type, id, configBase64) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); 
        const sId = parts[2] ? decodeURIComponent(parts[2]) : "";
        const name = decodeURIComponent(parts[3] || "Conteúdo");
        let meta = { id, type, name, posterShape: type === "tv" ? "landscape" : "poster" };

        if (type === "series") {
            try {
                const lists = addon.parseConfig(configBase64);
                const config = lists[lIdx];
                if (config) {
                    if (config.type === 'xtream') {
                        const b = config.url.trim().replace(/\/$/, "");
                        const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}&action=get_series_info&series_id=${sId}`;
                        const res = await axios.get(api, addon.getAxiosOpts(config, { timeout: 10000 }));
                        const episodes = res.data?.episodes || {};
                        let videos = [];
                        Object.keys(episodes).forEach(seasonNum => {
                            episodes[seasonNum].forEach(ep => {
                                videos.push({
                                    id: `xlv:${lIdx}:${ep.id}.${ep.container_extension || 'mp4'}:${encodeURIComponent(ep.title || name)}`,
                                    title: ep.title || `Episódio ${ep.episode_num}`,
                                    season: parseInt(seasonNum),
                                    episode: parseInt(ep.episode_num)
                                });
                            });
                        });
                        meta.videos = videos.sort((a, b) => a.season - b.season || a.episode - b.episode);
                    } else {
                        const auth = await addon.authenticate(config);
                        if (auth) {
                            // Tenta procurar a série no módulo 'series'
                            let url = `${auth.api}type=series&action=get_ordered_list&category=${sId}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                            let res = await axios.get(url, addon.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                            let raw = res.data?.js?.data || res.data?.js || [];
                            let list = Array.isArray(raw) ? raw : Object.values(raw);
                            
                            // PLANO B: Se a lista voltar vazia, procuramos no módulo 'vod' (Alguns portais como o painelbest misturam tudo)
                            if (list.length === 0) {
                                url = `${auth.api}type=vod&action=get_ordered_list&category=${sId}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                                res = await axios.get(url, addon.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                                raw = res.data?.js?.data || res.data?.js || [];
                                list = Array.isArray(raw) ? raw : Object.values(raw);
                            }
                            
                            let videos = [];
                            
                            // Separa de forma inteligente o que é uma Temporada (Pasta) e o que é Episódio (Vídeo)
                            const folders = list.filter(i => i && (i.is_dir == 1 || i.is_dir === "1" || !i.cmd));
                            const files = list.filter(i => i && i.cmd && i.is_dir != 1 && i.is_dir !== "1");
                            
                            if (folders.length > 0) {
                                // Temos pastas! O código entra nelas para extrair os episódios perfeitos
                                const seasonPromises = folders.map(async (folder, fIdx) => {
                                    const sTitle = folder.name || folder.title || "";
                                    const sMatch = sTitle.match(/\d+/);
                                    const sNum = sMatch ? parseInt(sMatch[0]) : (fIdx + 1);
                                    
                                    let epUrl = `${auth.api}type=series&action=get_ordered_list&category=${folder.id}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                                    try {
                                        let epRes = await axios.get(epUrl, addon.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                                        let epRaw = epRes.data?.js?.data || epRes.data?.js || [];
                                        let epList = Array.isArray(epRaw) ? epRaw : Object.values(epRaw);

                                        if (epList.length === 0) {
                                            epUrl = `${auth.api}type=vod&action=get_ordered_list&category=${folder.id}&sn=${auth.authData.sn}&token=${auth.token}&force_ch_link_check=1&JsHttpRequest=1-0`;
                                            epRes = await axios.get(epUrl, addon.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                                            epRaw = epRes.data?.js?.data || epRes.data?.js || [];
                                            epList = Array.isArray(epRaw) ? epRaw : Object.values(epRaw);
                                        }
                                        
                                        return epList.filter(i => i && i.cmd && i.is_dir != 1 && i.is_dir !== "1").map((ep, eIdx) => {
                                            const epTitle = ep.name || ep.title || `Episódio ${eIdx + 1}`;
                                            let finalS = sNum;
                                            let finalE = eIdx + 1;
                                            
                                            const seMatch = epTitle.match(/[Ss](\d+)[^0-9]*[Ee](\d+)/i) || epTitle.match(/(\d+)[Xx](\d+)/);
                                            if (seMatch) {
                                                finalS = parseInt(seMatch[1]);
                                                finalE = parseInt(seMatch[2]);
                                            } else {
                                                const eMatch = epTitle.match(/[Ee]p?(?:is[oó]dio)?\s*(\d+)/i) || epTitle.match(/^(\d+)\./);
                                                if (eMatch) finalE = parseInt(eMatch[1]);
                                            }

                                            return {
                                                id: `xlv:${lIdx}:${encodeURIComponent(ep.cmd || ep.id)}:${encodeURIComponent(epTitle)}`,
                                                title: epTitle,
                                                season: finalS,
                                                episode: finalE
                                            };
                                        });
                                    } catch(e) { return []; }
                                });
                                const seasonsData = await Promise.all(seasonPromises);
                                videos = seasonsData.flat();

                            } else if (files.length > 0) {
                                // As séries não têm pastas, estão todas juntas (Aplica-se em séries mais antigas ou minisséries)
                                videos = files.map((ep, index) => {
                                    const epTitle = ep.name || ep.title || `Episódio ${index + 1}`;
                                    let sNum = 1;
                                    let eNum = index + 1;

                                    const seMatch = epTitle.match(/[Ss](\d+)[^0-9]*[Ee](\d+)/i) || epTitle.match(/(\d+)[Xx](\d+)/);
                                    if (seMatch) {
                                        sNum = parseInt(seMatch[1]);
                                        eNum = parseInt(seMatch[2]);
                                    } else {
                                        const eMatch = epTitle.match(/[Ee]p?(?:is[oó]dio)?\s*(\d+)/i) || epTitle.match(/^(\d+)\./);
                                        if (eMatch) eNum = parseInt(eMatch[1]);
                                    }

                                    return {
                                        id: `xlv:${lIdx}:${encodeURIComponent(ep.cmd || ep.id)}:${encodeURIComponent(epTitle)}`,
                                        title: epTitle,
                                        season: sNum,
                                        episode: eNum
                                    };
                                });
                            }
                            meta.videos = videos;
                        }
                    }
                }
            } catch (e) {
                console.error("[META ERROR] Falha ao carregar episodios:", e.message);
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
            return { streams: [{ name: name, url: pUrl, title: `🎬 Reproduzir (Proxy Estável)`, behaviorHints: { notWebReady: true } }] };
        }

        if (config?.type === 'xtream') {
            const b = config.url.trim().replace(/\/$/, "");
            return { streams: [
                { name: name, url: `${b}/${config.user}/${config.pass}/${sId}`, title: `⚡ Directo TV`, behaviorHints: { notWebReady: true } },
                { name: name, url: pUrl, title: `🔄 Proxy Estável`, behaviorHints: { notWebReady: true } }
            ]};
        }

        let streams = [];
        try {
            const auth = await addon.authenticate(config);
            if (auth) {
                const cmdType = "itv";
                const linkUrl = `${auth.api}type=${cmdType}&action=create_link&cmd=${encodeURIComponent(decodeURIComponent(sId))}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(linkUrl, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 }));
                let cmdUrl = res.data?.js?.cmd || res.data?.js;
                if (typeof cmdUrl === 'string') {
                    let cleanUrl = cmdUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                    if (cleanUrl.startsWith('http')) streams.push({ name: name, url: cleanUrl, title: `⚡ Directo TV`, behaviorHints: { notWebReady: true } });
                }
            }
        } catch(e) { console.error("[STREAM ERROR]", e.message); }

        streams.push({ name: name, url: pUrl, title: `🔄 Proxy Estável`, behaviorHints: { notWebReady: true } });
        return { streams };
    }
};

module.exports = addon;