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
            
            /* Novo estilo para o Proxy */
            .proxy-section { margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid #333; }
            .proxy-toggle { display: flex; align-items: center; cursor: pointer; font-size: 12px; color: #00d1b2; font-weight: bold; }
            .proxy-toggle input { width: 16px; height: 16px; margin-right: 8px; cursor: pointer; }
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
                    // Usar um ID aleatório mais seguro para evitar conflitos
                    const id = Date.now() + Math.floor(Math.random() * 1000);
                    const html = \`
                        <div class="list-box" id="box-\${id}">
                            <div class="remove-btn" onclick="removeList('\${id}')">REMOVER</div>
                            <h3>LISTA #\${listCount}</h3>

                            <label>TIPO DE LISTA</label>
                            <select class="type" onchange="toggleType(this, '\${id}')">
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

                                <div class="proxy-section">
                                    <label class="proxy-toggle">
                                        <input type="checkbox" class="use-proxy" onchange="document.getElementById('p-input-\${id}').style.display = this.checked ? 'block' : 'none'">
                                        🛡️ ADICIONAR PERFIL PROXY / VPN
                                    </label>
                                    <div id="p-input-\${id}" style="display:none; margin-top:5px;">
                                        <input type="text" class="proxy-url" placeholder="http://user:pass@ip:porta">
                                    </div>
                                </div>

                                <span class="adv-toggle" onclick="toggleAdv('\${id}')">Configurações Avançadas</span>
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
                                
                                <div class="proxy-section">
                                    <label class="proxy-toggle">
                                        <input type="checkbox" class="use-proxy-xtream" onchange="document.getElementById('p-xt-input-\${id}').style.display = this.checked ? 'block' : 'none'">
                                        🛡️ ADICIONAR PERFIL PROXY / VPN
                                    </label>
                                    <div id="p-xt-input-\${id}" style="display:none; margin-top:5px;">
                                        <input type="text" class="proxy-url-xtream" placeholder="http://user:pass@ip:porta">
                                    </div>
                                </div>
                            </div>
                        </div>\`;
                    document.getElementById('lists-container').insertAdjacentHTML('beforeend', html);
                }

                function removeList(id) {
                    document.getElementById('box-'+id).remove();
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

                    try {
                        const lists = Array.from(boxes).map(box => {
                            const type = box.querySelector('.type').value;
                            let item = {
                                type: type,
                                name: box.querySelector('.name').value.trim(),
                                url: box.querySelector('.url').value.trim()
                            };

                            if(type === 'stalker') {
                                item.mac = box.querySelector('.mac').value.trim();
                                item.model = box.querySelector('.model').value;
                                item.sn = box.querySelector('.sn').value.trim();
                                item.id1 = box.querySelector('.id1').value.trim();
                                item.id2 = box.querySelector('.id2').value.trim();
                                item.sig = box.querySelector('.sig').value.trim();
                                
                                const pCheck = box.querySelector('.use-proxy');
                                if(pCheck && pCheck.checked) {
                                    item.proxy = box.querySelector('.proxy-url').value.trim();
                                }
                            } else {
                                item.user = box.querySelector('.user').value.trim();
                                item.pass = box.querySelector('.pass').value.trim();
                                
                                const pCheckXt = box.querySelector('.use-proxy-xtream');
                                if(pCheckXt && pCheckXt.checked) {
                                    item.proxy = box.querySelector('.proxy-url-xtream').value.trim();
                                }
                            }

                            // A DIETA: Apaga tudo o que estiver vazio para o link não ficar gigante
                            Object.keys(item).forEach(key => {
                                if (item[key] === "" || item[key] === null) delete item[key];
                            });

                            return item;
                        });

                        const config = { lists };
                        const jsonStr = JSON.stringify(config);
                        const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
                        
                        // A PROTEÇÃO: Transforma os caracteres perigosos do Base64 em link seguro
                        const urlSafeB64 = encodeURIComponent(b64);
                        
                        window.location.href = "stremio://" + window.location.host + "/" + urlSafeB64 + "/manifest.json";

                    } catch (err) {
                        console.error(err);
                        alert("Erro ao gerar a instalação. Verifica se não tens caracteres estranhos.");
                    }
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

    const servidoresComBloqueio = ['luzentreaoceanos', 'p1d5753'];
    const precisaDeProxy = servidoresComBloqueio.some(s => configData.url.toLowerCase().includes(s));

    try {
        let finalUrl = "";
        let requestHeaders = { 
            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 27211 Safari/533.3',
            'Connection': precisaDeProxy ? 'close' : 'keep-alive' 
        };

        if (configData.type === 'xtream') {
            const baseUrl = configData.url.replace(/\/$/, "");
            requestHeaders['User-Agent'] = 'VLC/3.0.18 LibVLC/3.0.18';
            finalUrl = type === 'tv' ? `${baseUrl}/${configData.user}/${configData.pass}/${channelId}` : 
                       type === 'movie' ? `${baseUrl}/movie/${configData.user}/${configData.pass}/${channelId}` :
                       `${baseUrl}/series/${configData.user}/${configData.pass}/${channelId}`;
            return res.redirect(302, finalUrl);
        } else {
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
                // 🔥 MANTIDA A CORREÇÃO DO FFMPEG
                let cleanUrl = streamUrl.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                if (cleanUrl.includes('http://localhost/ch/')) {
                    const parts = cleanUrl.split('http://localhost/ch/');
                    finalUrl = parts[0].replace(/ffmpeg\s*$/, "").trim() + '/' + parts[1].trim();
                } else if (cleanUrl.startsWith('http')) {
                    finalUrl = cleanUrl;
                } else {
                    const baseServer = configData.url.replace(/\/c\/?$/, "").replace(/\/portal\.php\/?$/, "");
                    finalUrl = baseServer.replace(/\/$/, "") + (cleanUrl.startsWith('/') ? cleanUrl : '/' + cleanUrl);
                }
                finalUrl = finalUrl.trim();
            }
        }

        if (!finalUrl) return res.status(404).end();

        // 🔥 MANTIDA A CORREÇÃO DA TV (RANGE)
        if (req.headers.range && type !== 'movie' && type !== 'series') {
            delete req.headers.range; 
        }

        // PREPARAR PEDIDO AXIOS COM SUPORTE A PROXY/VPN
        let axiosOptions = {
            method: 'get',
            url: finalUrl,
            headers: requestHeaders,
            responseType: 'stream',
            timeout: 0,
            maxRedirects: 5,
            validateStatus: false
        };

        // SE O UTILIZADOR DEFINIU UM PROXY NO HTML, O SERVER USA-O AQUI
        if (configData.proxy && configData.proxy.startsWith('http')) {
            try {
                const proxyUrl = new URL(configData.proxy);
                axiosOptions.proxy = {
                    protocol: proxyUrl.protocol.replace(':', ''),
                    host: proxyUrl.hostname,
                    port: parseInt(proxyUrl.port),
                    auth: proxyUrl.username ? { username: proxyUrl.username, password: proxyUrl.password } : undefined
                };
            } catch (e) { console.error("Erro no Proxy:", e.message); }
        }

        const videoResponse = await axios(axiosOptions);

        res.status(200);
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (videoResponse.headers['content-type']) res.setHeader("Content-Type", videoResponse.headers['content-type']);

        videoResponse.data.pipe(res);

        req.on('close', () => { 
            if (videoResponse.data) videoResponse.data.destroy(); 
        });

    } catch (e) {
        if (!res.headersSent) res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Addon Online na porta ${PORT}`));

