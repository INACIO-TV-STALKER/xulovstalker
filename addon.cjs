const axios = require("axios");
const crypto = require("crypto");
const https = require('https'); 
const { SocksProxyAgent } = require('socks-proxy-agent');

// Chave da API TMDB fornecida
const TMDB_API_KEY = "04057ce87e56ea3234aff745ce9090ea";

const memCache = {};
function getCache(key) {
    const cached = memCache[key];
    return (cached && cached.expire > Date.now()) ? cached.data : null;
}
function setCache(key, data, ttlMinutes = 30) {
    memCache[key] = { data, expire: Date.now() + (ttlMinutes * 60 * 1000) };
}

// Função auxiliar para lidar com timeouts e retries automáticos em servidores difíceis
const fetchWithRetry = async (url, opts, retries = 2) => {
    // Forçar timeout de 12s para painéis lentos/protegidos
    const finalOpts = { ...opts, timeout: 12000, maxRedirects: 5 }; 
    for (let i = 0; i <= retries; i++) {
        try {
            return await axios.get(url, finalOpts);
        } catch (e) {
            if (i === retries) throw e;
            await new Promise(r => setTimeout(r, 1000 * (i + 1))); // backoff progressivo
        }
    }
};

// Função auxiliar para limpar nomes (ex: remover [PT-PT]) para busca na TMDB
function cleanTitle(title) {
    return title
        .replace(/\[.*?\]/g, '') 
        .replace(/\(.*\)/g, '')   
        .replace(/(S\d+|T\d+).*/i, '') 
        .replace(/(1080p|720p|4k|uhd|hdtv|x264|x265|hevc|dual|latino|legendado|multi|v1|v2)/gi, '')
        .trim();
}

// STBEMU: Geração de Autenticação com Headers Completos (Modo Camuflagem Total)
const getStalkerAuth = function(config, token, sessionCookies = "") {
    const mac = (config.mac || "00:1A:79:00:00:00").toUpperCase();
    
    const seed = crypto.createHash('md5').update(mac || 'vazio').digest('hex').toUpperCase();
    const sn  = config.sn  || seed.substring(0, 14); 
    const id1 = config.id1 || seed; 
    // Fallback de signature caso não venha na config
    const sig = config.sig || crypto.createHash('md5').update(mac + 'SECRET').digest('hex').substring(0, 8); 

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
            // Modo Camuflagem Total (MAG250 clássico)
            ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
            xua = `Model: MAG250; SW: 2.18-r14-pub-250; STB_active: true; Device ID: ${id1}; Device ID 2: ${id1}; Signature: ${sig}`;
    }

    // Alterado: MAC codificado para imitar a box real (ex: 00%3A1A%3A79...)
    let cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`;
    if (sessionCookies) {
        cookie += ` ${sessionCookies};`;
    }
    if (token) {
        cookie += ` token=${token}; access_token=${token};`;
    }

    // [CORREÇÃO REFERER] Garantindo que termina em /c/
    const baseUrl = config.url.replace(/\/$/, "").replace(/\/(portal|load|api)\.php$/, "").replace(/\/c$/, "");
    const referer = baseUrl + "/c/";

    return {
        sn: sn,
        id1: id1,
        sig: sig,
        headers: {
            "User-Agent": ua,
            "X-User-Agent": xua,
            "Cookie": cookie,
            "Referer": referer,
            "Origin": baseUrl, 
            // [CORREÇÃO HEADERS] Accept exato da MAG e inclusão do X-Runtime-Info
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Runtime-Info": "render: gles; s_type: 250; s_ver: 0.2.18-r14; s_date: Wed Aug 30 11:23:45 2017;",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",  
            "X-Requested-With": "XMLHttpRequest", 
            "Pragma": "no-cache", 
            "Cache-Control": "no-cache", 
            "Connection": "Keep-Alive"
        }
    };
};

const addon = {
    getAxiosOpts(config, extraOpts = {}) {
        let opts = { ...extraOpts };
        
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        opts.httpsAgent = httpsAgent;

        if (config && config.proxy) {
            const proxyStr = config.proxy.trim();
            if (proxyStr.startsWith('socks')) {
                const agent = new SocksProxyAgent(proxyStr);
                agent.options.rejectUnauthorized = false;
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
        catch (e) { 
            console.error("[CONFIG ERROR] Falha ao descodificar a configuração Base64:", e.message);
            return []; 
        }
    },

async authenticate(config) {
        const mac = config.mac.toUpperCase();
        let baseUrl = config.url.trim().replace(/\/$/, "");
        let cleanBase = baseUrl.replace(/portal\.php$/, "").replace(/\/$/, "");
        const api = `${cleanBase}/portal.php?`;
        
        const magHeaders = {
            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 424 Safari/533.3',
            'X-User-Agent': 'Model: MAG424; SW: 2.20.05; Device ID: ' + crypto.createHash('md5').update(mac).digest('hex').toUpperCase(),
            'Referer': `${cleanBase}/c/`,
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Runtime-Info': 'render: gles; s_type: 424; s_ver: 0.2.20;',
            'Cookie': `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`
        };

        try {
            // 1. Handshake
            const authUrl = `${api}type=stb&action=handshake&mac=${encodeURIComponent(mac)}&JsHttpRequest=1`;
            const res = await axios.get(authUrl, this.getAxiosOpts(config, { headers: magHeaders }));
            let body = typeof res.data === 'string' ? JSON.parse(res.data.replace(/\/\*[\s\S]*?\*\//g, "").trim()) : res.data;

            const token = body?.js?.token || "";
            if (!token) throw new Error("Token não obtido");

            magHeaders.Authorization = `Bearer ${token}`;
            magHeaders.Cookie += ` token=${token};`;

            // 2. Get Profile (Obrigatório)
            const profileUrl = `${api}type=stb&action=get_profile&token=${token}&JsHttpRequest=1`;
            await axios.get(profileUrl, this.getAxiosOpts(config, { headers: magHeaders }));

            // 3. Get Localization (O GATILHO: Muitos servidores só mostram canais após isto)
            const locUrl = `${api}type=stb&action=get_localization&token=${token}&JsHttpRequest=1`;
            await axios.get(locUrl, this.getAxiosOpts(config, { headers: magHeaders }));

            console.log(`[AUTH SUCCESS] Sessão total inicializada para: ${mac}`);
            return { api, token, authData: { sn: body?.js?.sn || "00000000000000", headers: magHeaders } };
        } catch (e) {
            console.error("[AUTH ERROR]", e.message);
            return null;
        }
  },
    
    async getManifest(configBase64) {
        console.log("[MANIFEST] Pedido de Manifest recebido.");
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
                            const r = await fetchWithRetry(`${auth.api}type=${t}&action=${a}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1`, this.getAxiosOpts(l, { headers: auth.authData.headers }));
                            const items = r?.data?.js?.data || r?.data?.js || [];
                            return (Array.isArray(items) ? items : Object.values(items)).map(g => g.title || g.name).filter(Boolean);
                        };
                        const [g1, g2, g3] = await Promise.all([fetchSt('itv', 'get_genres'), fetchSt('vod', 'get_categories'), fetchSt('series', 'get_categories')]);
                        tvG = tvG.concat(g1); movG = movG.concat(g2); serG = serG.concat(g3);
                    }
                }
            } catch(e) { console.error(`[MANIFEST ERROR] Falha ao carregar categorias da lista ${i}:`, e.message); }
            catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: tvG.filter(Boolean) }, { name: "skip" }] });
            catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: movG.filter(Boolean) }, { name: "skip" }] });
            catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: serG.filter(Boolean) }, { name: "skip" }] });
        }));
        const addonName = lists.map(l => l.name).filter(Boolean).join(" + ") || "XuloV Hub";
        const m = { id: "org.xulov.stalker", version: "5.3.4", name: addonName, resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
        setCache(cacheKey, m, 60); 
        console.log("[MANIFEST] Manifest gerado com sucesso.");
        return m;
    }, 

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx]; if (!config) return { metas: [] };
        const listSig = crypto.createHash('md5').update(config.url).digest('hex').substring(0,4);
        const skip = parseInt(extra.skip) || 0;
        let metas = [];

        try {
            const auth = await this.authenticate(config);
            if (auth) {
                const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                const itemsPerPage = 60;
                const page = Math.floor(skip / itemsPerPage) + 1;
                
                // Tentativa com action=get_ordered_list que é a mais universal
                let sAct = (type === "tv") ? "get_all_channels" : "get_ordered_list";
                let catParam = (type === "tv") ? "" : "&category=0";
                
                const url = `${auth.api}type=${sType}&action=${sAct}${catParam}&p=${page}&per_page=${itemsPerPage}&token=${auth.token}&JsHttpRequest=1`;
                
                const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, responseType: 'text' });
                let res = await fetchWithRetry(url, opts);
                let bodyData = res.data;

                if (typeof bodyData === 'string') {
                    bodyData = bodyData.replace(/\/\*[\s\S]*?\*\//g, "").trim();
                    try { bodyData = JSON.parse(bodyData); } catch(e) { bodyData = {}; }
                }

                // Se o JS vier dentro de JS (comum em Stalker)
                let raw = bodyData?.js?.data || bodyData?.js || [];
                if (!Array.isArray(raw)) raw = Object.values(raw).filter(x => x && typeof x === 'object');

                console.log(`[CATALOG] ${type.toUpperCase()} -> Encontrados ${raw.length} itens.`);

                const paged = raw.slice(skip % itemsPerPage, (skip % itemsPerPage) + 20);
                metas = paged.filter(i => i && (i.id || i.cmd)).map(m => {
                    const img = m.logo || m.screenshot_uri || '';
                    return {
                        id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(m.cmd || m.id)}:${encodeURIComponent(m.name || m.title)}:${encodeURIComponent(img)}`,
                        name: m.name || m.title, 
                        type, 
                        poster: img, 
                        posterShape: type === "tv" ? "landscape" : "poster"
                    };
                });
            }
        } catch (e) { console.error(`[CATALOG ERROR]`, e.message); }
        return { metas };
    },

    async getMeta(type, id, configBase64) {
        console.log(`[META] Pedido: type=${type}, id=${id}`);
        const parts = id.split(":");
        
        const lIdxParts = parts[1].split("_");
        const lIdx = parseInt(lIdxParts[0]);
        const sig = lIdxParts[1];
        
        const sId = decodeURIComponent(parts[2]);
        const name = decodeURIComponent(parts[3] || "Série");
        const posterUrl = parts[4] ? decodeURIComponent(parts[4]) : undefined;
        
        const _lists = this.parseConfig(configBase64);
        const _config = _lists[lIdx];
        if (_config) {
            const expectedSig = crypto.createHash('md5').update(_config.url).digest('hex').substring(0,4);
            if (sig && sig !== expectedSig) return { meta: {} }; 
        }
        const listSig = _config ? crypto.createHash('md5').update(_config.url).digest('hex').substring(0,4) : "";

        let meta = { id, type, name, posterShape: "poster", videos: [] };
        
        if (posterUrl) {
            meta.poster = posterUrl;
            meta.background = posterUrl;
        }

        let tmdbId = null; 
        if (type === "series" || type === "movie") {
            try {
                const searchTitle = cleanTitle(name);
                const tmdbType = (type === "series") ? "tv" : "movie";
                let searchUrl = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(searchTitle)}&language=pt-PT`;
                let searchRes = await axios.get(searchUrl);
                
                if ((!searchRes.data.results || searchRes.data.results.length === 0)) {
                    searchUrl = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(searchTitle)}`;
                    searchRes = await axios.get(searchUrl);
                }

                if (searchRes.data.results && searchRes.data.results.length > 0) {
                    const item = searchRes.data.results[0];
                    tmdbId = item.id; 
                    const detailUrl = `https://api.themoviedb.org/3/${tmdbType}/${item.id}?api_key=${TMDB_API_KEY}&language=pt-PT&append_to_response=credits`;
                    const detailRes = await axios.get(detailUrl);
                    const d = detailRes.data;

                    meta.description = d.overview || item.overview;
                    meta.poster = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : meta.poster;
                    meta.background = d.backdrop_path ? `https://image.tmdb.org/t/p/original${d.backdrop_path}` : meta.background;
                    meta.releaseInfo = (d.first_air_date || d.release_date || "").split('-')[0];
                    meta.genres = d.genres ? d.genres.map(g => g.name) : [];
                    
                    if (d.vote_average) {
                        meta.imdbRating = d.vote_average.toFixed(1).toString();
                    }

                    if (d.credits && d.credits.cast) {
                        meta.cast = d.credits.cast.slice(0, 10).map(c => c.name);
                    }
                }
            } catch (e) { console.error(`[TMDB ERROR] Erro ao buscar metadados para ${name}:`, e.message); }
        }

        if (type === "series") {
            const lists = this.parseConfig(configBase64);
            const config = lists[lIdx];
            if (!config) return { meta };

            let seasonDataCache = {};
            const fetchSeasonData = async (sNum) => {
                if (!tmdbId || seasonDataCache[sNum]) return;
                try {
                    const sRes = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${sNum}?api_key=${TMDB_API_KEY}&language=pt-PT`);
                    const sResGlobal = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${sNum}?api_key=${TMDB_API_KEY}`);
                    
                    seasonDataCache[sNum] = {};
                    sRes.data.episodes.forEach((ep, idx) => {
                        const epGlobal = sResGlobal.data?.episodes?.[idx] || {};
                        seasonDataCache[sNum][ep.episode_number] = {
                            thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : (epGlobal.still_path ? `https://image.tmdb.org/t/p/w500${epGlobal.still_path}` : undefined),
                            title: ep.name || epGlobal.name || `Episódio ${ep.episode_number}`,
                            overview: ep.overview || epGlobal.overview || undefined,
                            released: (ep.air_date || epGlobal.air_date) ? new Date(ep.air_date || epGlobal.air_date).toISOString() : undefined
                        };
                    });
                } catch (e) { seasonDataCache[sNum] = {}; }
            };

            try {
                if (config.type === 'xtream') {
                    const b = config.url.trim().replace(/\/$/, "");
                    const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                    const res = await axios.get(`${api}&action=get_series_info&series_id=${sId}`, this.getAxiosOpts(config, { timeout: 10000 }));
                    if (res.data && res.data.episodes) {
                        const epsData = res.data.episodes;
                        for (const sNum of Object.keys(epsData)) {
                            await fetchSeasonData(parseInt(sNum) || 1);
                            
                            epsData[sNum].forEach(ep => {
                                let epNum = parseInt(ep.episode_num) || 1;
                                let epData = seasonDataCache[sNum]?.[epNum] || {}; 
                                meta.videos.push({
                                    id: `xlv:${lIdx}_${listSig}:${ep.id}.${ep.container_extension || 'mp4'}:${encodeURIComponent(ep.title || 'Ep')}`,
                                    title: epData.title || ep.title || `Episódio ${epNum}`,
                                    season: parseInt(sNum) || 1,
                                    episode: epNum,
                                    thumbnail: epData.thumbnail || undefined,
                                    overview: epData.overview || undefined,
                                    released: epData.released || undefined
                                });
                            });
                        }
                    }
                } else {
                    const auth = await addon.authenticate(config);
                    if (auth) {
                        const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1`;
                        const opts = this.getAxiosOpts(config, { headers: auth.authData.headers });

                        let rFirst = await fetchWithRetry(`${apiBase}&type=series&action=get_ordered_list&movie_id=${sId}`, opts);
                        let levels = rFirst?.data?.js?.data || rFirst?.data?.js || [];
                        levels = Array.isArray(levels) ? levels : Object.values(levels);

                        if (levels.length === 0) {
                            let rSecond = await fetchWithRetry(`${apiBase}&type=vod&action=get_ordered_list&movie_id=${sId}`, opts);
                            let levelsSecond = rSecond?.data?.js?.data || rSecond?.data?.js || [];
                            levels = Array.isArray(levelsSecond) ? levelsSecond : Object.values(levelsSecond);
                        }

                        for (let i = 0; i < levels.length; i++) {
                            let item = levels[i];
                            if (!item) continue;

                            let sNum = parseInt((item.name || "").match(/season\s*(\d+)|temporada\s*(\d+)/i)?.[1] || (item.name || "").match(/\d+/)?.[0]) || (i + 1);
                            
                            await fetchSeasonData(sNum);

                            let seriesArr = [];
                            if (item.series) {
                                seriesArr = typeof item.series === 'string' ? item.series.split(',') : (Array.isArray(item.series) ? item.series : []);
                            } else {
                                let rInfo = await fetchWithRetry(`${apiBase}&type=vod&action=get_movie_info&movie_id=${item.id || item.cmd}`, opts);
                                let info = rInfo?.data?.js;
                                if (info && info.series) {
                                    seriesArr = typeof info.series === 'string' ? info.series.split(',') : (Array.isArray(info.series) ? info.series : []);
                                }
                            }

                            if (seriesArr.length > 0) {
                                seriesArr.forEach((epVal, index) => {
                                    let eNum = parseInt(epVal) || (index + 1);
                                    let epData = seasonDataCache[sNum]?.[eNum] || {}; 
                                    meta.videos.push({
                                        id: `xlv:${lIdx}_${listSig}:${encodeURIComponent((item.cmd || item.id) + "|||" + eNum)}:${encodeURIComponent(item.name || "Ep")}`,
                                        title: epData.title || `Episódio ${eNum}`,
                                        season: sNum,
                                        episode: eNum,
                                        thumbnail: epData.thumbnail || undefined,
                                        overview: epData.overview || undefined,
                                        released: epData.released || undefined
                                    });
                                });
                            } else {
                                let epData = seasonDataCache[sNum]?.[1] || {}; 
                                meta.videos.push({
                                    id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(item.cmd || item.id)}:${encodeURIComponent(item.name || "Ep")}`,
                                    title: epData.title || item.name || `Episódio ${i+1}`,
                                    season: sNum,
                                    episode: 1,
                                    thumbnail: epData.thumbnail || undefined,
                                    overview: epData.overview || undefined,
                                    released: epData.released || undefined
                                });
                            }
                        }

                        if (meta.videos.length === 0) {
                            let rInfoDirect = await fetchWithRetry(`${apiBase}&type=vod&action=get_movie_info&movie_id=${sId}`, opts);
                            let infoDirect = rInfoDirect?.data?.js;
                            
                            if (!infoDirect || (!infoDirect.series && !infoDirect.cmd)) {
                                 let rInfoSer = await fetchWithRetry(`${apiBase}&type=series&action=get_movie_info&movie_id=${sId}`, opts);
                                 infoDirect = rInfoSer?.data?.js || infoDirect;
                            }

                            let seriesArrDirect = [];
                            if (infoDirect && infoDirect.series) {
                                seriesArrDirect = typeof infoDirect.series === 'string' ? infoDirect.series.split(',') : (Array.isArray(infoDirect.series) ? infoDirect.series : []);
                            }
                            
                            if (seriesArrDirect.length > 0) {
                                await fetchSeasonData(1);
                                seriesArrDirect.forEach((epVal, index) => {
                                    let eNum = parseInt(epVal) || (index + 1);
                                    let epData = seasonDataCache[1]?.[eNum] || {}; 
                                    meta.videos.push({
                                        id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(sId + "|||" + eNum)}:${encodeURIComponent(name)}`,
                                        title: epData.title || `Episódio ${eNum}`,
                                        season: 1,
                                        episode: eNum,
                                        thumbnail: epData.thumbnail || undefined,
                                        overview: epData.overview || undefined,
                                        released: epData.released || undefined
                                    });
                                });
                            } else if (infoDirect && (infoDirect.cmd || infoDirect.id)) {
                                let epData = seasonDataCache[1]?.[1] || {}; 
                                meta.videos.push({
                                    id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(infoDirect.cmd || infoDirect.id)}:${encodeURIComponent(name)}`,
                                    title: epData.title || infoDirect.name || `Episódio Único`,
                                    season: 1,
                                    episode: 1,
                                    thumbnail: epData.thumbnail || undefined,
                                    overview: epData.overview || undefined,
                                    released: epData.released || undefined
                                });
                            }
                        }

                        meta.videos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
                    }
                }
            } catch (e) { console.error(`[META ERROR] Erro:`, e.message); }

            if (meta.videos.length === 0) {
                meta.videos.push({
                    id: `xlv:${lIdx}_${listSig}:empty:empty`,
                    title: "Nenhum episódio encontrado ou servidor instável",
                    season: 1, episode: 1
                });
            }
        }
        return { meta };
    },

    async getStreams(type, id, configBase64) {
    const [prefix, lIdxSig, streamId, name, poster] = id.split(':');
    const lIdx = parseInt(lIdxSig.split('_')[0]);
    const lists = this.parseConfig(configBase64);
    const config = lists[lIdx];
    if (!config) return { streams: [] };

    try {
        if (config.type === 'xtream') {
            // ... lógica xtream ...
        } else {
            const auth = await addon.authenticate(config);
            if (auth) {
                const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                // Pedir o link real ao servidor Stalker
                const url = `${auth.api}type=${sType}&action=create_link&cmd=${streamId}&mac=${encodeURIComponent(config.mac)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1`;
                
                const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers }));
                let body = res.data;
                if (typeof body === 'string') {
                    body = JSON.parse(body.replace(/\/\*[\s\S]*?\*\//g, "").trim());
                }

                let videoUrl = body?.js?.cmd || body?.js || "";
                if (videoUrl) {
                    // Remover o prefixo 'ffrt ' ou 'ffmpeg ' que alguns painéis adicionam
                    videoUrl = videoUrl.replace(/^(ffrt|ffmpeg|mpv)\s+/, "");
                    
                    return {
                        streams: [{
                            title: decodeURIComponent(name),
                            url: videoUrl,
                            behaviorHints: { notWebReady: true, proxyHeaders: { "User-Agent": auth.authData.headers['User-Agent'] } }
                        }]
                    };
                }
            }
        }
    } catch (e) { console.error(`[STREAM ERROR]`, e.message); }
    return { streams: [] };
    }
};

module.exports = addon;