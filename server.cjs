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

// A Nova Página de Configuração (Gera o link Base64) - INTACTA
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
                                <option value="MAG250">MAG 250</option>
                                <option value="MAG254">MAG 254</option>
                                <option value="MAG256">MAG 256</option>
                                <option value="MAG322">MAG 322</option>
                                <option value="MAG424">MAG 424</option>
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

                addList(); 
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

// ADICIONADO: Agora a rota Meta chama a função do addon para carregar episódios de Séries
app.get("/:config/meta/:type/:id.json", async (req, res) => {
    res.json(await addon.getMeta(req.params.type, req.params.id, req.params.config));
});

app.get("/:config/stream/:type/:id.json", async (req, res) => {
    const host = req.headers.host;
    res.json(await addon.getStreams(req.params.type, req.params.id, req.params.config, host));
});

// O SEGREDO PARA A TIZEN TV - ADICIONADO: Suporte para VOD (Filmes/Séries)
// PROXY DE VÍDEO (Corrigido para Filmes e Séries)
// PROXY DE VÍDEO (Versão 2.0 - Corrigida para Filmes e Séries)
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';

    const lists = addon.parseConfig(config);
    const configData = lists[listIdx];
    if (!configData) return res.status(400).send("Configuração inválida");

    const auth = await addon.authenticate(configData);
    if (!auth) return res.status(401).send("Falha na Autenticação");

    try {
        let sUrl = "";
        
        // DISTINÇÃO ENTRE TV E VOD (Filmes/Séries)
        if (type === "movie" || type === "series") {
            // Tentamos primeiro a ação padrão de VOD: get_vod_uri
            sUrl = `${auth.api}type=vod&action=get_vod_uri&id=${channelId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
        } else {
            // Lógica original de TV que já tinhas a funcionar
            const cmd = encodeURIComponent(`ffrt http://localhost/ch/${channelId}`);
            sUrl = `${auth.api}type=itv&action=create_link&cmd=${cmd}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
        }

        const linkRes = await axios.get(sUrl, { headers: auth.authData.headers });
        
        // O Stalker pode devolver o link em 'cmd' ou diretamente no 'js'
        let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;
        
        // Se a primeira tentativa de VOD falhar (devolver nulo), tentamos o create_link normal
        if (!streamUrl && (type === "movie" || type === "series")) {
             const altUrl = `${auth.api}type=vod&action=create_link&id=${channelId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
             const altRes = await axios.get(altUrl, { headers: auth.authData.headers });
             streamUrl = altRes.data?.js?.cmd || altRes.data?.js;
        }

        if (typeof streamUrl === 'string') {
            // Limpa protocolos de streaming internos (ffrt, ffmpeg, etc)
            const finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
            console.log(`[PROXY] A reproduzir ${type}: ${finalUrl}`);

            // Realiza o "Pipe" do vídeo mantendo os Headers da MAG
            const videoResponse = await axios({
                method: 'get',
                url: finalUrl,
                headers: auth.authData.headers, // Crucial: Envia o User-Agent e Cookie da MAG
                responseType: 'stream',
                maxRedirects: 5,
                timeout: 20000 // Aumentado para filmes pesados
            });

            // Define os headers de resposta para o Stremio/Tizen
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", videoResponse.headers['content-type'] || "video/mp4");
            
            videoResponse.data.pipe(res);

        } else {
            console.log(`[ERRO] O servidor Stalker não libertou o link para o ID: ${channelId}`);
            res.status(404).send("Link não encontrado no servidor");
        }
    } catch (e) {
        console.error(`[ERRO PROXY]: ${e.message}`);
        res.status(500).send("Erro ao processar o vídeo");
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Tizen Addon Online na porta ${PORT}`));

