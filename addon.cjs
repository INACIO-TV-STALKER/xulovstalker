const axios = require("axios");
const crypto = require("crypto");

const getStalkerAuth = function(config, token) {
    var mac = (config.mac || "").toUpperCase();
    var seed = mac.replace(/:/g, "");
    var id1 = config.id1 || crypto.createHash('md5').update(seed + "id1").digest('hex').toUpperCase();
    var id2 = config.id2 || crypto.createHash('md5').update(seed + "id2").digest('hex').toUpperCase();
    var sig = config.sig || crypto.createHash('md5').update(seed + "sig").digest('hex').toUpperCase();
    var sn = config.sn || crypto.createHash('md5').update(seed + "sn").digest('hex').substring(0, 13).toUpperCase();
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
        var baseUrl = config.url.trim().replace(/\/c\/?\( /, "").replace(/\/portal\.php\/? \)/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        var url = baseUrl + "portal.php";
        try {
            var hUrl = url + "?type=stb&action=handshake&sn=" + authData.sn + "&device_id=" + authData.id1 + "&JsHttpRequest=1-0";
            var res = await axios.get(hUrl, { headers: authData.headers, timeout: 5000 });
            var token = res.data?.js?.token || res.data?.token || null;
            if (token) {
                var fullAuth = getStalkerAuth(config, token);
                return { token: token, api: url + "?", authData: fullAuth };
            }
        } catch (e) { return null; }
    },

    async getManifest(configBase64) {
        const lists = this.parseConfig(configBase64);
        const catalogs = await Promise.all(lists.map(async (l, i) => {
            let genreOptions = ["Predefinido"];
            const auth = await this.authenticate(l);
            if (auth) {
                try {
                    const gUrl = auth.api + "type=itv&action=get_genres&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
                    const gRes = await axios.get(gUrl, { headers: auth.authData.headers, timeout: 5000 });
                    const genres = Array.isArray(gRes.data?.js) ? gRes.data.js : [];
                    genreOptions = genreOptions.concat(genres.map(g => g.title).filter(Boolean));
                } catch (e) {}
            }
            return {
                type: "tv",
                id: "stalker_cat_" + i,
                name: l.name || ("Lista " + (i + 1)),
                extra: [{
                    name: "genre",
                    isRequired: false,
                    options: genreOptions
                }]
            };
        }));

        return {
            id: "org.xulov.stalker.multi",
            version: "3.1.0",
            name: "XuloV Stalker Hub",
            description: "Suporte para até 5 Portais Stalker - Géneros reais por servidor",
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
            var res = await axios.get(url, { headers: auth.authData.headers, timeout: 10000 });
            var rawData = res.data?.js?.data || res.data?.js || [];
            var channels = Array.isArray(rawData) ? rawData : Object.values(rawData);

            // FILTRO POR GÉNERO REAL
            let filteredChannels = channels;
            if (extra && extra.genre && extra.genre !== "Predefinido") {
                try {
                    const gUrl = auth.api + "type=itv&action=get_genres&sn=" + auth.authData.sn + "&token=" + auth.token + "&JsHttpRequest=1-0";
                    const gRes = await axios.get(gUrl, { headers: auth.authData.headers, timeout: 5000 });
                    const genres = Array.isArray(gRes.data?.js) ? gRes.data.js : [];
                    const genreMap = {};
                    genres.forEach(g => {
                        if (g.title && g.id !== undefined) genreMap[g.title.trim()] = g.id;
                    });
                    const genreId = genreMap[extra.genre.trim()];
                    if (genreId !== undefined) {
                        filteredChannels = channels.filter(ch => String(ch.tv_genre_id || "") === String(genreId));
                    }
                } catch (e) {}
            }

            return {
                metas: filteredChannels.map(ch => ({
                    id: `xlv:\( {listIdx}: \){ch.id}:${encodeURIComponent(ch.name)}`,
                    name: ch.name,
                    type: "tv",
                    poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "",
                    posterShape: "square"
                }))
            };
        } catch (e) { return { metas: [] }; }
    },
async getStreams(type, id, configBase64) {
        const parts = id.split(":");
        const listIdx = parseInt(parts[1]);
        const channelId = parts[2];
        const channelName = decodeURIComponent(parts[3] || "Canal");

        const lists = this.parseConfig(configBase64);
        const config = lists[listIdx];
        const auth = await this.authenticate(config);
        if (!auth) return { streams: [] };

        try {
            // Alteração chave aqui: formato mais compatível com portais atuais
            const cmdRaw = `ffmpeg http://localhost/ch/${channelId}_`;
            const cmd = encodeURIComponent(cmdRaw);

            const sUrl = `\( {auth.api}type=itv&action=create_link&cmd= \){cmd}&sn=${auth.authData.sn}&JsHttpRequest=1-0`;

            const linkRes = await axios.get(sUrl, { headers: auth.authData.headers, timeout: 8000 });

            let jsData = linkRes.data?.js || {};
            let streamUrl = jsData.cmd || "";

            // Limpeza comum e remoção de prefixos que o Stremio não gosta
            if (streamUrl) {
                streamUrl = streamUrl
                    .replace(/^ffmpeg\s+/, '')     // remove ffmpeg no início
                    .replace(/^ffrt\s+/, '')       // remove ffrt se aparecer
                    .replace(/^rtmp\s+/, '')       // por segurança
                    .trim();

                // Se for http/https, adiciona user-agent se necessário (muitos precisam)
                if (streamUrl.startsWith('http')) {
                    return { 
                        streams: [{ 
                            url: streamUrl,
                            title: "▶️ " + channelName,
                            behaviorHints: { 
                                notWebReady: true,          // força player externo se for preciso
                                proxyHeaders: {             // ajuda em alguns casos
                                    request: { "User-Agent": "Lavf/58.29.100" }
                                }
                            }
                        }] 
                    };
                }
            }

            // Se ainda não tiver, tenta fallback com o cmd sem ffmpeg
            if (!streamUrl) {
                const fallbackCmd = encodeURIComponent(`http://localhost/ch/${channelId}`);
                const fallbackUrl = `\( {auth.api}type=itv&action=create_link&cmd= \){fallbackCmd}&sn=${auth.authData.sn}&JsHttpRequest=1-0`;
                const fbRes = await axios.get(fallbackUrl, { headers: auth.authData.headers });
                streamUrl = fbRes.data?.js?.cmd || "";
                if (streamUrl) {
                    streamUrl = streamUrl.replace(/^ffmpeg\s+/, '').trim();
                }
            }

        } catch (e) {
            console.error("Erro ao criar link:", e.message); // para debug (podes ver no terminal)
        }

        return { streams: streamUrl ? [{ url: streamUrl, title: "▶️ " + channelName }] : [] };
    }
};

module.exports = addon;
