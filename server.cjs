const express = require("express");
const cors = require("cors");
const http = require("http");
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.get('/favicon.ico', (req, res) => res.status(204).end());

// CONFIGURAÇÃO
app.get("/", (req, res) => res.redirect("/configure"));
app.get("/configure", (req, res) => {
    res.send(`<html><body style="background:#000;color:#fff;text-align:center;font-family:sans-serif;padding-top:50px;">
        <h2>🚀 XuloV Stalker Fix v3</h2>
        <input id="url" placeholder="Portal URL (com /c/)" style="width:80%;padding:12px;margin-bottom:10px;border-radius:5px;"><br>
        <input id="mac" placeholder="MAC 00:1A:79:XX:XX:XX" style="width:80%;padding:12px;margin-bottom:10px;border-radius:5px;"><br>
        <button onclick="install()" style="padding:15px;width:80%;background:#28a745;color:#fff;border:none;border-radius:5px;font-weight:bold;">INSTALAR NO STREMIO</button>
        <script>
            function install() {
                const u = document.getElementById('url').value;
                const m = document.getElementById('mac').value;
                if(!u || !m) return alert("Preenche os dados");
                const config = btoa(JSON.stringify({ lists: [{ url: u, mac: m, model: "MAG322" }] }));
                window.location.href = "stremio://" + window.location.host + "/" + config + "/manifest.json";
            }
        </script>
    </body></html>`);
});

// ROTAS STREMIO
app.get("/:config/manifest.json", async (req, res) => { try { res.json(await addon.getManifest(req.params.config)); } catch(e) { res.status(500).end(); } });
app.get("/:config/catalog/:type/:id/:extra?.json", async (req, res) => { try { res.json(await addon.getCatalog(req.params.type, req.params.id, {}, req.params.config)); } catch(e) { res.status(500).end(); } });
app.get("/:config/meta/:type/:id.json", async (req, res) => { try { res.json(await addon.getMeta(req.params.type, req.params.id, req.params.config)); } catch(e) { res.status(500).end(); } });
app.get("/:config/stream/:type/:id.json", async (req, res) => { try { res.json(await addon.getStreams(req.params.type, req.params.id, req.params.config, req.headers.host)); } catch(e) { res.status(500).end(); } });

// PROXY DE VÍDEO ROBUSTO
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';
    const lists = addon.parseConfig(config);
    const auth = await addon.authenticate(lists[listIdx]);

    if (!auth) return res.status(401).send("Auth Fail");

    try {
        let cleanId = decodeURIComponent(channelId);
        let apiUrl = (type === 'tv') 
            ? `${auth.api}type=itv&action=create_link&cmd=${encodeURIComponent('ffrt http://localhost/ch/'+cleanId)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`
            : `${auth.api}type=vod&action=create_link&id=${cleanId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;

        // 1. Obter link
        const apiRes = await new Promise(resolve => {
            http.get(apiUrl, { headers: auth.authData.headers }, (r) => {
                let d = '';
                r.on('data', chunk => d += chunk);
                r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
            }).on('error', () => resolve({}));
        });

        let streamUrl = apiRes?.js?.cmd || apiRes?.js?.data || apiRes?.js || apiRes?.cmd;
        if (!streamUrl || typeof streamUrl !== 'string') return res.status(404).send("Sem Link");

        let finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").replace(/([^:])(\/\/+)/g, '$1/').trim();
        if (finalUrl.includes('/.?play_token=')) finalUrl = finalUrl.replace('/.', `/${cleanId}`);

        console.log(`[PROXY] Abrindo: ${finalUrl}`);

        // 2. Pedido de vídeo com proteção contra valores undefined
        const videoReq = http.get(finalUrl, { headers: auth.authData.headers }, (videoRes) => {
            const responseHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': videoRes.headers['content-type'] || 'video/mp4',
                'Accept-Ranges': 'bytes'
            };

            // Só adiciona Content-Length se ele realmente existir para não crashar
            if (videoRes.headers['content-length']) {
                responseHeaders['Content-Length'] = videoRes.headers['content-length'];
            }

            res.writeHead(videoRes.statusCode || 200, responseHeaders);
            videoRes.pipe(res);
        });

        videoReq.on('error', (e) => {
            console.error("[ERRO VÍDEO]", e.message);
            if (!res.headersSent) res.status(500).end();
        });

        req.on('close', () => videoReq.destroy());

    } catch (e) {
        console.error("[FATAL]", e.message);
        if (!res.headersSent) res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 XuloV Fix Online`));

