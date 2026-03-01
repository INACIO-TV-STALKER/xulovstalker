const axios = require("axios");
const crypto = require("crypto");

const addon = {
    parseConfig(configBase64) {
        try {
            return JSON.parse(Buffer.from(configBase64, 'base64').toString());
        } catch (e) { return null; }
    },

    async authenticate(config) {
        if (!config || !config.url || !config.mac) return null;
        const mac = config.mac.toUpperCase();
        const seed = mac.replace(/:/g, "");
        const id1 = crypto.createHash('md5').update(seed + "id1").digest('hex').toUpperCase();
        const sig = crypto.createHash('md5').update(seed + "sig").digest('hex').toUpperCase();
        
        const headers = {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3",
            "X-User-Agent": `Model: MAG254; SW: 2.18-r14; Device ID: ${id1}; Signature: ${sig};`,
            "Cookie": `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`
        };

        const baseUrl = config.url.trim().replace(/\/portal\.php\/?$/, "");
        const apiUrl = baseUrl + (baseUrl.endsWith('/') ? "" : "/") + "portal.php?";

        try {
            const hRes = await axios.get(`${apiUrl}type=stb&action=handshake&device_id=${id1}&JsHttpRequest=1-0`, { headers, timeout: 5000 });
            const token = hRes.data?.js?.token || hRes.data?.token;
            return { token, apiUrl, headers };
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const config = this.parseConfig(configBase64);
        return {
            id: "org.xulov.stalker",
            version: "1.0.1",
            name: "XuloV Stalker" + (config ? " ✅" : ""),
            description: "IPTV Stalker Portal",
            resources: ["catalog", "stream"],
            types: ["tv"],
            idPrefixes: ["stalker:"],
            catalogs: config ? [{ type: "tv", id: "stalker_live", name: "Canais Direto" }] : []
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const config = this.parseConfig(configBase64);
        const auth = await this.authenticate(config);
        if (!auth) return { metas: [] };
        try {
            const url = `${auth.apiUrl}type=itv&action=get_all_channels&JsHttpRequest=1-0&token=${auth.token}`;
            const res = await axios.get(url, { headers: auth.headers });
            const channels = res.data?.js?.data || [];
            return {
                metas: channels.map(ch => ({
                    id: `stalker:live:${ch.id}`,
                    name: ch.name,
                    type: "tv",
                    poster: ch.logo || ""
                }))
            };
        } catch (e) { return { metas: [] }; }
    },

    async getStreams(type, id, configBase64) {
        // Forçamos o Stremio a usar o nosso PROXY para resolver o link do vídeo
        return {
            streams: [{
                url: `https://REMPLACAR-PELO-TEU-LINK-DO-RENDER/proxy/${configBase64}/${id.split(":")[2]}`,
                title: "Assistir Canal",
                behaviorHints: { notWeb: false, isLive: true }
            }]
        };
    }
};

module.exports = addon;

