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
    // Cabeçalho e X-User-Agent exatos da captura no PCAPDroid
    const ua = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
    const xua = `Model: ${model}; Link: WiFi`;

    // CORREÇÃO CRÍTICA: mac=${mac} sem encodeURIComponent no Cookie!
    let cookie = `mac=${mac}; stb_lang=en; timezone=Europe/Lisbon; adid=a12b3c2802a27ded62f26b6ede23c95a;`;
    
    // STBEMU: Injetar cookies recebidos do servidor (PHPSESSID)
    if (sessionCookies) {
        cookie += ` ${sessionCookies};`;
    }
    if (token) {
        cookie += ` token=${token}; access_token=${token};`;
    }

    const baseUrl = config.url.replace(/\/$/, "").replace(/\/c$/, "");

    let headers = {
        "User-Agent": ua,
        "X-User-Agent": xua,
        "Cookie": cookie,
        "Referer": baseUrl + "/c/",
        "Origin": baseUrl,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9", 
        "Accept-Encoding": "gzip, deflate",  
        "X-Requested-With": "XMLHttpRequest",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "Connection": "Keep-Alive"
    };

    // Só adiciona o Authorization se o token existir
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    return {
        sn: sn,
        id1: id1,
        sig: sig,
        headers: headers
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
        if (config.type === 'xtream') return true;
        const cacheKey = `auth_${config.url}_${config.mac || 'nomac'}`;
        const cachedAuth = getCache(cacheKey);
        if (cachedAuth) return cachedAuth;
        
        console.log(`[AUTH] Iniciando autenticação Stalker para MAC: ${config.mac || 'Vazio'}`);
        var authData = getStalkerAuth(config, null);
        
        // MUDANÇA CRÍTICA: Lidar com o load.php vs portal.php
        let url = config.url.trim().replace(/\/c\/?$/, ""); 
        if (!url.endsWith('.php')) {
            if (!url.endsWith('/')) url += '/';
            // Se for o vxplay, forçamos o load.php como no PCAP
            if (url.includes('vxplay')) {
                url += "server/load.php";
            } else {
                url += "portal.php"; 
            }
        }
        
        try {
            // Handshake original
            var hUrl = url + "?type=stb&action=handshake&sn=" + authData.sn + "&device_id=" + authData.id1 + "&JsHttpRequest=1-xml&mac=" + config.mac;
            var res = await axios.get(hUrl, this.getAxiosOpts(config, { headers: authData.headers, timeout: 10000 }));
            
            // STBEMU LÓGICA: Capturar PHPSESSID e cookies críticos que vêm no handshake
            let sessionCookies = "";
            if (res.headers && res.headers['set-cookie']) {
                sessionCookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
            }

            var token = res.data?.js?.token || res.data?.token || null;
            if (token) {
                console.log(`[AUTH SUCCESS] Token obtido com sucesso para ${url}`);
                // Injetamos a sessão capturada no finalAuth
                const finalAuth = { token: token, api: url + "?", authData: getStalkerAuth(config, token, sessionCookies) };
                setCache(cacheKey, finalAuth, 60);
                return finalAuth;
            }
            
            // STBEMU LÓGICA DE FALLBACK
            if (!token && sessionCookies) {
                console.log(`[AUTH SUCCESS] Token não exigido. Sessão PHP via cookie estabelecida para ${url}`);
                const finalAuth = { token: "", api: url + "?", authData: getStalkerAuth(config, "", sessionCookies) };
                setCache(cacheKey, finalAuth, 60);
                return finalAuth;
            }

            console.warn(`[AUTH WARNING] Resposta sem token ou sessão para ${url}`);
            return null;
        } catch (e) { 
            console.error(`[AUTH ERROR] Falha no login Stalker (${url}):`, e.message);
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
                            const r = await axios.get(`${auth.api}type=${t}&action=${a}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1&mac=${l.mac}`, this.getAxiosOpts(l, { headers: auth.authData.headers, timeout: 5000 }));
                            const items = r.data?.js?.data || r.data?.js || [];
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
        const m = { id: "org.xulov.stalker", version: "5.3.0", name: addonName, resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
        setCache(cacheKey, m, 60); 
        console.log("[MANIFEST] Manifest gerado com sucesso.");
        return m;
    },

    async getCatalog(type, id, extra, configBase64) {
        console.log(`[CATALOG] Pedido: type=${type}, id=${id}`);
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
                const res = await axios.get(`${api}&action=${act}`, this.getAxiosOpts(config, {timeout: 10000}));
                const items = Array.isArray(res.data) ? res.data : [];
                metas = items.slice(skip, skip + 100).map(item => ({
                    id: `xlv:${lIdx}_${listSig}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}:${encodeURIComponent(item.stream_icon || item.cover || '')}`,
                    name: item.name || item.title, type: type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                }));
            } else {
                const auth = await addon.authenticate(config);
                if (auth) {
                    const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                    let action = (type === "tv") ? "get_all_channels" : "get_ordered_list";
                    
                    const page = Math.floor(skip / 14) + 1;
                    let url = `${auth.api}type=${sType}&action=${action}&JsHttpRequest=1&mac=${config.mac}&sn=${auth.authData.sn}`;
                    if (auth.token) url += `&token=${auth.token}`;
                    url += `&p=${page}`;

                    console.log(`[CATALOG] URL Real: ${url}`);

                    // --- INÍCIO DO BLOCO DE HEADERS PARA SPOOFING ---
                    const magHeaders = {
                        ...auth.authData.headers,
                        "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
                        "X-User-Agent": "Model: MAG250; Link: Ethernet",
                        "Referer": `${config.url}/c/`,
                        "Accept": "*/*",
                        "Connection": "keep-alive"
                    };

                    const res = await axios.get(url, this.getAxiosOpts(config, { 
                        headers: magHeaders, 
                        timeout: 15000,
                        responseType: 'text' 
                    }));
                    // --- FIM DO BLOCO DE HEADERS ---

                    let body = res.data;
                    
                    if (typeof body === 'string') {
                        body = body.replace(/\/\*|\*\//g, '').trim(); 
                        if (!body) {
                            console.error("[CATALOG] Servidor retornou vazio mesmo com headers de MAG.");
                        } else {
                            try {
                                body = JSON.parse(body);
                            } catch(e) {
                                console.error("[CATALOG] Falha no parse JSON. Conteúdo:", body.substring(0, 50));
                            }
                        }
                    }

                    let raw = body?.js?.data || body?.js || [];
                    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.data) raw = raw.data;
                    if (!Array.isArray(raw)) raw = Object.values(raw);
                    
                    metas = raw.filter(i => i && (i.id || i.cmd)).map(m => {
                        let targetId = (type === "series") ? (m.id || m.cmd) : (m.cmd || m.id);
                        return {
                            id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(targetId)}:${encodeURIComponent(m.name || m.title)}:${encodeURIComponent(m.logo || m.screenshot_uri || '')}`,
                            name: m.name || m.title, 
                            type: type, 
                            poster: m.logo || m.screenshot_uri, 
                            posterShape: type === "tv" ? "landscape" : "poster"
                        };
                    });
                }
            }
        } catch (e) { 
            console.error(`[CATALOG ERROR] Detalhes:`, e.message); 
        }
        
        console.log(`[DEBUG] Finalizado com ${metas.length} itens.`);
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
                        const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1&mac=${config.mac}`;
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
                        
                        let linkUrl = `${currentAuth.api}type=${cmdType}&action=create_link&cmd=${encodeURIComponent(realCmd)}${seriesParam}&sn=${currentAuth.authData.sn}&token=${currentAuth.token}${chCheck}&JsHttpRequest=1&mac=${config.mac}`;
                        let res = await axios.get(linkUrl, opts).catch(() => ({}));
                        let jsData = res.data?.js;
                        url = jsData?.cmd || jsData?.url || (typeof jsData === 'string' ? jsData : null);
                        if (!url && typeof jsData === 'object' && jsData !== null) {
                            url = Object.values(jsData).find(v => typeof v === 'string' && (v.startsWith('http') || v.includes('://')));
                        }
                        if (!url || url.trim() === "") {
                            let linkUrlId = `${currentAuth.api}type=${cmdType}&action=create_link&video_id=${encodeURIComponent(realCmd)}${seriesParam}&sn=${currentAuth.authData.sn}&token=${currentAuth.token}${chCheck}&JsHttpRequest=1&mac=${config.mac}`;
                            let resId = await axios.get(linkUrlId, opts).catch(() => ({}));
                            let jsDataId = resId.data?.js;
                            url = jsDataId?.cmd || jsDataId?.url || (typeof jsDataId === 'string' ? jsDataId : null);
                        }
                        if ((!url || url.trim() === "") && type === "series") {
                            let linkUrlSeries = `${currentAuth.api}type=series&action=create_link&video_id=${encodeURIComponent(realCmd)}${seriesParam}&sn=${currentAuth.authData.sn}&token=${currentAuth.token}${chCheck}&JsHttpRequest=1&mac=${config.mac}`;
                            let resSeries = await axios.get(linkUrlSeries, opts).catch(() => ({}));
                            let jsDataSeries = resSeries.data?.js;
                            url = jsDataSeries?.cmd || jsDataSeries?.url || (typeof jsDataSeries === 'string' ? jsDataSeries : null);
                        }
                        if ((!url || url.trim() === "") && (type === "series" || type === "movie")) {
                            let linkUrlMovie = `${currentAuth.api}type=vod&action=create_link&movie_id=${encodeURIComponent(realCmd)}${seriesParam}&sn=${currentAuth.authData.sn}&token=${currentAuth.token}${chCheck}&JsHttpRequest=1&mac=${config.mac}`;
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
