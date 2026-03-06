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
// PROXY DE VÍDEO - VERSÃO BLINDADA (AUTO-REAUTH + MAG HEADERS)
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';

    const lists = addon.parseConfig(config);
    const configData = lists[listIdx];
    if (!configData) return res.status(400).end();

    // Função interna para tentar abrir o vídeo
    const tryStream = async (isRetry = false) => {
        const auth = await addon.authenticate(configData, isRetry); // Forçamos refresh se for retry
        if (!auth) return res.status(401).end();

        try {
            let cleanId = decodeURIComponent(channelId);
            let sUrl = (type === "movie" || type === "series")
                ? `${auth.api}type=vod&action=create_link&cmd=${encodeURIComponent(cleanId)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`
                : `${auth.api}type=itv&action=create_link&cmd=${encodeURIComponent('ffrt http://localhost/ch/'+cleanId)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;

            const linkRes = await axios.get(sUrl, { headers: auth.authData.headers, timeout: 10000 });
            let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;

            if (!streamUrl && type === "movie") {
                const altUrl = `${auth.api}type=vod&action=get_vod_uri&id=${cleanId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const altRes = await axios.get(altUrl, { headers: auth.authData.headers, timeout: 10000 });
                streamUrl = altRes.data?.js?.cmd || altRes.data?.js;
            }

            if (typeof streamUrl !== 'string') return res.status(404).end();

            let finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").replace(/([^:])(\/\/+)/g, '$1/').trim();
            if (finalUrl.includes('/.?play_token=')) finalUrl = finalUrl.replace('/.', `/${cleanId}`);

            console.log(`[PROXY] Abrindo (${isRetry ? 'RETRY' : 'OPEN'}): ${finalUrl}`);

            // HEADERS AVANÇADOS DE BOX MAG
            const videoHeaders = {
                'User-Agent': 'StrateM/1.0.0 (compatible; MAG254; Queen; Linux/2.6.23)',
                'X-User-Agent': 'Model: MAG254; Version: 2.20.0-r19-254',
                'Accept': '*/*',
                'Referer': configData.url,
                'Connection': 'keep-alive',
                'Cookie': auth.authData.headers['Cookie'] || ''
            };
            
            if (req.headers.range) videoHeaders['Range'] = req.headers.range;

            const client = finalUrl.startsWith('https') ? https : http;

            const videoReq = client.get(finalUrl, { headers: videoHeaders }, (videoRes) => {
                const contentType = videoRes.headers['content-type'] || '';

                // Se o portal responder com JSON (Erro escondido)
                if (contentType.includes('json') || contentType.includes('text/html')) {
                    let body = '';
                    videoRes.on('data', chunk => body += chunk);
                    videoRes.on('end', () => {
                        console.log(`[PORTAL RES] ${body.substring(0, 100)}`);
                        // Se o token falhou e ainda não tentámos de novo, fazemos re-auth
                        if (!isRetry && (body.includes('TOKEN_INVALID') || body.includes('expired'))) {
                            console.log("[PROXY] Token falhou. A tentar re-autenticação automática...");
                            return tryStream(true); 
                        }
                        res.status(500).end();
                    });
                    return;
                }

                // Seguir redirecionamentos (302)
                if (videoRes.statusCode >= 300 && videoRes.statusCode < 400 && videoRes.headers.location) {
                    return res.redirect(videoRes.headers.location);
                }

                // Configuração de Resposta para Samsung
                const responseHeaders = {
                    'Access-Control-Allow-Origin': '*',
                    'Accept-Ranges': 'bytes',
                    'Content-Type': contentType || (type === 'tv' ? 'video/mp2t' : 'video/mp4'),
                    'Cache-Control': 'no-cache'
                };

                if (videoRes.headers['content-length']) responseHeaders['Content-Length'] = videoRes.headers['content-length'];
                if (videoRes.headers['content-range']) responseHeaders['Content-Range'] = videoRes.headers['content-range'];

                let finalStatus = videoRes.statusCode;
                if (finalStatus === 200 && req.headers.range) finalStatus = 206;

                res.writeHead(finalStatus, responseHeaders);
                videoRes.pipe(res);
            });

            videoReq.on('error', (e) => {
                console.log(`[ERRO] ${e.message}`);
                res.status(500).end();
            });

            req.on('close', () => videoReq.destroy());

        } catch (e) {
            console.log(`Erro Proxy: ${e.message}`);
            res.status(500).end();
        }
    };

    tryStream(); // Inicia a tentativa
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Tizen Addon Online na porta ${PORT}`));

