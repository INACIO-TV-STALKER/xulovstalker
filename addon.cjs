const axios = require("axios");
const crypto = require("crypto");
const https = require("https"); // <-- ADICIONADO

// Criar agente HTTPS que ignora certificados autoassinados
const httpsAgent = new https.Agent({ rejectUnauthorized: false }); // <-- ADICIONADO

// Função auxiliar para fazer GET com o agente personalizado
async function axiosGetWithAgent(url, options = {}) { // <-- ADICIONADO
    return axios.get(url, { ...options, httpsAgent });
}

const getStalkerAuth = function(config, token) {
    var mac = (config.mac || "").toUpperCase();
    var seed = mac.replace(/:/g, "");
    var id1 = config.id1 || crypto.createHash('md5').update(seed + "id1").digest('hex').toUpperCase();
    var id2 = config.id2 || crypto.createHash('md5').update(seed + "id2").digest('hex').toUpperCase();
    var sig = config.sig || crypto.createHash('md5').update(seed + "sig").digest('hex').toUpperCase();
    var sn = config.sn || seed.substring(0, 13).toUpperCase();
    var cookie = "mac=" + encodeURIComponent(mac) + "; stb_lang=en; timezone=Europe/Lisbon;";
    if (token) cookie += " access_token=" + token + ";";
    return {
        sn: sn, id1: id1, id2: id2, sig: sig,
        headers: {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3",
            "X-User-Agent": "Model: " + (config.model || 'MAG254') + "; SW: 2.18-r14-254; Device ID: " + id1 + "; Device ID2: " + id2 + "; Signature: " + sig + ";",
            "Cookie": cookie, "Accept": "*/*", "Referer": config.url.replace(/\/$/, "") + "/c/"
        }
    };
};

const addon = {
    parseConfig(configBase64) {
        try {
            const data = JSON.parse(Buffer.from(configBase64, 'base64').toString());
            return data.lists ? data.lists : [data];
        } catch (e) { return []; }
    },

    async authenticate(config) {
        if (!config || !config.url) return null;
        var authData = getStalkerAuth(config, null);
        var baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        var url = baseUrl + "portal.php";
        try {
            var hUrl = url + "?type=stb&action=handshake&sn=" + authData.sn + "&JsHttpRequest=1-0";
            // Substituído axios.get por axiosGetWithAgent
            var res = await axiosGetWithAgent(hUrl, { headers: authData.headers, timeout: 7000 });
            var token = res.data?.js?.token || res.data?.token || null;
            if (token) {
                return { token: token, api: url + "?", authData: getStalkerAuth(config, token) };
            }
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        const genres = ["Todas", "Portugal", "Desporto", "Cinema", "Infantil", "Documentarios"];
        const catalogs = lists.map((l, i) => ({
            type: "tv",
            id: "stalker_cat_" + i,
            name: l.name || ("Lista " + (i + 1)),
            extra: [{ name: "genre", options: genres, isRequired: false }]
        }));

        return {
            id: "org.xulov.stalker.v6",
            version: "6.0.0",
            name: "XuloV Stalker Hub",
            resources: ["catalog", "stream", "meta"],
            types: ["tv"],
            idPrefixes: ["xlv:"],
            catalogs: catalogs
        };
    },

    async getCatalog(type, id, extra, configBase64) {
        const lists = this.parseConfig(configBase64);
        const listIdx = parseInt(id.replace("stalker_cat_", ""));
        const config = lists[listIdx];
        if (!config) return { metas: [] };

        const auth = await this.authenticate(config);
        if (!auth) return { metas: [] };

        try {
            var url = auth.api + "type=itv&action=get_all_channels&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
            // Substituído axios.get por axiosGetWithAgent
            var res = await axiosGetWithAgent(url, { headers: auth.authData.headers, timeout: 10000 });
            var rawData = res.data?.js?.data || res.data?.js || [];
            var channels = Array.isArray(rawData) ? rawData : Object.values(rawData);

            const genre = extra.genre || "Todas";
            if (genre !== "Todas") {
                channels = channels.filter(ch => ch.name.toLowerCase().includes(genre.toLowerCase()));
            }

            return {
                metas: channels.slice(0, 300).map(ch => ({
                    id: `xlv:${listIdx}:${ch.id}:${encodeURIComponent(ch.name)}`,
                    name: ch.name,
                    type: "tv",
                    poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "",
                    posterShape: "square"
                }))
            };
        } catch (e) { return { metas: [] }; }
    },
    async getStreams(type, id, configBase64, host) {
        const parts = id.split(":");
        const listIdx = parseInt(parts[1]);
        const channelId = parts[2];

        const lists = this.parseConfig(configBase64);
        const config = lists[listIdx];
        if (!config) return { streams: [] };

        // 1. Autenticar para obter o token atualizado e os headers
        const auth = await this.authenticate(config);
        if (!auth) return { streams: [] };

        try {
            // 2. Pedir ao portal o link real de reprodução (create_link)
            const cmd = `ffrt ${channelId}`;
            const linkUrl = `${auth.api}type=itv&action=create_link&forced_storage=0&download=0&cmd=${encodeURIComponent(cmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            
            const res = await axiosGetWithAgent(linkUrl, { 
                headers: auth.authData.headers, 
                timeout: 10000 
            });

            let finalUrl = res.data?.js?.data || res.data?.js || res.data?.result;

            if (typeof finalUrl === 'string' && finalUrl.length > 0) {
                // Remover prefixos comuns que o Stalker envia (ex: "ffrt ", "ffmpeg ")
                finalUrl = finalUrl.replace(/^(ffrt|ffmpeg|rtmp)\s+/, "").trim();

                return {
                    streams: [{
                        url: finalUrl,
                        name: "XuloV Direct",
                        description: "Sinal Direto Otimizado",
                        behaviorHints: {
                            notWeb: true, // Força a app a abrir o player nativo
                            isLive: true,
                            // 3. PASSAR OS HEADERS: Essencial para o portal não bloquear o vídeo
                            proxyHeaders: {
                                "common": {
                                    "User-Agent": auth.authData.headers["User-Agent"],
                                    "Cookie": auth.authData.headers["Cookie"]
                                }
                            }
                        }
                    }]
                };
            }
        } catch (e) {
            console.error("Erro ao obter stream:", e.message);
        }
        
        return { streams: [] };
    }

};

module.exports = addon;
