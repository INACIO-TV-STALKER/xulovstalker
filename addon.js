// addon.js
require('dotenv').config();
const { addonBuilder } = require('stremio-addon-sdk');
const crypto = require('crypto');
const fetch = require('node-fetch');

const ADDON_NAME = "Xulov Stalker IPTV";
const ADDON_ID = "org.xulovski.stalker-iptv";

module.exports = async function createAddon(config = {}) {
    const manifest = {
        id: ADDON_ID,
        version: "1.0.0",
        name: ADDON_NAME,
        description: "Addon Stalker IPTV: Live TV, VOD, Series, com múltiplas listas e MAC",
        resources: ["catalog", "stream", "meta"],
        types: ["tv", "movie", "series"],
        catalogs: [
            { type: 'tv', id: 'iptv_channels', name: 'TV Ao Vivo', extra: [{ name: 'genre' }, { name: 'search' }] },
            { type: 'movie', id: 'iptv_movies', name: 'Filmes', extra: [{ name: 'search' }] },
            { type: 'series', id: 'iptv_series', name: 'Séries', extra: [{ name: 'genre' }, { name: 'search' }] }
        ],
        idPrefixes: ["stalker_"],
        behaviorHints: {
            configurable: true,
            configurationRequired: true
        }
    };

    const builder = new addonBuilder(manifest);

    // Simples exemplo de lista de canais VOD e Series vazios
    const lists = config.lists || [];

    // Catalog handler
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        let items = [];
        for (const l of lists) {
            if (!l.items) continue;
            items = items.concat(l.items.filter(i => i.type === type));
        }
        // filtro por search
        if (extra?.search) {
            const q = extra.search.toLowerCase();
            items = items.filter(i => i.name.toLowerCase().includes(q));
        }
        // Retorna máximo 200 itens
        return { metas: items.slice(0, 200) };
    });

    // Stream handler
    builder.defineStreamHandler(async ({ type, id }) => {
        for (const l of lists) {
            const found = (l.items || []).find(i => i.id === id);
            if (found) return { streams: [{ title: found.name, url: found.url, behaviorHints: { notWebReady: true } }] };
        }
        return { streams: [] };
    });

    // Meta handler
    builder.defineMetaHandler(async ({ type, id }) => {
        for (const l of lists) {
            const found = (l.items || []).find(i => i.id === id);
            if (found) return { meta: found };
        }
        return { meta: null };
    });

    return builder.getInterface();
};
