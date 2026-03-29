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
    res.setHeader("Content-Type", "text/html");
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>XuloV Multi-Hub Stalker</title>
    <style>
        body { font-family: sans-serif; background: #0f0f0f; color: white; padding: 20px; max-width: 600px; margin: auto; }
        .card { background: #1a1a1a; padding: 20px; border-radius: 10px; border: 1px solid #333; }
        h2 { color: #00d1b2; text-align: center; }
        textarea { width: 100%; background: #000; color: #0f0; border: 1px solid #444; padding: 10px; font-family: monospace; box-sizing: border-box; }
        .vpn-box { margin-top: 20px; padding: 15px; background: #222; border: 1px solid #444; border-radius: 5px; }
        .vpn-header { display: flex; align-items: center; cursor: pointer; font-weight: bold; color: #00d1b2; }
        .vpn-header input { margin-right: 10px; transform: scale(1.2); }
        .proxy-input { width: 100%; padding: 10px; margin-top: 10px; background: #111; border: 1px solid #555; color: white; display: none; box-sizing: border-box; }
        button { background: #00d1b2; color: black; border: none; padding: 15px; width: 100%; border-radius: 5px; font-weight: bold; cursor: pointer; margin-top: 20px; font-size: 16px; }
        button:hover { background: #00b399; }
    </style>
</head>
<body>
    <div class="card">
        <h2>🚀 XuloV Multi-Hub</h2>
        <p style="font-size: 12px; color: #888;">Edite o JSON abaixo com as suas listas:</p>
        <textarea id="config" rows="10">
{
  "lists": [
    {
      "name": "Minha Lista",
      "url": "http://exemplo.com/portal.php",
      "mac": "00:1A:79:00:00:00",
      "type": "stalker"
    }
  ]
}
        </textarea>

        <div class="vpn-box">
            <label class="vpn-header">
                <input type="checkbox" id="useProxy" onchange="document.getElementById('proxyUrl').style.display = this.checked ? 'block' : 'none'">
                🛡️ Ativar Perfil Proxy / VPN
            </label>
            <input type="text" id="proxyUrl" class="proxy-input" placeholder="Ex: http://usuario:senha@ip:porta">
            <p style="font-size: 11px; color: #666; margin-top: 5px;">Use isto apenas se o servidor bloquear o IP do Render ou cair na TV.</p>
        </div>

        <button onclick="install()">INSTALAR NO STREMIO</button>
    </div>

    <script>
        function install() {
            try {
                let configObj = JSON.parse(document.getElementById('config').value);
                const useProxy = document.getElementById('useProxy').checked;
                const proxyVal = document.getElementById('proxyUrl').value.trim();

                // Se o proxy estiver ativo, injeta-o em todas as listas
                if (useProxy && proxyVal !== "") {
                    configObj.lists.forEach(l => { l.proxy = proxyVal; });
                }

                // Codifica em Base64 para o Stremio aceitar caracteres especiais (@, :, /)
                const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(configObj))));
                window.location.href = "stremio://addon-install?url=" + window.location.origin + "/manifest.json?config=" + b64;
            } catch(e) {
                alert("Erro no JSON: " + e.message);
            }
        }
    </script>
</body>
</html>
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

