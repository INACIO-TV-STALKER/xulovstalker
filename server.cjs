const express = require('express');
const axios = require('axios');
const addon = require('./addon.cjs');
const app = express();
const path = require('path');
const fs = require('fs');

// Permite que o Stremio aceda ao Addon sem bloqueios
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (!req.path.includes('proxy')) res.setHeader('Content-Type', 'application/json');
    next();
});

// CORREÇÃO DO ERRO DO LOG: Procura o index.html de forma inteligente
app.get('/', (req, res) => {
    const paths = [
        path.join(__dirname, 'public', 'index.html'),
        path.join(__dirname, 'index.html')
    ];
    const filePath = paths.find(p => fs.existsSync(p));
    if (filePath) {
        res.setHeader('Content-Type', 'text/html');
        res.sendFile(filePath);
    } else {
        res.status(404).send("Erro: Ficheiro index.html nao encontrado no GitHub.");
    }
});

// ROTA DO MANIFEST (Onde o Stremio "instala")
app.get('/:config/manifest.json', async (req, res) => {
    try {
        const manifest = await addon.getManifest(req.params.config);
        res.json(manifest);
    } catch (e) { res.status(500).json({ error: "Erro no Manifest" }); }
});

// ROTA DO CATÁLOGO (Canais, Filmes e Séries)
app.get('/:config/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { config, type, id, extra } = req.params;
    const extraObj = extra ? Object.fromEntries(new URLSearchParams(extra.replace('.json', ''))) : {};
    try {
        const catalog = await addon.getCatalog(type, id.replace('.json', ''), extraObj, config);
        res.json(catalog);
    } catch (e) { res.json({ metas: [] }); }
});

// ROTA DO META (Episódios de Séries)
app.get('/:config/meta/:type/:id.json', async (req, res) => {
    try {
        const meta = await addon.getMeta(req.params.type, req.params.id.replace('.json', ''), req.params.config);
        res.json(meta);
    } catch (e) { res.json({ meta: {} }); }
});

// ROTA DO STREAM (Links de reprodução)
app.get('/:config/stream/:type/:id.json', async (req, res) => {
    try {
        const streams = await addon.getStreams(req.params.type, req.params.id.replace('.json', ''), req.params.config, req.get('host'));
        res.json(streams);
    } catch (e) { res.json({ streams: [] }); }
});

// PROXY DE VÍDEO (Onde o vídeo realmente toca)
app.get('/proxy/:config/:listIdx/:channelId', async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';
    const lists = addon.parseConfig(config);
    const auth = await addon.authenticate(lists[parseInt(listIdx)]);
    if (!auth) return res.status(401).send("Erro Auth");
    try {
        const action = type === 'movie' ? 'get_vod_uri' : 'create_link';
        const param = type === 'movie' ? `id=${channelId}` : `cmd=${channelId.includes(' ') ? encodeURIComponent(channelId) : 'ffrt%20'+channelId}`;
        const url = `${auth.api}type=itv&action=${action}&${param}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
        const streamRes = await axios.get(url, { headers: auth.authData.headers });
        const videoUrl = streamRes.data?.js?.cmd || streamRes.data?.js;
        if (videoUrl && typeof videoUrl === 'string') {
            res.redirect(videoUrl.replace(/ffrt /g, "").replace(/ffmpeg /g, ""));
        } else { res.status(500).send("Link indisponível"); }
    } catch (e) { res.status(500).send("Erro Proxy"); }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Servidor ON na porta ${port}`));

