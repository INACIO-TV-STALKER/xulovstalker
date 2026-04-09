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
            id: "org.xulov.stalker.v596", 
            version: "5.9.6", 
            name: "XuloV Hub PRO", 
            resources: ["catalog", "stream", "meta"], 
            types: ["tv", "movie", "series"], 
            idPrefixes: ["xlv96:"], 
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
                    id: `xlv96:${lIdx}:${encodeURIComponent(m.id || m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
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

                            let targetId = encodeURIComponent(sFolder.id || `${sId}:${sNum}`);
                            let epsArray = [];
                            
                            // --- SOLUÇÃO PARA O MISTÉRIO DO "1" ---
                            if (sFolder.series && Array.isArray(sFolder.series) && sFolder.series.length > 0) {
                                // Se o primeiro item for um número/string (ex: "1"), hidratamos como objeto
                                if (typeof sFolder.series[0] !== 'object') {
                                    console.log(`[STALKER] HIDRATANDO IDs: ${sFolder.series}`);
                                    epsArray = sFolder.series.map(val => ({
                                        id: `${sId}|${val}`, // Formato: ID_SERIE|NUMERO_EPISODIO
                                        name: `Episódio ${val}`,
                                        episode_number: val
                                    }));
                                } else {
                                    epsArray = sFolder.series;
                                }
                                console.log(`[STALKER] ESTRATÉGIA 1 (EMBUTIDOS) ATIVADA`);
                            } else {
                                // ESTRATÉGIA 2: Força bruta com Filtro de Lixo
                                const endpoints = [
                                    `&type=vod&action=get_ordered_list&category=${targetId}`,
                                    `&type=series&action=get_ordered_list&movie_id=${sId}&season_id=${sNum}`,
                                    `&type=series&action=get_ordered_list&category=${targetId}`
                                ];

                                const bannedNames = ["something very bad", "star trek", "the grand tour", "the rookie", "the boys"];

                                for (let epUrl of endpoints) {
                                    try {
                                        let res = await axios.get(apiBase + epUrl, opts);
                                        let tempEps = Object.values(res.data?.js?.data || res.data?.js || {});
                                        
                                        if (tempEps.length > 0) {
                                            let firstTitle = (tempEps[0].name || tempEps[0].title || "").toLowerCase();
                                            let isTrash = bannedNames.some(b => firstTitle.includes(b)) || String(tempEps[0].id) === "3038";
                                            
                                            if (!isTrash) {
                                                epsArray = tempEps;
                                                console.log(`[STALKER] ESTRATÉGIA 2 OK com: ${epUrl}`);
                                                break;
                                            }
                                        }
                                    } catch(err) { }
                                }
                            }

                            // Popular os vídeos
                            for (let ep of epsArray) {
                                let epTitle = ep.name || ep.title || `Episódio ${ep.episode_number || '?'}`;
                                let isFolder = ep.is_dir == 1 || ep.is_dir === "1";

                                if ((ep.cmd || ep.id) && !isFolder) {
                                    let eNum = parseInt(ep.episode_number) || (meta.videos.filter(v => v.season === sNum).length + 1);
                                    meta.videos.push({
                                        id: `xlv96:${lIdx}:${encodeURIComponent(ep.cmd || ep.id)}:${encodeURIComponent(epTitle)}`,
                                        title: epTitle,
                                        season: sNum,
                                        episode: eNum
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (e) { console.log("[META ERROR]", e.message); }
        }
        
        if (meta.videos.length === 0) meta.videos.push({ id: `xlv96:${lIdx}:empty:empty`, title: "Série sem episódios visíveis.", season: 1, episode: 1 });
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":"); const lIdx = parseInt(parts[1]); const sId = parts[2];
        const name = decodeURIComponent(parts[3] || "Stream");
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;
        let streams = [];
        try {
            const auth = await addon.authenticate(config);
            if (auth) {
                const decoded = decodeURIComponent(sId);
                let cmd = decoded; let epNum = "";
                
                // Se o ID for do tipo hidratado "2335|1"
                if (decoded.includes('|')) { 
                    const [serieId, num] = decoded.split('|');
                    cmd = serieId;
                    epNum = num;
                }
                
                const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 });
                // Pedimos o link usando o comando da série + o número do episódio
                const linkUrl = `${auth.api}type=vod&action=create_link&cmd=${encodeURIComponent(cmd)}${epNum ? '&series=' + epNum : ''}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                
                const res = await axios.get(linkUrl, opts);
                let cmdUrl = res.data?.js?.cmd || res.data?.js?.url || res.data?.js;
                if (typeof cmdUrl === 'string' && cmdUrl.includes('://')) {
                    streams.push({ name: "⚡ Directo", url: cmdUrl.replace(/^(ffrt|ffmpeg)\s+/, "").trim(), title: name, behaviorHints: { notWebReady: true } });
                }
            }
        } catch(e) {}
        streams.push({ name: "🔄 Proxy", url: pUrl, title: "Streaming via Hub", behaviorHints: { notWebReady: true } });
        return { streams };
    }
};

module.exports = addon;
