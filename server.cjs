const express = require("express");
const cors = require("cors");
const http = require("http");
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());

// CONFIGURAÇÃO
app.get("/", (req, res) => res.redirect("/configure"));
app.get("/configure", (req, res) => {
    res.send(`<html><body style="background:#000;color:#fff;text-align:center;font-family:sans-serif;">
        <h2>XuloV Stalker Fix</h2>
        <input id="url" placeholder="Portal URL" style="width:80%;padding:10px;"><br><br>
        <input id="mac" placeholder="MAC Address" style="width:80%;padding:10px;"><br><br>
        <button onclick="install()" style="padding:15px;width:80%;background:#007bff;color:#fff;border:none;">INSTALAR</button>
        <script>
            function install() {
                const config = btoa(JSON.stringify({ lists: [{ url: document.getElementById('url').value, mac: document.getElementById('mac').value, model: "MAG322" }] }));
                window.location.href = "stremio://" + window.location.host + "/" + config + "/manifest.json";
            }
        </script>
    </body></html>`);
});

// ROTAS STREMIO (Mantêm-se iguais)
app.get("/:config/manifest.json", async (req, res) => { res.json(await addon.getManifest(req.params.config)); });
app.get("/:config/catalog/:type/:id/:extra?.json", async (req, res) => { res.json(await addon.getCatalog(req.params.type, req.params.id, {}, req.params.config)); });
app.get("/:config/meta/:type/:id.json", async (req, res) => { res.json(await addon.getMeta(req.params.type, req.params.id, req.params.config)); });
app.get("/:config/stream/:type/:id.json", async (req, res) => { res.json(await addon.getStreams(req.params.type, req.params.id, req.params.config, req.headers.host)); });

// PROXY DE VÍDEO DE ALTA PERFORMANCE
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';
    const lists = addon.parseConfig(config);
    const auth = await addon.authenticate(lists[listIdx]);

    if (!auth) return res.status(401).send("Erro Auth");

    try {
        let cleanId = decodeURIComponent(channelId);
        let action = (type === "movie" || type === "series") ? "create_link" : "create_link";
        let vodParam = (type === "movie" || type === "series") ? "id" : "cmd";
        let cmdValue = (type === "movie" || type === "series") ? cleanId : encodeURIComponent(`ffrt http://localhost/ch/${cleanId}`);

        // 1. Obter o link do portal usando a API
        const apiUrl = `${auth.api}type=${type === 'tv' ? 'itv' : 'vod'}&action=${action}&${vodParam}=${cmdValue}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
        
        const apiRes = await new Promise(resolve => {
            http.get(apiUrl, { headers: auth.authData.headers }, (r) => {
                let data = '';
                r.on('data', d => data += d);
                r.on('end', () => resolve(JSON.parse(data)));
            });
        });

        let streamUrl = apiRes?.js?.cmd || apiRes?.js?.data || apiRes?.js || apiRes?.cmd;
        if (!streamUrl || typeof streamUrl !== 'string') return res.status(404).send("Sem Link");

        let finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").replace(/([^:])(\/\/+)/g, '$1/').trim();
        if (finalUrl.includes('/.?play_token=')) finalUrl = finalUrl.replace('/.', `/${cleanId}`);

        console.log(`[PROXY] Direcionando para: ${finalUrl}`);

        // 2. Proxy de vídeo usando o módulo HTTP nativo (mais rápido e gasta menos RAM)
        const videoReq = http.get(finalUrl, { headers: auth.authData.headers }, (videoRes) => {
            // Repassa os headers importantes para o Stremio não saltar fora
            res.writeHead(videoRes.statusCode, {
                'Content-Type': videoRes.headers['content-type'] || 'video/mp4',
                'Content-Length': videoRes.headers['content-length'],
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*',
                'Transfer-Encoding': 'chunked'
            });
            videoRes.pipe(res);
        });

        videoReq.on('error', (e) => {
            console.error("[ERRO VÍDEO]", e.message);
            res.end();
        });

        req.on('close', () => videoReq.destroy());

    } catch (e) {
        console.error("[FATAL]", e.message);
        res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 XuloV Fix Online`));

