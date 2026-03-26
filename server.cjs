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

app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';
    const lists = addon.parseConfig(config);
    const configData = lists[listIdx];
    if (!configData) return res.status(400).end();

    // 💡 LISTA NEGRA: Servidores que cortam aos 30 segundos (TV ou Filmes)
    const servidoresComBloqueio = [
        'elrinconcito', 
        'luzentreaoceanos', 
        'p1d5753'
    ];

    // Verifica se este servidor atual precisa de tratamento especial
    const precisaDeProxy = servidoresComBloqueio.some(s => configData.url.toLowerCase().includes(s));

    try {
        let finalUrl = "";
        let requestHeaders = { 
            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 27211 Safari/533.3',
            // NOVIDADE: Se for servidor da lista negra, usamos 'close' MESMO NA TV para evitar a queda
            'Connection': precisaDeProxy ? 'close' : 'keep-alive' 
        };

        if (configData.type === 'xtream') {
            const baseUrl = configData.url.replace(/\/$/, "");
            requestHeaders['User-Agent'] = 'VLC/3.0.18 LibVLC/3.0.18';
            finalUrl = type === 'tv' ? `${baseUrl}/${configData.user}/${configData.pass}/${channelId}` : 
                       type === 'movie' ? `${baseUrl}/movie/${configData.user}/${configData.pass}/${channelId}` :
                       `${baseUrl}/series/${configData.user}/${configData.pass}/${channelId}`;
            return res.redirect(302, finalUrl);
        } 
        else {
            const auth = await addon.authenticate(configData);
            if (!auth) return res.status(401).end();

            requestHeaders['User-Agent'] = auth.authData.headers['User-Agent'];
            requestHeaders['Cookie'] = auth.authData.headers['Cookie'];
            requestHeaders['X-User-Agent'] = auth.authData.headers['X-User-Agent'];
            requestHeaders['Referer'] = configData.url.replace(/\/$/, "") + "/c/";

            let stalkerCmd = decodeURIComponent(channelId);
            let sUrl = "";
            
            if (type === "movie" || type === "series") {
                sUrl = `${auth.api}type=vod&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            } else {
                const cmd = encodeURIComponent(stalkerCmd.startsWith('ffrt') ? stalkerCmd : `ffrt http://localhost/ch/${stalkerCmd}`);
                sUrl = `${auth.api}type=itv&action=create_link&cmd=${cmd}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            }

            const linkRes = await axios.get(sUrl, { headers: auth.authData.headers });
            let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;

            if (typeof streamUrl === 'string') {
                let cleanUrl = streamUrl.trim();
                if (cleanUrl.includes('http://localhost/ch/')) {
                    const parts = cleanUrl.split('http://localhost/ch/');
                    finalUrl = parts[0].replace(/ffmpeg\s*$/, "").trim() + '/' + parts[1].trim();
                } else {
                    finalUrl = cleanUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                }
                if (!finalUrl.startsWith('http')) {
                    const baseServer = configData.url.replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
                    finalUrl = baseServer + (finalUrl.startsWith('/') ? finalUrl : '/' + finalUrl);
                }
            }
        }

        if (!finalUrl) return res.status(404).end();

        // Se for VOD e NÃO estiver na lista negra, Redirect direto (Poupa Render)
        if ((type === 'movie' || type === 'series') && !precisaDeProxy) {
            return res.redirect(302, finalUrl);
        }

        // Para TV ou Servidores Problemáticos -> PROXY
        console.log(`[STABILITY MODE] A servir ${type} via Proxy (${precisaDeProxy ? 'Safe-Close' : 'Keep-Alive'}): ${finalUrl}`);
        
        if (req.headers.range) requestHeaders['Range'] = req.headers.range;

        const videoResponse = await axios({
            method: 'get',
            url: finalUrl,
            headers: requestHeaders,
            responseType: 'stream',
            timeout: 0,
            maxRedirects: 5,
            validateStatus: false
        });

        if (videoResponse.status >= 400) return res.redirect(302, finalUrl);

        res.status(videoResponse.status);
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (videoResponse.headers['content-type']) res.setHeader("Content-Type", videoResponse.headers['content-type']);
        if (videoResponse.headers['content-length']) res.setHeader("Content-Length", videoResponse.headers['content-length']);
        if (videoResponse.headers['content-range']) res.setHeader("Content-Range", videoResponse.headers['content-range']);
        res.setHeader("Accept-Ranges", "bytes");

        videoResponse.data.pipe(res);
        req.on('close', () => { if (videoResponse.data) videoResponse.data.destroy(); });

    } catch (e) {
        console.error(`[PROXY ERROR] ${e.message}`);
        if (!res.headersSent) res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Tizen Addon Online na porta ${PORT}`));
