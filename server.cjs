const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const https = require("https");
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 3000;
const app = express();

// Criar agente HTTPS que ignora certificados autoassinados
const httpsAgent = new https.Agent({ rejectUnauthorized: false }); // <-- ADICIONADO

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
        <html><head><title>XuloV Hub Config</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; background: #0c0d19; color: white; padding: 20px; }
            .container { max-width: 500px; margin: auto; }
            .list-box { background: #1b1d30; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 5px solid #007bff; position: relative; }
            h3 { margin-top: 0; color: #007bff; font-size: 16px; }
            label { display: block; font-size: 11px; color: #888; margin-top: 8px; font-weight: bold; }
            input, select { width: 100%; padding: 10px; margin: 4px 0; border-radius: 6px; border: 1px solid #333; background: #222; color: white; box-sizing: border-box; }
            .remove-btn { position: absolute; top: 10px; right: 10px; color: #ff4444; cursor: pointer; font-size: 12px; font-weight: bold; }
            .add-btn { background: #28a745; color: white; border: none; padding: 12px; width: 100%; border-radius: 8px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
            .install-btn { background: #007bff; color: white; border: none; padding: 18px; width: 100%; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 18px; }
            .advanced { display: none; background: #141526; padding: 10px; border-radius: 8px; margin-top: 10px; }
            .adv-toggle { color: #007bff; font-size: 12px; cursor: pointer; text-decoration: underline; margin-top: 5px; display: block; }
        </style></head>
        <body>
            <div class="container">
                <h2 style="text-align:center">XuloV Stalker Hub</h2>
                <div id="lists-container"></div>
                <button class="add-btn" onclick="addList()">+ Adicionar Nova Lista (Máx 5)</button>
                <button class="install-btn" onclick="install()">🚀 INSTALAR NO STREMIO</button>
            </div>

            <script>
                let listCount = 0;

                function addList() {
                    if(listCount >= 5) return alert("Máximo de 5 listas atingido!");
                    listCount++;
                    const id = Date.now();
                    const html = \`
                        <div class="list-box" id="box-\${id}">
                            <div class="remove-btn" onclick="removeList(\${id})">REMOVER</div>
                            <h3>LISTA #\${listCount}</h3>
                            <label>NOME DA LISTA</label>
                            <input type="text" class="name" placeholder="Ex: IPTV Portugal">
                            <label>URL PORTAL</label>
                            <input type="text" class="url" placeholder="http://portal.com:8080/c/">
                            <label>MAC ADDRESS</label>
                            <input type="text" class="mac" placeholder="00:1A:79:XX:XX:XX">
                            <label>BOX MODEL</label>
                            <select class="model">
                                <option value="MAG254">MAG 254</option>
                                <option value="MAG322">MAG 322</option>
                                <option value="MAG522">MAG 522</option>
                            </select>
                            <span class="adv-toggle" onclick="toggleAdv(\${id})">Configurações Avançadas</span>
                            <div class="advanced" id="adv-\${id}">
                                <label>SERIAL NUMBER (SN)</label><input type="text" class="sn">
                                <label>DEVICE ID 1</label><input type="text" class="id1">
                                <label>DEVICE ID 2</label><input type="text" class="id2">
                                <label>SIGNATURE</label><input type="text" class="sig">
                            </div>
                        </div>\`;
                    document.getElementById('lists-container').insertAdjacentHTML('beforeend', html);
                }

                function removeList(id) {
                    document.getElementById('box-'+id).remove();
                    listCount--;
                }

                function toggleAdv(id) {
                    const el = document.getElementById('adv-'+id);
                    el.style.display = el.style.display === 'block' ? 'none' : 'block';
                }

                function install() {
                    const boxes = document.querySelectorAll('.list-box');
                    if(boxes.length === 0) return alert("Adiciona pelo menos uma lista!");

                    const lists = Array.from(boxes).map(box => ({
                        name: box.querySelector('.name').value.trim(),
                        url: box.querySelector('.url').value.trim(),
                        mac: box.querySelector('.mac').value.trim(),
                        model: box.querySelector('.model').value,
                        sn: box.querySelector('.sn').value.trim(),
                        id1: box.querySelector('.id1').value.trim(),
                        id2: box.querySelector('.id2').value.trim(),
                        sig: box.querySelector('.sig').value.trim()
                    }));

                    const config = { lists };
                    const b64 = btoa(JSON.stringify(config));
                    window.location.href = "stremio://" + window.location.host + "/" + b64 + "/manifest.json";
                }

                addList(); // Inicia com uma lista
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

// ROTA DO STREAM
app.get("/:config/stream/:type/:id.json", async (req, res) => {
    const host = req.headers.host;
    const streams = await addon.getStreams(req.params.type, req.params.id, req.params.config, host);
    res.json(streams);
});

// ROTA DO PROXY CORRIGIDA
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    
    try {
        const lists = addon.parseConfig(config);
        const configData = lists[parseInt(listIdx)];

        if (!configData) return res.status(404).send("Lista não encontrada");

        const auth = await addon.authenticate(configData);
        if (!auth) return res.status(401).send("Falha na autenticação do Portal");

        // 1. Pedir o link real ao portal
        const cmd = `ffrt ${channelId}`;
        const sUrl = `${auth.api}type=itv&action=create_link&cmd=${encodeURIComponent(cmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;

        const linkRes = await axios.get(sUrl, { headers: auth.authData.headers, httpsAgent });
        let streamUrl = linkRes.data?.js?.data || linkRes.data?.js || "";

        if (streamUrl && typeof streamUrl === 'string') {
            const finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|rtmp)\s+/, "").trim();

            // 2. Criar a conexão com o fluxo de vídeo
            const videoResponse = await axios({
                method: 'get',
                url: finalUrl,
                headers: {
                    'User-Agent': auth.authData.headers['User-Agent'],
                    'Cookie': auth.authData.headers['Cookie']
                },
                responseType: 'stream',
                timeout: 20000,
                httpsAgent
            });

            // 3. Repassar os headers e o fluxo de dados para o Stremio
            res.setHeader("Content-Type", videoResponse.headers['content-type'] || "video/mp2t");
            
            // O .pipe() faz o vídeo fluir sem carregar tudo na memória do Render
            videoResponse.data.pipe(res);

            // Se o cliente (Stremio) fechar a conexão, paramos de baixar o vídeo
            req.on('close', () => {
                videoResponse.data.destroy();
            });

        } else {
            res.status(404).send("URL de stream não encontrado no portal");
        }
    } catch (e) {
        console.error("Erro no Túnel Proxy:", e.message);
        if (!res.headersSent) res.status(500).send("Erro interno no túnel");
    }

});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Tizen Addon Online na porta ${PORT}`));
