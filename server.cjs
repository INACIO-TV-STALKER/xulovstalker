const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const https = require("https");
const addon = require("./addon.cjs");

// Garante que as conexões subjacentes do Node.js não fecham a meio da TV
const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: Infinity });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: Infinity });
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// A Nova Página de Configuração - INTOCADA
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
                <h2 style="text-align:center">XuloV Multi-Hub (Stalker & Xtream)</h2>
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

                            <label>TIPO DE LISTA</label>
                            <select class="type" onchange="toggleType(this, \${id})">
                                <option value="stalker">Stalker Portal (MAC)</option>
                                <option value="xtream">Xtream Codes (User/Pass)</option>
                            </select>

                            <label>NOME DA LISTA</label>
                            <input type="text" class="name" placeholder="Ex: IPTV Portugal">
                            <label>URL PORTAL / SERVIDOR</label>
                            <input type="text" class="url" placeholder="http://portal.com:8080/c/">

                            <div id="stalker-group-\${id}">
                                <label>MAC ADDRESS</label>
                                <input type="text" class="mac" placeholder="00:1A:79:XX:XX:XX">
                                <label>BOX MODEL</label>
                                <select class="model">
                                    <option value="MAG250">MAG 250</option>
                                    <option value="MAG254">MAG 254</option>
                                    <option value="MAG256">MAG 256</option>
                                    <option value="MAG322">MAG 322</option>
                                </select>
                                <span class="adv-toggle" onclick="toggleAdv(\${id})">Configurações Avançadas</span>
                                <div class="advanced" id="adv-\${id}">
                                    <label>SERIAL NUMBER (SN)</label><input type="text" class="sn">
                                    <label>DEVICE ID 1</label><input type="text" class="id1">
                                    <label>DEVICE ID 2</label><input type="text" class="id2">
                                    <label>SIGNATURE</label><input type="text" class="sig">
                                </div>
                            </div>

                            <div id="xtream-group-\${id}" style="display:none;">
                                <label>USERNAME</label>
                                <input type="text" class="user" placeholder="O teu utilizador Xtream">
                                <label>PASSWORD</label>
                                <input type="text" class="pass" placeholder="A tua password Xtream">
                            </div>
                        </div>\`;
                    document.getElementById('lists-container').insertAdjacentHTML('beforeend', html);
                }

                function removeList(id) {
                    document.getElementById('box-'+id).remove();
                    listCount--;
                }

                function toggleType(selectEl, id) {
                    if (selectEl.value === 'xtream') {
                        document.getElementById('stalker-group-'+id).style.display = 'none';
                        document.getElementById('xtream-group-'+id).style.display = 'block';
                    } else {
                        document.getElementById('stalker-group-'+id).style.display = 'block';
                        document.getElementById('xtream-group-'+id).style.display = 'none';
                    }
                }

                function toggleAdv(id) {
                    const el = document.getElementById('adv-'+id);
                    el.style.display = el.style.display === 'block' ? 'none' : 'block';
                }

                function install() {
                    const boxes = document.querySelectorAll('.list-box');
                    if(boxes.length === 0) return alert("Adiciona pelo menos uma lista!");

                    const lists = Array.from(boxes).map(box => ({
                        type: box.querySelector('.type').value,
                        name: box.querySelector('.name').value.trim(),
                        url: box.querySelector('.url').value.trim(),
                        mac: box.querySelector('.mac').value.trim(),
                        model: box.querySelector('.model').value,
                        sn: box.querySelector('.sn').value.trim(),
                        id1: box.querySelector('.id1').value.trim(),
                        id2: box.querySelector('.id2').value.trim(),
                        sig: box.querySelector('.sig').value.trim(),
                        user: box.querySelector('.user').value.trim(),
                        pass: box.querySelector('.pass').value.trim()
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

// ROTAS DO STREMIO - INTOCADAS
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

app.get("/:config/meta/:type/:id.json", async (req, res) => {
    res.json(await addon.getMeta(req.params.type, req.params.id, req.params.config));
});

app.get("/:config/stream/:type/:id.json", async (req, res) => {
    const host = req.headers.host;
    res.json(await addon.getStreams(req.params.type, req.params.id, req.params.config, host));
});


// 🔥 O PROXY MESTRE - Lida com TV, Filmes (Redirecionamentos) e Xtream Perfeitamente 🔥
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';

    const lists = addon.parseConfig(config);
    const configData = lists[listIdx];
    if (!configData) return res.status(400).end();

    try {
        let finalUrl = "";
        let requestHeaders = { 'Connection': 'keep-alive' };

        // --- 1. LÓGICA XTREAM (Totalmente Intacta) ---
        if (configData.type === 'xtream') {
            const baseUrl = configData.url.replace(/\/$/, "");
            requestHeaders['User-Agent'] = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 27211 Safari/533.3';
            requestHeaders['Accept'] = '*/*';

            if (type === 'movie') {
                finalUrl = `${baseUrl}/movie/${configData.user}/${configData.pass}/${channelId}`;
            } else if (type === 'series') {
                finalUrl = `${baseUrl}/series/${configData.user}/${configData.pass}/${channelId}`;
            } else {
                finalUrl = `${baseUrl}/${configData.user}/${configData.pass}/${channelId}`;
            }
            console.log(`\n[PROXY] Xtream a pedir ${type} ID ${channelId}...`);
        }

        // --- 2. LÓGICA STALKER (Autenticação e Disfarce) ---
        else {
            const auth = await addon.authenticate(configData);
            if (!auth) return res.status(401).end();

            let sUrl = "";
            let stalkerCmd = channelId;

            try {
                stalkerCmd = decodeURIComponent(stalkerCmd);
                if (stalkerCmd.includes('%')) stalkerCmd = decodeURIComponent(stalkerCmd);
            } catch(e) {}

            // VOD e Series exigem o create_link normal
            if (type === "movie" || type === "series") {
                sUrl = `${auth.api}type=vod&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            } else {
                // TV exige ffrt ou o ID direto
                const cmd = encodeURIComponent(stalkerCmd.startsWith('ffrt') ? stalkerCmd : `ffrt http://localhost/ch/${stalkerCmd}`);
                sUrl = `${auth.api}type=itv&action=create_link&cmd=${cmd}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            }

            const linkRes = await axios.get(sUrl, { headers: auth.authData.headers });
            
            // 🔧 MELHORIA: Extração robusta da URL do stream (suporta diferentes estruturas de resposta)
            let streamUrl = null;
            const data = linkRes.data;
            if (data?.js?.cmd) streamUrl = data.js.cmd;
            else if (data?.js?.url) streamUrl = data.js.url;
            else if (data?.cmd) streamUrl = data.cmd;
            else if (data?.url) streamUrl = data.url;
            else if (data?.js && typeof data.js === 'string') streamUrl = data.js;
            else if (typeof data === 'string') streamUrl = data;
            else if (data?.js?.data && typeof data.js.data === 'object') {
                streamUrl = data.js.data.cmd || data.js.data.url;
            }

            if (typeof streamUrl === 'string') {
                finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();

                // 🔧 MELHORIA: Se a URL não começar com http, constrói caminho completo
                if (!finalUrl.startsWith('http')) {
                    const baseServer = configData.url.replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
                    finalUrl = baseServer + (finalUrl.startsWith('/') ? finalUrl : '/' + finalUrl);
                }

                // 🔧 MELHORIA: Para VOD/Series, adiciona token e sn na query string se não estiverem presentes
                if ((type === 'movie' || type === 'series') && auth.token && auth.authData.sn) {
                    try {
                        const urlObj = new URL(finalUrl);
                        if (!urlObj.searchParams.has('token')) urlObj.searchParams.set('token', auth.token);
                        if (!urlObj.searchParams.has('sn')) urlObj.searchParams.set('sn', auth.authData.sn);
                        finalUrl = urlObj.toString();
                    } catch (e) {
                        // Se a URL for inválida, mantém como está
                    }
                }

                // O SEGREDO: Copiar EXATAMENTE a identidade da box gerada no addon.cjs para puxar o vídeo
                requestHeaders = { ...auth.authData.headers, ...requestHeaders };
                console.log(`\n[PROXY] Stalker a pedir ${type} ID ${stalkerCmd}. URL final: ${finalUrl}`);
            } else {
                console.log(`[PROXY] Error: Link final inválido.`);
                return res.status(404).end();
            }
        }

        // --- 3. REPASSE DE VÍDEO SEGURO E COM SUPORTE A FILMES (Axios Configurado Corretamente) ---
        try {
            // Removemos o Timeout para o Stremio não cortar a ligação (mas definimos um timeout alto)
            req.socket.setTimeout(10 * 60 * 1000); // 10 minutos
            req.socket.on('timeout', () => {
                if (!res.headersSent) res.status(504).end();
                req.destroy();
            });

            // CRÍTICO PARA FILMES: Se o Stremio pedir para avançar, passamos esse pedido ao portal
            if (req.headers.range) {
                requestHeaders['Range'] = req.headers.range;
            }

            // A chamada Mestra: usa o axios para seguir redirects (302) nos filmes automaticamente,
            // mas usa 'stream' para não sobrecarregar a memória com a Live TV.
            const videoResponse = await axios({
                method: 'get',
                url: finalUrl,
                headers: requestHeaders,
                responseType: 'stream',
                timeout: 0, // Não timeout na requisição, pois o stream pode ser longo
                maxRedirects: 5,
                validateStatus: false
            });

            if (videoResponse.status >= 400) {
                return res.status(videoResponse.status).end();
            }

            // 🔥 A CORREÇÃO PROFISSIONAL DE HEADERS 🔥
            res.status(videoResponse.status);
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Connection", "keep-alive");

            // 1. Obrigar o Stremio a manter o vídeo dentro do player (aceita seek)
            res.setHeader("Accept-Ranges", "bytes");

            // 2. Forçar o tipo de vídeo correto caso o servidor Stalker não envie
            let contentType = videoResponse.headers['content-type'];
            if (!contentType || contentType === 'application/octet-stream') {
                contentType = type === 'tv' ? "video/mp2t" : "video/mp4";
            }
            res.setHeader("Content-Type", contentType);

            // 3. Repassar tamanhos se existirem (vital para a barra de tempo dos filmes)
            if (videoResponse.headers['content-length']) res.setHeader("Content-Length", videoResponse.headers['content-length']);
            if (videoResponse.headers['content-range']) res.setHeader("Content-Range", videoResponse.headers['content-range']);

            videoResponse.data.pipe(res);

            // 🔧 MELHORIA: Trata erros no stream para não quebrar a ligação silenciosamente
            videoResponse.data.on('error', (err) => {
                console.error(`[PROXY] Erro no stream de vídeo: ${err.message}`);
                if (!res.headersSent) res.status(500).end();
                videoResponse.data.destroy();
            });

            req.on('close', () => {
                if (videoResponse.data) videoResponse.data.destroy();
            });

        } catch (vidErr) {
            console.log(`[PROXY] 💀 Quebra de ligação: ${vidErr.message}`);
            if (!res.headersSent) res.status(500).end();
        }

    } catch (e) {
        console.error(`[PROXY] 💀 Falha Geral: ${e.message}`);
        if (!res.headersSent) res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Tizen Addon Online na porta ${PORT}`));
