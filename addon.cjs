const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");

const DATA_PATH = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_PATH, "lists.json");

fs.ensureDirSync(DATA_PATH);
if (!fs.existsSync(DATA_FILE)) { fs.writeJsonSync(DATA_FILE, []); }

const getStalkerAuth = (config, token) => {
    const mac = config.mac.toUpperCase().trim();
    const id1 = config.id1 || crypto.createHash('md5').update(mac + "id1").digest('hex').toUpperCase();
    const sn = config.sn || mac.replace(/:/g, "").substring(0, 13);
    const cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;${token ? " access_token=" + token + ";" : ""}`;
    
    return {
        sn, id1,
        headers: {
            "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3",
            "X-User-Agent": `Model: MAG254; SW: 2.18-r14-254; Device ID: ${id1}; Device ID2: ${id1}; Signature: ;`,
            "Cookie": cookie,
            "Referer": config.url.replace(/\/$/, "") + "/c/"
        }
    };
};

const addon = {
    loadLists: () => { try { return fs.readJsonSync(DATA_FILE); } catch (e) { return []; } },

    async authenticate(config) {
        const authData = getStalkerAuth(config, null);
        let baseUrl = config.url.trim().replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const url = baseUrl + "portal.php";
        try {
            const hUrl = `${url}?type=stb&action=handshake&sn=${authData.sn}&JsHttpRequest=1-0`;
            const res = await axios.get(hUrl, { headers: authData.headers, timeout: 5000 });
            const token = res.data?.js?.token || res.data?.token;
            if (token) return { token, api: url + "?", authData: getStalkerAuth(config, token) };
        } catch (e) { return null; }
    },

    // ESTA FUNÇÃO É A QUE GARANTE AS CATEGORIAS NO STREMIO
    getManifest: function() {
        const lists = this.loadLists();
        const catalogs = lists.map(l => {
            // Extrai os nomes das categorias guardadas no lists.json
            let genreOptions = (l.cachedCategories || []).map(c => c.title);
            
            // Se estiver vazio, põe opções básicas para não aparecer vazio na TV
            if (genreOptions.length === 0) genreOptions = ["Todas", "Portugal", "Sports", "Movies"];
            if (!genreOptions.includes("Todas")) genreOptions.unshift("Todas");

            return {
                type: "tv",
                id: `stalker_list_${l.id}`,
                name: l.name,
                extra: [
                    { name: "genre", options: genreOptions, isRequired: false },
                    { name: "search", isRequired: false }
                ]
            };
        });

        return {
            id: "org.xulov.stalker.pro.v24",
            version: "3.7.0",
            name: "XuloV Stalker Pro",
            description: "Categorias Reais Sincronizadas",
            resources: ["catalog", "stream"],
            types: ["tv"],
            idPrefixes: ["stalker:"],
            catalogs: catalogs
        };
    },

    async getCatalog(type, id, extra) {
        const listId = id.split("_")[2];
        const config = this.loadLists().find(l => l.id === listId);
        if (!config) return { metas: [] };

        const auth = await this.authenticate(config);
        if (!auth) return { metas: [] };

        try {
            const genreSelected = (extra && extra.genre) ? extra.genre : "Todas";
            let categoryId = "0";

            // Encontra o ID do portal que corresponde ao nome selecionado no Stremio
            if (genreSelected !== "Todas" && config.cachedCategories) {
                const found = config.cachedCategories.find(c => c.title === genreSelected);
                if (found) categoryId = found.id;
            }

            const url = `${auth.api}type=itv&action=get_all_channels&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            const res = await axios.get(url, { headers: auth.authData.headers, timeout: 15000 });
            const raw = res.data?.js?.data || res.data?.js || [];
            let channels = Array.isArray(raw) ? raw : Object.values(raw);

            // Filtragem por Categoria
            if (categoryId !== "0") {
                channels = channels.filter(ch => (ch.category_id || ch.tv_genre_id || "").toString() === categoryId.toString());
            } else {
                channels = channels.slice(0, 250); // Mostra os primeiros 250 se for "Todas"
            }

            return {
                metas: channels.map(ch => ({
                    id: `stalker:${listId}:${ch.id}:${encodeURIComponent(ch.name)}`,
                    name: ch.name || "Canal",
                    type: "tv",
                    poster: ch.logo ? (ch.logo.startsWith('http') ? ch.logo : config.url.replace(/\/$/, "") + "/c/" + ch.logo) : "https://telegra.ph/file/a85d95e09f6e3c0919313.png",
                    posterShape: "square"
                }))
            };
        } catch (e) { return { metas: [] }; }
    }
};

module.exports = addon;

