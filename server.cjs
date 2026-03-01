const express = require("express");
const cors = require("cors");
const axios = require("axios");
const addon = require("./addon.cjs");

const app = express();

app.use(cors());
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    next();
});

app.get("/", (req, res) => res.redirect("/configure"));

app.get("/configure", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>XuloV Stalker Config</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: sans-serif; background: #0c0d19; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .box { background: #1b1d30; padding: 30px; border-radius: 10px; width: 90%; max-width: 400px; text-align: center; }
                input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 5px; border: 1px solid #444; background: #222; color: white; box-sizing: border-box; }
                button { width: 100%; padding: 15px; background: #8e44ad; color: white; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; }
            </style>
        </head>
        <body>
            <div class="box">
                <h2>Portal Stalker</h2>
                <input type="text" id="url" placeholder="URL (http://...)">
                <input type="text" id="mac" placeholder="MAC (00:1A:...)">
                <button onclick="instalar()">INSTALAR NO STREMIO</button>
            </div>
            <script>
                function instalar() {
                    const url = document.getElementById('url').value.trim();
                    const mac = document.getElementById('mac').value.trim();
                    if(!url || !mac) return alert("Preenche tudo!");
                    const config = { url, mac, model: 'MAG254' };
                    const b64 = btoa(JSON.stringify(config));
                    window.location.href = "stremio://" + window.location.host + "/" + b64 + "/manifest.json";
                }
            </script>
        </body>
        </html>
    `);
});

app.get("/:config/manifest.json", async (req, res) => {
    const manifest = await addon.getManifest(req.params.config);
    res.json(manifest);
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
    const catalog = await addon.getCatalog(type, id, extraObj, config);
    res.json(catalog);
});

app.get("/:config/stream/:type/:id.json", async (req, res) => {
    const { id, config } = req.params;
    const streams = await addon.getStreams("tv", id, config);
    
    if (streams.streams && streams.streams.length > 0) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers.host;
        const channelId = id.split(":")[2];
        // CODIGO CORRIGIDO ABAIXO (Sem as barras invertidas)
        streams.streams[0].url = `${protocol}://${host}/proxy/${config}/${channelId}`;
    }
    res.json(streams);
});

app.get("/proxy/:config/:channelId", async (req, res) => {
    const { config, channelId } = req.params;
    const configData = addon.parseConfig(config);
    const auth = await addon.authenticate(configData);
    if (!auth) return res.status(500).send("Erro Portal");

    try {
        const linkUrl = `${auth.apiUrl}type=itv&action=create_link&cmd=ffrt%20http://localhost/ch/${channelId}&JsHttpRequest=1-0&token=${auth.token}`;
        const linkRes = await axios.get(linkUrl, { headers: auth.headers });
        const realStreamUrl = linkRes.data?.js?.cmd || linkRes.data?.cmd;
        if (realStreamUrl) res.redirect(realStreamUrl);
        else res.status(404).send("Offline");
    } catch (err) { res.status(500).send("Erro"); }
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Online na porta ${port}`));

