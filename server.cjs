const express = require("express");
const cors = require("cors");
const axios = require("axios");
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.get('/favicon.ico', (req, res) => res.status(204).end());

// CONFIGURAÇÃO SIMPLIFICADA
app.get("/", (req, res) => res.redirect("/configure"));
app.get("/configure", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html><head><title>XuloV Hub</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; background: #0c0d19; color: white; padding: 20px; text-align: center; }
            .container { max-width: 400px; margin: auto; background: #1b1d30; padding: 20px; border-radius: 10px; }
            input { width: 100%; padding: 10px; margin: 5px 0; border-radius: 5px; border: 1px solid #333; background: #222; color: white; box-sizing: border-box; }
            .btn { background: #007bff; color: white; border: none; padding: 15px; width: 100%; border-radius: 5px; cursor: pointer; font-weight: bold; margin-top: 10px; }
        </style></head>
        <body>
            <div class="container">
                <h2>🚀 XuloV Stalker</h2>
                <input type="text" id="url" placeholder="URL do Portal (com /c/)">
                <input type="text" id="mac" placeholder="MAC (00:1A:79:XX:XX:XX)">
                <button class="btn" onclick="install()">INSTALAR</button>
            </div>
            <script>
                function install() {
                    const url = document.getElementById('url').value;
                    const mac = document.getElementById('mac').value;
                    if(!url || !mac) return alert("Preenche tudo!");
                    const config = btoa(JSON.stringify({ lists: [{ name: "Portal", url, mac, model: "MAG322" }] }));
                    window.location.href = "stremio://" + window.location.host + "/" + config + "/manifest.json";
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

// PROXY DE VÍDEO COM SUPORTE A RANGE (ESSENCIAL PARA FILMES/SÉRIES)
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';
    
    const lists = addon.parseConfig(config);
    const auth = await addon.authenticate(lists[listIdx]);
    
    if (!auth) return res.status(401).send("Auth Failed");

    try {
        let streamUrl = null;
        let cleanId = decodeURIComponent(channelId);

        // Obter o Link do Portal
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
            if (finalUrl.includes('/.?play_token=')) finalUrl = finalUrl.replace('/.', `/${cleanId}`);

            console.log(`[PROXY] Streaming: ${finalUrl}`);

            // Prepara os headers para o portal (incluindo Range se o Stremio pedir)
            const headers = { ...auth.authData.headers };
            if (req.headers.range) {
                headers['Range'] = req.headers.range;
            }

            const videoResponse = await axios({
                method: 'get',
                url: finalUrl,
                headers: headers,
                responseType: 'stream',
                timeout: 0 // Sem timeout para streams longos
            });

            // Repassa os headers do Portal de volta para o Stremio
            if (videoResponse.headers['content-range']) res.setHeader('Content-Range', videoResponse.headers['content-range']);
            if (videoResponse.headers['content-length']) res.setHeader('Content-Length', videoResponse.headers['content-length']);
            if (videoResponse.headers['accept-ranges']) res.setHeader('Accept-Ranges', videoResponse.headers['accept-ranges']);
            
            res.status(videoResponse.status);
            res.setHeader("Content-Type", videoResponse.headers['content-type'] || "video/mp4");
            
            videoResponse.data.pipe(res);

            req.on('close', () => {
                videoResponse.data.destroy();
            });

        } else {
            res.status(404).send("No link");
        }
    } catch (e) {
        console.error("[PROXY ERROR]", e.message);
        res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 XuloV Hub Online`));

