const express = require('express');
const axios = require('axios');
const addon = require('./addon.cjs');
const app = express();
const path = require('path');

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');
    next();
});

// Serve a página de configuração (index.html)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ROTA DO MANIFEST (A mais importante para instalar)
app.get('/:config/manifest.json', async (req, res) => {
    const manifest = await addon.getManifest(req.params.config);
    res.json(manifest);
});

// ROTA DO CATÁLOGO
app.get('/:config/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { config, type, id, extra } = req.params;
    const extraObj = extra ? Object.fromEntries(new URLSearchParams(extra)) : {};
    res.json(await addon.getCatalog(type, id, extraObj, config));
});

// ROTA DO META (Séries)
app.get('/:config/meta/:type/:id.json', async (req, res) => {
    const { config, type, id } = req.params;
    res.json(await addon.getMeta(type, id, config));
});

// ROTA DO STREAM
app.get('/:config/stream/:type/:id.json', async (req, res) => {
    const { config, type, id } = req.params;
    res.json(await addon.getStreams(type, id, config, req.get('host')));
});

// PROXY DE VÍDEO
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
        } else {
            res.status(500).send("Link indisponível");
        }
    } catch (e) { res.status(500).send("Erro Proxy"); }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor ON na porta ${port}`));

