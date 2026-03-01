const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const https = require("https");
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// A Nova Página de Configuração (Gera o link Base64)
app.get("/", (req, res) => res.redirect("/configure"));
app.get("/configure", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html><head><title>XuloV Tizen Config</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; background: #0c0d19; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .box { background: #1b1d30; padding: 30px; border-radius: 10px; width: 90%; max-width: 400px; text-align: center; }
            input, select { width: 100%; padding: 12px; margin: 10px 0; border-radius: 5px; border: 1px solid #444; background: #222; color: white; box-sizing: border-box; }
            button { width: 100%; padding: 15px; background: #007bff; color: white; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; }
        </style></head>
        <body>
            <div class="box">
                <h2>Portal Stalker (Tizen)</h2>
                <input type="text" id="url" placeholder="URL do Portal (http://...)">
                <input type="text" id="mac" placeholder="MAC (00:1A:...)">
                <select id="model">
                    <option value="MAG254">MAG 254</option>
                    <option value="MAG322" selected>MAG 322</option>
                </select>
                <button onclick="instalar()">INSTALAR NO STREMIO</button>
            </div>
            <script>
                function instalar() {
                    const url = document.getElementById('url').value.trim();
                    const mac = document.getElementById('mac').value.trim();
                    const model = document.getElementById('model').value;
                    if(!url || !mac) return alert("Preenche tudo!");
                    const config = { url, mac, model };
                    const b64 = btoa(JSON.stringify(config));
                    window.location.href = "stremio://" + window.location.host + "/" + b64 + "/manifest.json";
                }
            </script>
        </body></html>
    `);
});

// ROTAS DO STREMIO
app.get("/:config/manifest.json", async (req, res) => {
    res.json(await addon.getManifest(req.params.config));
});

app.get("/:config/catalog/:type/:id/:extra?.json", async (req, res) => {
    const { config, type, id, extra } = req.params;
    let extraObj = {};
    if (extra) {
        extra.replace(".json", "").split("&").forEach(p => {
            const [k, v] = p.split("=");
            if (k && v) extraObj[k] = decodeURIComponent(v);
        });
    }
    res.json(await addon.getCatalog(type, id, extraObj, config));
});

app.get("/:config/meta/:type/:id.json", (req, res) => {
    const parts = req.params.id.split(":");
    let channelName = parts.length >= 4 ? decodeURIComponent(parts[3]) : "Canal IPTV";
    res.json({ meta: { id: req.params.id, type: "tv", name: channelName, posterShape: "square" } });
});

app.get("/:config/stream/:type/:id.json", async (req, res) => {
    const host = req.headers.host;
    res.json(await addon.getStreams(req.params.type, req.params.id, req.params.config, host));
});

// O SEGREDO PARA A TIZEN TV (Faz o pipe do vídeo com cabeçalhos corretos)
app.get("/proxy/:config/:channelId", async (req, res) => {
    const { config, channelId } = req.params;
    const configData = addon.parseConfig(config);
    if (!configData) return res.status(400).end();

    const auth = await addon.authenticate(configData.url, configData);
    if (!auth) return res.status(401).end();

    try {
        const cmd = encodeURIComponent(`ffrt http://localhost/ch/${channelId}`);
        const sUrl = `${auth.api}type=itv&action=create_link&cmd=${cmd}&sn=${auth.authData.sn}&JsHttpRequest=1-0`;
        const linkRes = await axios.get(sUrl, { headers: auth.authData.headers });
        
        let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;
        if (typeof streamUrl === 'string') {
            const finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
            console.log(`[PROXY] Tizen TV a pedir canal ${channelId}...`);

            // Headers críticos para a Samsung TV
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "video/mp2t");

            const protocol = finalUrl.startsWith("https") ? https : http;
            const videoReq = protocol.get(finalUrl, { headers: auth.authData.headers }, (vRes) => {
                res.writeHead(vRes.statusCode, vRes.headers);
                vRes.pipe(res);
            });

            videoReq.on('error', () => res.status(500).end());
            req.on('close', () => videoReq.destroy());
        } else {
            res.status(404).end();
        }
    } catch (e) {
        res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Tizen Addon Online na porta ${PORT}`));

