const express = require("express");
const cors = require("cors");
const axios = require("axios");
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.get('/favicon.ico', (req, res) => res.status(204).end());

// CONFIGURAÇÃO
app.get("/", (req, res) => res.redirect("/configure"));
app.get("/configure", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html><head><title>XuloV Hub</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; background: #0c0d19; color: white; padding: 20px; text-align: center; }
            .container { max-width: 500px; margin: auto; background: #1b1d30; padding: 30px; border-radius: 15px; }
            input, select { width: 100%; padding: 10px; margin: 5px 0; border-radius: 5px; border: 1px solid #333; background: #222; color: white; box-sizing: border-box; }
            .install-btn { background: #007bff; color: white; border: none; padding: 18px; width: 100%; border-radius: 8px; cursor: pointer; font-weight: bold; margin-top: 10px; }
        </style></head>
        <body>
            <div class="container">
                <h2>🚀 XuloV Stalker Hub</h2>
                <div id="lists-container">
                    <input type="text" id="name" placeholder="Nome da Lista">
                    <input type="text" id="url" placeholder="URL (ex: http://portal.com/c/)">
                    <input type="text" id="mac" placeholder="00:1A:79:XX:XX:XX">
                </div>
                <button class="install-btn" onclick="install()">INSTALAR NO STREMIO</button>
            </div>
            <script>
                function install() {
                    const list = {
                        name: document.getElementById('name').value,
                        url: document.getElementById('url').value,
                        mac: document.getElementById('mac').value,
                        model: "MAG322", sn: "", id1: "", id2: "", sig: ""
                    };
                    const b64 = btoa(JSON.stringify({ lists: [list] }));
                    window.location.href = "stremio://" + window.location.host + "/" + b64 + "/manifest.json";
                }
            </script>
        </body></html>
    `);
});

// ROTAS STREMIO
app.get("/:config/manifest.json", async (req, res) => {
    try { res.json(await addon.getManifest(req.params.config)); } catch(e) { res.status(500).end(); }
});

app.get("/:config/catalog/:type/:id/:extra?.json", async (req, res) => {
    try { res.json(await addon.getCatalog(req.params.type, req.params.id, {}, req.params.config)); } catch(e) { res.status(500).end(); }
});

app.get("/:config/meta/:type/:id.json", async (req, res) => {
    try { res.json(await addon.getMeta(req.params.type, req.params.id, req.params.config)); } catch(e) { res.status(500).end(); }
});

app.get("/:config/stream/:type/:id.json", async (req, res) => {
    try { res.json(await addon.getStreams(req.params.type, req.params.id, req.params.config, req.headers.host)); } catch(e) { res.status(500).end(); }
});

// PROXY DE VÍDEO - VERSÃO "TRANSPARENTE"
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';
    
    const lists = addon.parseConfig(config);
    const configData = lists[listIdx];
    const auth = await addon.authenticate(configData);
    
    if (!auth) return res.status(401).send("Auth Failed");

    try {
        let streamUrl = null;
        let cleanId = decodeURIComponent(channelId);

        if (type === "movie" || type === "series") {
            const vodUrl = `${auth.api}type=vod&action=create_link&id=${cleanId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            const r = await axios.get(vodUrl, { headers: auth.authData.headers });
            streamUrl = r.data?.js?.cmd || r.data?.js?.data || r.data?.js || r.data?.cmd;
        } else {
            const cmd = encodeURIComponent(`ffrt http://localhost/ch/${cleanId}`);
            const tvUrl = `${auth.api}type=itv&action=create_link&cmd=${cmd}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            const r = await axios.get(tvUrl, { headers: auth.authData.headers });
            streamUrl = r.data?.js?.cmd || r.data?.js || r.data?.cmd;
        }

        if (typeof streamUrl === 'string') {
            let finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").replace(/([^:])(\/\/+)/g, '$1/').trim();
            
            // Correção elrinconcito
            if (finalUrl.includes('/.?play_token=')) finalUrl = finalUrl.replace('/.', `/${cleanId}`);

            console.log(`[PROXY] Abrindo: ${finalUrl}`);

            // AQUI ESTÁ O SEGREDO: Usamos EXACTAMENTE os headers da autenticação
            const videoResponse = await axios({
                method: 'get',
                url: finalUrl,
                headers: auth.authData.headers, // Mantém a identidade da Box MAG
                responseType: 'stream',
                timeout: 60000 
            });

            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", videoResponse.headers['content-type'] || "video/mp4");
            
            // Pipe direto sem buffers pesados
            videoResponse.data.pipe(res);

            videoResponse.data.on('error', (err) => {
                console.error("[STREAM ERROR]", err.message);
                res.end();
            });

        } else {
            res.status(404).send("Sem link");
        }
    } catch (e) {
        console.error("[PROXY FATAL]", e.message);
        res.status(500).send("Erro");
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Addon Online`));

