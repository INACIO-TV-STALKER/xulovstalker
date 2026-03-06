const express = require("express");
const cors = require("cors");
const axios = require("axios");
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());

// Bloqueia erros de favicon e ficheiros estáticos que viste no log
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// PÁGINA DE CONFIGURAÇÃO
app.get("/", (req, res) => res.redirect("/configure"));
app.get("/configure", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html><head><title>XuloV Hub Config</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; background: #0c0d19; color: white; padding: 20px; text-align: center; }
            .container { max-width: 500px; margin: auto; background: #1b1d30; padding: 30px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            h2 { color: #007bff; }
            .list-box { background: #141526; padding: 15px; border-radius: 10px; margin-bottom: 15px; text-align: left; border-left: 4px solid #007bff; }
            label { display: block; font-size: 11px; color: #888; margin-top: 10px; font-weight: bold; }
            input, select { width: 100%; padding: 10px; margin: 5px 0; border-radius: 5px; border: 1px solid #333; background: #222; color: white; box-sizing: border-box; }
            .add-btn { background: #28a745; color: white; border: none; padding: 12px; width: 100%; border-radius: 8px; cursor: pointer; font-weight: bold; margin: 10px 0; }
            .install-btn { background: #007bff; color: white; border: none; padding: 18px; width: 100%; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 18px; margin-top: 10px; }
        </style></head>
        <body>
            <div class="container">
                <h2>🚀 XuloV Stalker Hub</h2>
                <div id="lists-container"></div>
                <button class="add-btn" onclick="addList()">+ Adicionar Portal</button>
                <button class="install-btn" onclick="install()">INSTALAR NO STREMIO</button>
            </div>
            <script>
                let listCount = 0;
                function addList() {
                    if(listCount >= 5) return;
                    listCount++;
                    const id = Date.now();
                    const html = \`
                        <div class="list-box" id="box-\${id}">
                            <label>NOME</label><input type="text" class="name" placeholder="Ex: Meu Portal">
                            <label>URL (com /c/)</label><input type="text" class="url" placeholder="http://link.com/c/">
                            <label>MAC</label><input type="text" class="mac" placeholder="00:1A:79:XX:XX:XX">
                            <label>MODELO</label><select class="model"><option value="MAG322">MAG 322</option><option value="MAG254">MAG 254</option></select>
                        </div>\`;
                    document.getElementById('lists-container').insertAdjacentHTML('beforeend', html);
                }
                function install() {
                    const boxes = document.querySelectorAll('.list-box');
                    const lists = Array.from(boxes).map(box => ({
                        name: box.querySelector('.name').value.trim(),
                        url: box.querySelector('.url').value.trim(),
                        mac: box.querySelector('.mac').value.trim(),
                        model: box.querySelector('.model').value,
                        sn: "", id1: "", id2: "", sig: ""
                    }));
                    if(!lists[0].url) return alert("Preenche os dados!");
                    const b64 = btoa(JSON.stringify({ lists }));
                    window.location.href = "stremio://" + window.location.host + "/" + b64 + "/manifest.json";
                }
                addList();
            </script>
        </body></html>
    `);
});

// ROTAS STREMIO
app.get("/:config/manifest.json", async (req, res) => {
    try { res.json(await addon.getManifest(req.params.config)); }
    catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/:config/catalog/:type/:id/:extra?.json", async (req, res) => {
    try {
        const { config, type, id, extra } = req.params;
        let extraObj = {};
        if (extra) {
            extra.replace(".json", "").split("&").forEach(p => {
                const [k, v] = p.split("=");
                if (k && v) extraObj[k] = decodeURIComponent(v);
            });
        }
        res.json(await addon.getCatalog(type, id, extraObj, config));
    } catch(e) { res.status(500).end(); }
});

app.get("/:config/meta/:type/:id.json", async (req, res) => {
    try { res.json(await addon.getMeta(req.params.type, req.params.id, req.params.config)); }
    catch(e) { res.status(500).end(); }
});

app.get("/:config/stream/:type/:id.json", async (req, res) => {
    try {
        const host = req.headers.host;
        res.json(await addon.getStreams(req.params.type, req.params.id, req.params.config, host));
    } catch(e) { res.status(500).end(); }
});

// PROXY DE VÍDEO MELHORADO (Focado em resolver o ecrã preto no VOD)
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';

    const lists = addon.parseConfig(config);
    const configData = lists[listIdx];
    if (!configData) return res.status(400).send("Config Error");

    const auth = await addon.authenticate(configData);
    if (!auth) return res.status(401).send("Auth Failed");

    try {
        let streamUrl = null;
        let cleanId = decodeURIComponent(channelId);

        if (type === "movie" || type === "series") {
            console.log(`[VOD] A tentar link para ${type} ID: ${cleanId}`);
            
            // Tentamos 4 métodos diferentes para garantir que o portal responde
            const methods = [
                `${auth.api}type=vod&action=create_link&id=${cleanId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`,
                `${auth.api}type=vod&action=create_link&cmd=${encodeURIComponent(cleanId)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`,
                `${auth.api}type=vod&action=get_vod_uri&id=${cleanId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`,
                `${auth.api}type=vod&action=get_vod_url&id=${cleanId}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`
            ];

            for (const url of methods) {
                const r = await axios.get(url, { headers: auth.authData.headers, timeout: 8000 }).catch(() => null);
                if (r && r.data) {
                    streamUrl = r.data?.js?.cmd || r.data?.js?.data || r.data?.js || r.data?.cmd || r.data?.url;
                    if (typeof streamUrl === 'string' && streamUrl.length > 20 && !streamUrl.includes('undefined')) break;
                }
            }
        } else {
            // Lógica de TV que já funciona
            const cmd = encodeURIComponent(`ffrt http://localhost/ch/${cleanId}`);
            const tvUrl = `${auth.api}type=itv&action=create_link&cmd=${cmd}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
            const r = await axios.get(tvUrl, { headers: auth.authData.headers });
            streamUrl = r.data?.js?.cmd || r.data?.js || r.data?.cmd;
        }

        if (typeof streamUrl === 'string') {
            let finalUrl = streamUrl
                .replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "")
                .replace(/([^:])(\/\/+)/g, '$1/')
                .trim();
            
            // Correção especial para o portal elrinconcito se o link vier quebrado
            if (finalUrl.includes('/.?play_token=')) {
                finalUrl = finalUrl.replace('/.', `/${cleanId}`);
            }

            console.log(`[PROXY] ✅ Link Final: ${finalUrl}`);

            const videoResponse = await axios({
                method: 'get',
                url: finalUrl,
                headers: { ...auth.authData.headers, 'User-Agent': 'StrateM/1.0.0 (compatible; MAG250)' },
                responseType: 'stream',
                maxRedirects: 15,
                timeout: 45000
            });

            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", videoResponse.headers['content-type'] || "video/mp4");
            videoResponse.data.pipe(res);
        } else {
            console.error(`[ERRO] Nenhum link obtido para ID: ${cleanId}`);
            res.status(404).send("Stream not found");
        }
    } catch (e) {
        console.error(`[PROXY CRASH]: ${e.message}`);
        res.status(500).send("Video Error");
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 XuloV Stalker Online na porta ${PORT}`));

