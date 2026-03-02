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
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0c0d19; color: white; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .box { background: #1b1d30; padding: 30px; border-radius: 15px; width: 90%; max-width: 450px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            h2 { color: #007bff; margin-bottom: 20px; }
            label { display: block; text-align: left; font-size: 12px; color: #aaa; margin-top: 10px; margin-left: 5px; }
            input, select { width: 100%; padding: 12px; margin: 5px 0 15px 0; border-radius: 8px; border: 1px solid #333; background: #222; color: white; box-sizing: border-box; font-size: 14px; }
            input:focus { border-color: #007bff; outline: none; }
            button { width: 100%; padding: 15px; background: #007bff; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px; margin-top: 10px; transition: 0.3s; }
            button:hover { background: #0056b3; }
            .footer { margin-top: 20px; font-size: 11px; color: #666; }
        </style></head>
        <body>
            <div class="box">
                <h2>XuloV Stalker Pro</h2>
                
                <label>NOME DA LISTA (Ex: Minha IPTV)</label>
                <input type="text" id="name" placeholder="Dá um nome a esta lista...">

                <label>URL DO PORTAL (http://...)</label>
                <input type="text" id="url" placeholder="http://exemplo.com:8080/c/">

                <label>ENDEREÇO MAC (00:1A:79:...)</label>
                <input type="text" id="mac" placeholder="00:1A:79:XX:XX:XX">

                <label>MODELO DA BOX (EMULAÇÃO)</label>
                <select id="model">
                    <option value="MAG250">MAG 250 (Antiga/Básica)</option>
                    <option value="MAG254" selected>MAG 254 (Padrão Ouro)</option>
                    <option value="MAG256">MAG 256 (Processamento Rápido)</option>
                    <option value="MAG322">MAG 322 (Estável)</option>
                    <option value="MAG424">MAG 424 (Suporte 4K)</option>
                    <option value="MAG522">MAG 522 (Moderna/HEVC)</option>
                    <option value="WR320">AuraHD (Compatibilidade Extra)</option>
                </select>

                <button onclick="instalar()">🚀 INSTALAR NO STREMIO</button>
                <div class="footer">Otimizado para Samsung Tizen & Android</div>
            </div>

            <script>
                function instalar() {
                    const name = document.getElementById('name').value.trim() || "Stalker IPTV";
                    const url = document.getElementById('url').value.trim();
                    const mac = document.getElementById('mac').value.trim();
                    const model = document.getElementById('model').value;

                    if(!url || !mac) return alert("Por favor, preenche o URL e o MAC!");

                    // Criamos o objeto de configuração incluindo o Nome
                    const config = { name, url, mac, model };
                    const b64 = btoa(JSON.stringify(config));
                    
                    // Redireciona para o protocolo do Stremio
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

            // NOVA LÓGICA DE VÍDEO: O Axios segue redirecionamentos (302) automaticamente!
            try {
                const videoResponse = await axios({
                    method: 'get',
                    url: finalUrl,
                    headers: auth.authData.headers,
                    responseType: 'stream', // Fundamental para não rebentar a memória do Render
                    maxRedirects: 5
                });

                res.setHeader("Access-Control-Allow-Origin", "*");
                // Em vez de forçar um formato, deixamos o portal ditar o tipo correto (HLS ou TS)
                res.setHeader("Content-Type", videoResponse.headers['content-type'] || "video/mp2t");

                // Envia o fluxo de vídeo para a TV
                videoResponse.data.pipe(res);

            } catch (vidErr) {
                console.log("Erro no stream:", vidErr.message);
                res.status(500).end();
            }

        } else {
            res.status(404).end();
        }
    } catch (e) {
        res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Tizen Addon Online na porta ${PORT}`));

