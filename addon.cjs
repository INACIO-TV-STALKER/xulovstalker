const axios = require("axios");
const crypto = require("crypto");

const memCache = {};
function getCache(key) {
    const cached = memCache[key];
    return (cached && cached.expire > Date.now()) ? cached.data : null;
}
function setCache(key, data, ttlMinutes = 60) {
    memCache[key] = { data, expire: Date.now() + (ttlMinutes * 60 * 1000) };
}

const getStalkerAuth = (config, token) => {
    const mac = (config.mac || "").toUpperCase();
    const seed = crypto.createHash('md5').update(mac || 'vazio').digest('hex').toUpperCase();
    const id1 = config.id1 || seed;
    const sig = config.sig || "";
    return {
        headers: {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 272 Safari/533.3",
            "X-User-Agent": `Model: MAG254; SW: 0.2.18-r14; Device ID: ${id1}; Signature: ${sig}`,
            "Cookie": `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;${token ? ` access_token=${token};` : ""}`,
            "Referer": config.url.replace(/\/$/, "") + "/c/",
            "Accept": "*/*"
        }
    };
};

const addon = {
    async authenticate(config) {
        const cacheKey = `auth_${config.url}_${config.mac}`;
        if (getCache(cacheKey)) return getCache(cacheKey);

        let baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const api = baseUrl + "portal.php";

        try {
            const auth = getStalkerAuth(config, null);
            const res = await axios.get(`${api}?type=stb&action=handshake&JsHttpRequest=1-0`, { headers: auth.headers, timeout: 5000 });
            const token = res.data?.js?.token || res.data?.token;

            if (token) {
                const finalAuth = { token, api: api + "?", authData: getStalkerAuth(config, token) };
                setCache(cacheKey, finalAuth, 120);
                return finalAuth;
            }
        } catch (e) { console.error("Auth Fail"); }
        return null;
    },

    async getManifest(configBase64) {
        const lists = JSON.parse(Buffer.from(decodeURIComponent(configBase64), 'base64').toString()).lists || [];
        let catalogs = [];

        for (let i = 0; i < lists.length; i++) {
            const auth = await this.authenticate(lists[i]);
            const name = lists[i].name || `Lista ${i+1}`;
            
            // Buscar Categorias Reais para o Manifest
            const cats = { tv: [], movie: [], series: [] };
            if (auth) {
                try {
                    const [cTv, cMov, cSer] = await Promise.all([
                        axios.get(`${auth.api}type=itv&action=get_categories&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers }),
                        axios.get(`${auth.api}type=vod&action=get_categories&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers }),
                        axios.get(`${auth.api}type=series&action=get_categories&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers })
                    ]);
                    cats.tv = (cTv.data?.js || []).map(c => c.category_name || c.title);
                    cats.movie = (cMov.data?.js || []).map(c => c.category_name || c.title);
                    cats.series = (cSer.data?.js || []).map(c => c.category_name || c.title);
                } catch (e) {}
            }

            catalogs.push(
                { type: "tv", id: `cat_tv_${i}`, name: `${name} 📺`, genres: cats.tv },
                { type: "movie", id: `cat_mov_${i}`, name: `${name} 🎬`, genres: cats.movie },
                { type: "series", id: `cat_ser_${i}`, name: `${name} 🍿`, genres: cats.series }
            );
        }

        return { 
            id: "org.xulov.stalker.v1200", version: "12.0.0", 
            name: "XuloV Hub ARCHITECT", 
            resources: ["catalog", "stream", "meta"], 
            types: ["tv", "movie", "series"], 
            idPrefixes: ["xlv12:"], catalogs 
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const lIdx = parseInt(id.split('_').pop());
        const config = JSON.parse(Buffer.from(decodeURIComponent(configBase64), 'base64').toString()).lists[lIdx];
        const auth = await this.authenticate(config);
        if (!auth) return { metas: [] };

        const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
        const page = Math.floor((parseInt(extra.skip) || 0) / 14) + 1;
        
        // Obter ID da categoria se houver filtro de Genre
        let catId = "0";
        if (extra.genre) {
            const catsRes = await axios.get(`${auth.api}type=${sType}&action=get_categories&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers });
            const found = (catsRes.data?.js || []).find(c => (c.category_name || c.title) === extra.genre);
            if (found) catId = found.id;
        }

        const url = `${auth.api}type=${sType}&action=get_ordered_list&category=${catId}&p=${page}&token=${auth.token}&JsHttpRequest=1-0`;
        const res = await axios.get(url, { headers: auth.authData.headers });
        const raw = res.data?.js?.data || res.data?.js || [];
        
        const metas = (Array.isArray(raw) ? raw : Object.values(raw)).map(m => ({
            id: `xlv12:${lIdx}:${encodeURIComponent(m.id || m.cmd)}:${encodeURIComponent(m.name || m.title)}`,
            name: m.name || m.title,
            type,
            poster: m.logo || m.screenshot_uri,
            posterShape: type === "tv" ? "landscape" : "poster"
        }));

        return { metas };
    },

    async getMeta(type, id, configBase64) {
        const [,, lIdx, sId, sName] = id.split(":");
        const config = JSON.parse(Buffer.from(decodeURIComponent(configBase64), 'base64').toString()).lists[lIdx];
        const auth = await this.authenticate(config);
        let meta = { id, type, name: decodeURIComponent(sName), videos: [] };

        if (type === "series" && auth) {
            try {
                // 1. Puxar Temporadas
                const rSeasons = await axios.get(`${auth.api}type=series&action=get_ordered_list&movie_id=${decodeURIComponent(sId)}&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers });
                const seasons = Object.values(rSeasons.data?.js?.data || rSeasons.data?.js || {});

                for (const s of seasons) {
                    const sNum = parseInt((s.name || "").match(/\d+/)?.[0] || 1);
                    // 2. Puxar Episódios de cada temporada (até 30 episódios por temporada)
                    const rEps = await axios.get(`${auth.api}type=series&action=get_ordered_list&movie_id=${encodeURIComponent(s.id || s.cmd)}&token=${auth.token}&JsHttpRequest=1-0`, { headers: auth.authData.headers });
                    const eps = Object.values(rEps.data?.js?.data || rEps.data?.js || {});

                    eps.forEach((ep, i) => {
                        meta.videos.push({
                            id: `xlv12:${lIdx}:${encodeURIComponent(ep.cmd || ep.id)}:stream`,
                            title: ep.name || ep.title || `Episódio ${i+1}`,
                            season: sNum,
                            episode: i + 1
                        });
                    });
                }
            } catch (e) {}
        }
        return { meta };
    },

    async getStreams(type, id, configBase64) {
        const [,, lIdx, cmd] = id.split(":");
        const config = JSON.parse(Buffer.from(decodeURIComponent(configBase64), 'base64').toString()).lists[lIdx];
        const auth = await this.authenticate(config);
        if (!auth) return { streams: [] };

        const targetCmd = decodeURIComponent(cmd);
        const types = type === "tv" ? ["itv"] : ["series", "vod", "itv"];
        
        for (const t of types) {
            try {
                const url = `${auth.api}type=${t}&action=create_link&cmd=${encodeURIComponent(targetCmd)}&token=${auth.token}&JsHttpRequest=1-0`;
                const res = await axios.get(url, { headers: auth.authData.headers });
                const link = res.data?.js?.cmd || res.data?.js;
                if (link && typeof link === 'string' && link.includes('://')) {
                    return { streams: [{ name: "⚡ Link ARCHITECT", url: link.replace(/^(ffrt|ffmpeg)\s+/, "").trim() }] };
                }
            } catch (e) {}
        }
        return { streams: [] };
    }
};

module.exports = addon;
