//addon.cjs do render!!!

const axios = require("axios");
const crypto = require("crypto");
const https = require('https'); 
const { SocksProxyAgent } = require('socks-proxy-agent');
const authCache = new Map();

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

// Função auxiliar para limpar nomes (ex: remover [PT-PT]) para busca na TMDB
function cleanTitle(title) {
    return title
        .replace(/\[.*?\]/g, '') 
        .replace(/\(.*\)/g, '')   
        .replace(/(S\d+|T\d+).*/i, '') 
        .replace(/(1080p|720p|4k|uhd|hdtv|x264|x265|hevc|dual|latino|legendado|multi|v1|v2)/gi, '')
        .trim();
}

// STBEMU: Adicionado parâmetro sessionCookies para guardar a sessão do servidor
const getStalkerAuth = function(config, token, sessionCookies = "") {
    const mac = (config.mac || "00:1A:79:00:00:00").toUpperCase();
    
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
    // STBEMU: Injetar cookies recebidos do servidor (PHPSESSID)
    if (sessionCookies) {
        cookie += ` ${sessionCookies};`;
    }
    if (token) {
        cookie += ` token=${token}; access_token=${token};`;
    }

    const baseUrl = config.url.replace(/\/$/, "").replace(/\/c$/, "");

    return {
        sn: sn,
        id1: id1,
        sig: sig,
        headers: {
            "User-Agent": ua,
            "X-User-Agent": xua,
            "Cookie": cookie,
            "Authorization": token ? `Bearer ${token}` : undefined,
            "Referer": baseUrl + "/c/",
            "Origin": baseUrl, // STBEMU: Alguns WAF exigem a Origin
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9", 
            "Accept-Encoding": "gzip, deflate",  
            "X-Requested-With": "XMLHttpRequest", // STBEMU CRÍTICO: Essencial para Stalker Portal em PHP
            "Pragma": "no-cache", // STBEMU: Evitar cache de firewalls
            "Cache-Control": "no-cache", // STBEMU: Evitar cache de firewalls
            "Connection": "Keep-Alive"
        }
    };
};

// --- MÁQUINA DE IPs PERSISTENTES (MEO, NOS, VODAFONE) ---
function getPersistentIP(config) {
    const seed = `${config.url}_${config.mac}`;
    const hash = crypto.createHash('md5').update(seed).digest('hex');
    
    const providers = [
        { name: 'MEO', range: [188, 81] },
        { name: 'NOS', range: [89, 152] },
        { name: 'VDF', range: [94, 60] }
    ];
    
    const providerIndex = parseInt(hash.substring(0, 2), 16) % providers.length;
    const provider = providers[providerIndex];
    
    const octet3 = parseInt(hash.substring(2, 4), 16);
    const octet4 = parseInt(hash.substring(4, 6), 16);
    
    const finalIP = `${provider.range[0]}.${provider.range[1]}.${octet3}.${octet4}`;
    
    return { ip: finalIP, ISP: provider.name };
}
// ---------------------------------------------------------

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
    const cleanBase = config.url.trim().replace(/\/$/, "");
    
    // --- VERIFICAÇÃO DE CACHE ---
    const cacheKey = `auth_${cleanBase}_${mac}`;
    if (authCache.has(cacheKey)) {
        const cached = authCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 10 * 60 * 1000) { // 10 minutos
            return cached.data;
        }
    }

    const fakeResidencialIP = '188.81.121.45';
    const deviceId  = crypto.createHash('md5').update(mac).digest('hex').toUpperCase();
    const shortHash = crypto.createHash('md5').update(mac).digest('hex').substring(0, 13).toUpperCase();
    const serialNumber = `8CA3${shortHash.substring(4)}`; 

    const universalHeaders = {
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'X-User-Agent': `Model: MAG250; SW: 2.18-r14-pub-250; STB_active: true; Device ID: ${deviceId}; Device ID 2: ${deviceId}; Signature: 88e76854; SN: ${serialNumber}`,
        'Referer': `${cleanBase}/c/`,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Runtime-Info': 'render: gles; s_type: 250; s_ver: 0.2.18-r14;',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Forwarded-For': fakeResidencialIP,
        'X-Real-IP': fakeResidencialIP,
        'Client-IP': fakeResidencialIP,
        'Cookie': `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`
    };

    const paths = [
        '/c/portal.php',
        '/portal.php',
        '/server/load.php',
        '/stalker_portal/server/load.php'
    ];

    console.log(`[STB-EMU MODE] Tentando enganar portal: ${cleanBase}`);

    for (const path of paths) {
        const fullUrl = `${cleanBase}${path}?`;
        try {
            const handshakeUrl = `${fullUrl}type=stb&action=handshake&mac=${encodeURIComponent(mac)}&JsHttpRequest=1-0`;
            const res = await axios.get(handshakeUrl, this.getAxiosOpts(config, { headers: universalHeaders, timeout: 5000 }));
            
            let data = res.data;
            if (typeof data === 'string') {
                data = JSON.parse(data.replace(/\/\*[\s\S]*?\*\//g, "").trim());
            }

            if (data?.js?.token) {
                const token = data.js.token;
                console.log(`[AUTH SUCCESS] Servidor enganado em: ${path}`);

                universalHeaders.Authorization = `Bearer ${token}`;
                universalHeaders.Cookie += ` token=${token}; access_token=${token};`;

                try {
                    await axios.get(`${fullUrl}type=stb&action=get_profile&token=${token}&JsHttpRequest=1-0`, 
                        this.getAxiosOpts(config, { headers: universalHeaders }));
                } catch (e) { }

                const result = { 
                    api: fullUrl, 
                    token, 
                    authData: { 
                        sn: data.js.sn || deviceId.substring(0, 13), 
                        headers: universalHeaders 
                    } 
                };

                // --- GUARDAR NO CACHE ---
                authCache.set(cacheKey, { data: result, timestamp: Date.now() });

                return result;
            }
        } catch (e) {
            console.warn(`[AUTH SCAN] ${path} recusado (Status: ${e.response?.status || 'OFFLINE'})`);
        }
    }

    console.error(`[AUTH FATAL] Nenhum caminho ou perfil funcionou para este MAC.`);
    return null;
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
                    const f = async (a) => { 
                        try {
                            const r = await axios.get(`${api}&action=${a}`, this.getAxiosOpts(l, { timeout: 5000 })); 
                            return Array.isArray(r.data) ? r.data.map(g => g.category_name) : []; 
                        } catch(e) { return []; }
                    };
                    const [c1, c2, c3] = await Promise.all([f('get_live_categories'), f('get_vod_categories'), f('get_series_categories')]);
                    tvG = tvG.concat(c1); movG = movG.concat(c2); serG = serG.concat(c3);
                } else {
                    const auth = await addon.authenticate(l);
                    if (auth) {
                        // Função de extração com fallback universal para Stalker
                        const fetchSt = async (t, a, fb) => {
                            try {
                                let r = await axios.get(`${auth.api}type=${t}&action=${a}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(l, { headers: auth.authData.headers, timeout: 5000 }));
                                let items = r.data?.js?.data || r.data?.js || [];
                                
                                // Se a primeira tentativa falhar ou vier vazia, tenta o fallback
                                if ((!items || (Array.isArray(items) && items.length === 0)) && fb) {
                                    r = await axios.get(`${auth.api}type=${t}&action=${fb}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(l, { headers: auth.authData.headers, timeout: 5000 }));
                                    items = r.data?.js?.data || r.data?.js || [];
                                }
                                return (Array.isArray(items) ? items : Object.values(items)).map(g => g.title || g.name).filter(Boolean);
                            } catch(e) { return []; }
                        };

                        // Executa as buscas de forma independente para não quebrar o manifest
                        const [g1, g2, g3] = await Promise.all([
                            fetchSt('itv', 'get_genres', 'get_categories'), 
                            fetchSt('vod', 'get_categories', 'get_genres'), 
                            fetchSt('series', 'get_categories', 'get_genres')
                        ]);
                        tvG = tvG.concat(g1); movG = movG.concat(g2); serG = serG.concat(g3);
                    }
                }
            } catch(e) { console.error(`[MANIFEST ERROR] Falha ao carregar categorias da lista ${i}:`, e.message); }
            
            // Filtra duplicados e valores nulos para garantir que o menu apareça limpo no Stremio
            catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: [...new Set(tvG.filter(Boolean))] }, { name: "skip" }] });
            catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: [...new Set(movG.filter(Boolean))] }, { name: "skip" }] });
            catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: [...new Set(serG.filter(Boolean))] }, { name: "skip" }] });
        }));
        const addonName = lists.map(l => l.name).filter(Boolean).join(" + ") || "XuloV Hub";
        const m = { id: "org.xulov.stalker", version: "5.3.0", name: addonName, resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
        setCache(cacheKey, m, 60); 
        console.log("[MANIFEST] Manifest gerado com sucesso.");
        return m;
    },
    
    async getCatalog(type, id, extra, configBase64) {
        console.log(`[CATALOG] Pedido: type=${type}, id=${id}, genre=${extra.genre || 'N/A'}, skip=${extra.skip || 0}`);
        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx]; if (!config) return { metas: [] };
        
        const listSig = crypto.createHash('md5').update(config.url).digest('hex').substring(0,4);
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
                    id: `xlv:${lIdx}_${listSig}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}:${encodeURIComponent(item.stream_icon || item.cover || '')}`,
                    name: item.name || item.title, type: type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                }));
            } else {
                const auth = await addon.authenticate(config);
                if (auth) {
                    const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                    let catP = "";
                    
                    if (extra.genre && extra.genre !== "Predefinido") {
                        // Lógica Universal: Tenta encontrar o ID da categoria em múltiplas ações
                        const actions = sType === "itv" ? ["get_genres", "get_categories"] : ["get_categories", "get_genres"];
                        let cats = [];
                        
                        for (const act of actions) {
                            try {
                                const cRes = await axios.get(`${auth.api}type=${sType}&action=${act}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 }));
                                const found = cRes.data?.js?.data || cRes.data?.js || [];
                                const tempCats = Array.isArray(found) ? found : Object.values(found);
                                if (tempCats.length > 0) {
                                    cats = tempCats;
                                    break; // Se encontrou algo, para de procurar
                                }
                            } catch(e) { continue; }
                        }
                        
                        const cat = cats.find(c => (c.title || c.name) === extra.genre);
                        if (cat) catP = sType === "itv" ? `&genre=${cat.id}` : `&category=${cat.id}`;
                    }

                    let sAct = "get_ordered_list"; 
                    const page = Math.floor(skip / 14) + 1;
                    
                    let chCheckCat = type === "tv" ? "&force_ch_link_check=1" : "";
                    const url = `${auth.api}type=${sType}&action=${sAct}${catP}&p=${page}&sn=${auth.authData.sn}&token=${auth.token}${chCheckCat}&JsHttpRequest=1-0`;
                    
                    const res = await axios.get(url, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                    const raw = res.data?.js?.data || res.data?.js || [];
                    
                    metas = (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i && (i.id || i.cmd)).map(m => {
                        let targetId = (type === "series") ? (m.id || m.cmd) : (m.cmd || m.id);
                        return {
                            id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(targetId)}:${encodeURIComponent(m.name || m.title)}:${encodeURIComponent(m.logo || m.screenshot_uri || '')}`,
                            name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                        };
                    });
                }
            }
        } catch (e) { console.error(`[CATALOG ERROR] Erro ao carregar catálogo:`, e.message); }
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
                        const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 });

                        let rFirst = await axios.get(`${apiBase}&type=series&action=get_ordered_list&movie_id=${sId}`, opts);
                        let levels = rFirst.data?.js?.data || rFirst.data?.js || [];
                        levels = Array.isArray(levels) ? levels : Object.values(levels);

                        if (levels.length === 0) {
                            let rSecond = await axios.get(`${apiBase}&type=vod&action=get_ordered_list&movie_id=${sId}`, opts);
                            let levelsSecond = rSecond.data?.js?.data || rSecond.data?.js || [];
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
                                let rInfo = await axios.get(`${apiBase}&type=vod&action=get_movie_info&movie_id=${item.id || item.cmd}`, opts);
                                let info = rInfo.data?.js;
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
                            console.log(`[META] Nenhuma pasta encontrada para ${sId}. Tentando busca direta...`);
                            
                            let rInfoDirect = await axios.get(`${apiBase}&type=vod&action=get_movie_info&movie_id=${sId}`, opts);
                            let infoDirect = rInfoDirect.data?.js;
                            
                            if (!infoDirect || (!infoDirect.series && !infoDirect.cmd)) {
                                 let rInfoSer = await axios.get(`${apiBase}&type=series&action=get_movie_info&movie_id=${sId}`, opts);
                                 infoDirect = rInfoSer.data?.js || infoDirect;
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
            } catch (e) { console.error(`[META ERROR] Erro ao extrair info da série ${id}:`, e.message); }

            if (meta.videos.length === 0) {
                console.warn(`[META WARNING] Nenhum episódio encontrado para a série: ${id}`);
                meta.videos.push({
                    id: `xlv:${lIdx}_${listSig}:empty:empty`,
                    title: "Nenhum episódio encontrado ou servidor instável",
                    season: 1, episode: 1
                });
            } else {
                console.log(`[META] Série processada com sucesso: ${meta.videos.length} episódios encontrados.`);
            }
        }
        return { meta };
    },

  async getStreams(type, id, configBase64, host) {
        console.log(`[STREAMS] Pedido de stream: type=${type}, id=${id}`);
        
        if (type === "series") {
            await new Promise(resolve => setTimeout(resolve, 2500));
        }

        const parts = id.split(":"); 
        
        const lIdxParts = parts[1].split("_");
        const lIdx = parseInt(lIdxParts[0]);
        const sig = lIdxParts[1];
        
        const sId = parts[2];
        const name = decodeURIComponent(parts[3] || "Stream");
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        
        if (!config) return { streams: [] };
        const expectedSig = crypto.createHash('md5').update(config.url).digest('hex').substring(0,4);
        if (sig && sig !== expectedSig) {
            console.log(`[STREAMS] Pedido ignorado! Este botão pertence a outra lista.`);
            return { streams: [] };
        }

        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;

        let streams = [];
        let directAdded = false;

        if (config?.type === 'xtream') {
            const b = config.url.trim().replace(/\/$/, "");
            if (type === 'tv') {
                streams.push({ name: name, url: `${b}/${config.user}/${config.pass}/${sId}`, title: `📺 Directo TV`, behaviorHints: { notWebReady: true } });
            } else if (type === 'movie') {
                streams.push({ name: name, url: `${b}/movie/${config.user}/${config.pass}/${sId}`, title: `🎬 Directo Filme`, behaviorHints: { notWebReady: true } });
            } else if (type === 'series') {
                streams.push({ name: name, url: `${b}/series/${config.user}/${config.pass}/${sId}`, title: `🍿 Directo Série - ${name}`, behaviorHints: { notWebReady: true } });
            }
            console.log(`[STREAMS] Link gerado (Xtream): ${type}`);
        } 
        else {
            try {
                let auth = await addon.authenticate(config);
                if (auth) {
                    const decodedCmd = decodeURIComponent(sId);
                    
                    let realCmd = decodedCmd;
                    let sNum = null;
                    
                    if (decodedCmd.includes('|||')) {
                        let partsCmd = decodedCmd.split('|||');
                        realCmd = partsCmd[0];
                        sNum = partsCmd[1];
                    } else if (decodedCmd.includes('|')) {
                        let partsCmd = decodedCmd.split('|');
                        realCmd = partsCmd[0];
                        sNum = partsCmd[1];
                    }

                    const cmdType = (type === "movie" || type === "series") ? "vod" : "itv";
                    let seriesParam = sNum ? `&series=${sNum}` : '';
                    let chCheck = type === "tv" ? "&force_ch_link_check=1" : "";
                    
                    console.log(`[STREAMS] Stalker - Extraindo link para cmd/id=${realCmd}, series=${sNum || 'N/A'}`);

                    const fetchStreamLink = async (currentAuth) => {
                        let url = null;
                        const opts = addon.getAxiosOpts(config, { headers: currentAuth.authData.headers, timeout: 5000 });
                        
                        let linkUrl = `${currentAuth.api}type=${cmdType}&action=create_link&cmd=${encodeURIComponent(realCmd)}${seriesParam}&sn=${currentAuth.authData.sn}&token=${currentAuth.token}${chCheck}&JsHttpRequest=1-0`;
                        let res = await axios.get(linkUrl, opts).catch(() => ({}));
                        let jsData = res.data?.js;
                        url = jsData?.cmd || jsData?.url || (typeof jsData === 'string' ? jsData : null);
                        if (!url && typeof jsData === 'object' && jsData !== null) {
                            url = Object.values(jsData).find(v => typeof v === 'string' && (v.startsWith('http') || v.includes('://')));
                        }
                        if (!url || url.trim() === "") {
                            let linkUrlId = `${currentAuth.api}type=${cmdType}&action=create_link&video_id=${encodeURIComponent(realCmd)}${seriesParam}&sn=${currentAuth.authData.sn}&token=${currentAuth.token}${chCheck}&JsHttpRequest=1-0`;
                            let resId = await axios.get(linkUrlId, opts).catch(() => ({}));
                            let jsDataId = resId.data?.js;
                            url = jsDataId?.cmd || jsDataId?.url || (typeof jsDataId === 'string' ? jsDataId : null);
                        }
                        if ((!url || url.trim() === "") && type === "series") {
                            let linkUrlSeries = `${currentAuth.api}type=series&action=create_link&video_id=${encodeURIComponent(realCmd)}${seriesParam}&sn=${currentAuth.authData.sn}&token=${currentAuth.token}${chCheck}&JsHttpRequest=1-0`;
                            let resSeries = await axios.get(linkUrlSeries, opts).catch(() => ({}));
                            let jsDataSeries = resSeries.data?.js;
                            url = jsDataSeries?.cmd || jsDataSeries?.url || (typeof jsDataSeries === 'string' ? jsDataSeries : null);
                        }
                        if ((!url || url.trim() === "") && (type === "series" || type === "movie")) {
                            let linkUrlMovie = `${currentAuth.api}type=vod&action=create_link&movie_id=${encodeURIComponent(realCmd)}${seriesParam}&sn=${currentAuth.authData.sn}&token=${currentAuth.token}${chCheck}&JsHttpRequest=1-0`;
                            let resMovie = await axios.get(linkUrlMovie, opts).catch(() => ({}));
                            let jsDataMovie = resMovie.data?.js;
                            url = jsDataMovie?.cmd || jsDataMovie?.url || (typeof jsDataMovie === 'string' ? jsDataMovie : null);
                        }
                        return url;
                    };

                                        let cmdUrl = await fetchStreamLink(auth);

                    if (!cmdUrl || cmdUrl.trim() === "") {
                        console.log(`[STREAMS] Link não recebido. Possível token/sessão expirada. Forçando novo token...`);
                        const authCacheKey = `auth_${config.url}_${config.mac || 'nomac'}`;
                        delete memCache[authCacheKey]; 
                        auth = await addon.authenticate(config); 
                        if (auth) {
                            cmdUrl = await fetchStreamLink(auth); 
                        }
                    }

                    if (typeof cmdUrl === 'string' && cmdUrl.trim() !== "") {
                        console.log(`[STREAMS] Sucesso! URL original recebido: ${cmdUrl}`);
                        let cleanUrl = cmdUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                        
                        // 🛠️ INÍCIO DO FIX UNIVERSAL (Anti-Gaguez + Compatibilidade Total)
                        try {
                            let baseUrlFromCmd = realCmd.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                            
                            if (baseUrlFromCmd.startsWith('http') && cleanUrl.includes('?')) {
                                let cmdObj = new URL(baseUrlFromCmd);
                                let cleanObj = new URL(cleanUrl);
                                
                                // 1. Protege os portais normais: se o comando original for localhost, ignoramos o fix!
                                let isLocal = cmdObj.hostname === 'localhost' || cmdObj.hostname === '127.0.0.1';
                                
                                // 2. Garante que só mexemos se o servidor final partilhar o mesmo domínio base
                                let isSameHost = cleanObj.hostname === cmdObj.hostname;
                                
                                // 3. Deteta se a pasta principal foi duplicada no caminho (ex: /MBA15... aparece 2 vezes)
                                let firstFolder = cmdObj.pathname.split('/')[1]; 
                                let hasDuplicatedPath = firstFolder && 
                                                        cleanObj.pathname.indexOf('/' + firstFolder + '/') !== cleanObj.pathname.lastIndexOf('/' + firstFolder + '/');
                                
                                // 4. Deteta se há um domínio estragado metido no meio das pastas (ex: ium.space:80/)
                                let hasMangledDomain = /\.[a-z]{2,}(:\d+)?\//i.test(cleanObj.pathname);

                                // Aplica o fix APENAS se não for localhost, os domínios baterem certo, e houver prova do "bug" do portal
                                if (!isLocal && isSameHost && cleanObj.pathname.endsWith(cmdObj.pathname) && (hasDuplicatedPath || hasMangledDomain)) {
                                    let params = cleanUrl.substring(cleanUrl.indexOf('?'));
                                    cleanUrl = baseUrlFromCmd + params;
                                    console.log(`[STREAMS] FIX UNIVERSAL APLICADO: URL corrigido para: ${cleanUrl}`);
                                }
                            }
                        } catch (e) {
                            // Ignora silenciosamente se o URL for inválido para não quebrar os outros portais
                        }
                        // 🛠️ FIM DO FIX UNIVERSAL

                        if (cleanUrl.includes('://')) {
                            const titleStr = type === 'movie' ? '🎬 Directo Filme' : (type === 'series' ? `🍿 Directo Série - ${name}` : '⚡ Directo TV');
                            streams.push({ name: name, url: cleanUrl, title: titleStr, behaviorHints: { notWebReady: true } });
                            directAdded = true;
                        }

                    } else {
                        console.warn(`[STREAMS WARNING] Nenhuma tentativa devolveu link válido para ${id}`);
                    }

                }
            } catch(e) { 
                console.error(`[STREAM ERROR] Falha no processo de link Stalker para ${id}:`, e.message); 
            }

            if (!directAdded) {
                let fallbackUrl = decodeURIComponent(sId).split('|||')[0].split('|')[0].replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                if (fallbackUrl.startsWith('http')) {
                    const titleStr = type === 'movie' ? '🎬 Directo Filme' : (type === 'series' ? `🍿 Directo Série - ${name}` : '⚡ Directo TV');
                    streams.push({ name: name, url: fallbackUrl, title: titleStr, behaviorHints: { notWebReady: true } });
                    console.log(`[STREAMS] Aplicado fallback bruto direto.`);
                }
            }
        }
        
        const proxyTitle = type === 'movie' ? '🎬 Proxy Estável' : (type === 'series' ? `🍿 Proxy Estável - ${name}` : '🔄 Proxy Estável');
        streams.push({ name: name, url: pUrl, title: proxyTitle, behaviorHints: { notWebReady: true } });
        return { streams };
    }
};

module.exports = addon;