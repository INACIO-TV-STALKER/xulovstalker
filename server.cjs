// server.cjs 27 Maio sem filtro de categorias!!!

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process"); // Adicionado para o FFmpeg
const addon = require("./addon.cjs");

const activeTvStreams = {};
const vodCache = {};

// Limpeza periódica de promessas e caches antigas
setInterval(() => {
    const now = Date.now();
    if (global.pendingTvLinks) {
        Object.keys(global.pendingTvLinks).forEach(k => {
            if (now - global.pendingTvLinks[k].timestamp > 60000) {
                delete global.pendingTvLinks[k];
            }
        });
    }
    if (global.vodCache) {
        Object.keys(global.vodCache).forEach(k => {
            if (now - global.vodCache[k].timestamp > 30000) {
                delete global.vodCache[k];
            }
        });
    }
}, 30000);

const PORT = process.env.PORT || 7860;
const app = express();

app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// Página de Configuração
app.get("/", (req, res) => res.redirect("/configure"));
app.get("/configure", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html><head><title>𝕀ℕ𝔸́ℂ𝕀𝕆 𝕋𝕍 𝕏-𝕋𝔸𝕃𝕂𝔼ℝ</title>
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
            .proxy-box { background: rgba(255, 165, 0, 0.1); border: 1px dashed #ffa500; padding: 10px; border-radius: 8px; margin-top: 10px; }
            .proxy-box label { color: #ffa500 !important; }
        </style></head>
        <body>
            <div class="container">
                <h2 style="text-align:center">𝕀ℕ𝔸́ℂ𝕀𝕆 𝕋𝕍 𝕏-𝕋𝔸𝕃𝕂𝔼ℝ</h2>
                <div id="lists-container"></div>
                <button class="add-btn" onclick="addList()">+ Adicionar Nova Lista (Máx 5)</button>
                <button class="install-btn" onclick="install()">🚀 INSTALAR NO STREMIO</button>
            </div>
            <script>
                let listCount = 0;

                function addList() {
                    if(listCount >= 5) return alert("Máximo de 5 listas atingido!");
                    listCount++;
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
                            </div>

                            <div class="proxy-box">
                                <label>🛡️ PROXY / VPN PARA DESBLOQUEIO (Opcional)</label>
                                <input type="text" class="proxy-url" placeholder="http://user:pass@ip:porta">
                                <div style="font-size: 10px; color: #aaa; margin-top: 4px;">Força a ligação por este IP. Útil para servidores teimosos.</div>
                            </div>
                        </div>\`;
                    document.getElementById('lists-container').insertAdjacentHTML('beforeend', html);
                }

                function removeList(id) { document.getElementById('box-'+id).remove(); }

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
                            const getV = (sel) => box.querySelector(sel)?.value?.trim() || "";

                            return {
                                type: type,
                                name: getV('.name') || "IPTV",
                                url: getV('.url'),
                                mac: type === 'stalker' ? getV('.mac') : "",
                                model: type === 'stalker' ? getV('.model') : "MAG250",
                                sn: getV('.sn'),
                                id1: getV('.id1'),
                                id2: getV('.id2'),
                                sig: getV('.sig'),
                                user: type === 'xtream' ? getV('.user') : "",
                                pass: type === 'xtream' ? getV('.pass') : "",
                                proxy: getV('.proxy-url')
                            };
                        });

                        const config = { lists: lists };
                        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(config))));
                        window.location.href = "stremio://" + window.location.host + "/" + encodeURIComponent(b64) + "/manifest.json";

                    } catch (err) {
                        console.error("Erro na instalação:", err);
                        alert("Erro ao gerar configuração.");
                    }
                }
                              
                window.onload = function() { addList(); };
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

app.get("/:config/meta/:type/:id.json", async (req, res) => {
    res.json(await addon.getMeta(req.params.type, req.params.id, req.params.config));
});

app.get("/:config/stream/:type/:id.json", async (req, res) => {
    const host = req.headers.host;
    res.json(await addon.getStreams(req.params.type, req.params.id, req.params.config, host));
});

// ROTA PRINCIPAL DO PROXY
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';
    const lists = addon.parseConfig(config);
    const configData = lists[listIdx];
    if (!configData) return res.status(400).end();

    try {
        // ----- XTREAM (redirect) -----
        if (configData.type === 'xtream') {
            const baseUrl = configData.url.replace(/\/$/, "");
            const finalUrl = type === 'tv' ? `${baseUrl}/${configData.user}/${configData.pass}/${channelId}` :
                             type === 'movie' ? `${baseUrl}/movie/${configData.user}/${configData.pass}/${channelId}` :
                             `${baseUrl}/series/${configData.user}/${configData.pass}/${channelId}`;
            return res.redirect(302, finalUrl);
        }

        // ----- STALKER -----
        // --- VOD (filmes e séries) ---
        if (type === 'movie' || type === 'series') {
            const vodKey = `${configData.url}_${channelId}_${type}`;

            if (!global.pendingVodPromises) global.pendingVodPromises = {};
            if (global.pendingVodPromises[vodKey]) {
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
                try {
                    const pendingStream = await Promise.race([global.pendingVodPromises[vodKey], timeoutPromise]);
                    if (pendingStream && pendingStream.pipe) {
                        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
                        pendingStream.pipe(res);
                        return;
                    }
                } catch (e) {}
                delete global.pendingVodPromises[vodKey];
            }

            if (!global.vodCache) global.vodCache = {};
            let cleanUrl = null;
            if (global.vodCache[vodKey] && (Date.now() - global.vodCache[vodKey].timestamp < 5000)) {
                cleanUrl = global.vodCache[vodKey].url;
            }

            if (!cleanUrl) {
                const auth = await addon.authenticate(configData);
                if (!auth) return res.status(401).end();

                let stalkerCmd = decodeURIComponent(channelId);
                let seriesParam = '';
                if (type === 'series' && stalkerCmd.includes('|||')) {
                    const parts = stalkerCmd.split('|||');
                    stalkerCmd = parts[0];
                    const epNum = parts[1];
                    if (epNum) seriesParam = `&series=${epNum}`;
                }

                const linkUrl = `${auth.api}type=vod&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}${seriesParam}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                const linkRes = await axios.get(linkUrl, addon.getAxiosOpts(configData, { headers: auth.authData.headers }));
                let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;
                if (!streamUrl || typeof streamUrl !== 'string') return res.status(404).end();

                cleanUrl = streamUrl.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").trim();
                if (!cleanUrl.startsWith('http')) {
                    const basePortal = configData.url.split('/c/')[0];
                    cleanUrl = basePortal + (cleanUrl.startsWith('/') ? '' : '/') + cleanUrl;
                }
                global.vodCache[vodKey] = { url: cleanUrl, timestamp: Date.now() };
            }

            let resolveVod;
            const vodPromise = new Promise(resolve => { resolveVod = resolve; });
            global.pendingVodPromises[vodKey] = vodPromise;

            try {
                const auth = await addon.authenticate(configData);
                const streamHeaders = {
                    ...auth.authData.headers,
                    'Referer': configData.url.replace(/\/$/, "") + "/c/",
                    'Accept': '*/*',
                    'Connection': 'keep-alive'
                };

                const axiosOpts = addon.getAxiosOpts(configData, {
                    url: cleanUrl,
                    headers: streamHeaders,
                    responseType: 'stream',
                    timeout: 30000,
                    maxRedirects: 0,
                    validateStatus: () => true
                });
                const streamRes = await axios(axiosOpts);

                if ([301, 302, 307, 308].includes(streamRes.status) && streamRes.headers.location) {
                    const finalUrl = streamRes.headers.location;
                    const finalRes = await axios(addon.getAxiosOpts(configData, {
                        url: finalUrl,
                        headers: streamHeaders,
                        responseType: 'stream',
                        timeout: 30000
                    }));
                    pipeVod(finalRes.data, finalRes.status, finalRes.headers, vodKey, resolveVod);
                } else {
                    pipeVod(streamRes.data, streamRes.status, streamRes.headers, vodKey, resolveVod);
                }
            } catch (e) {
                delete global.pendingVodPromises[vodKey];
                if (!res.headersSent) res.status(500).end();
            }

            function pipeVod(source, statusCode, headers, key, resolveFn) {
                if (statusCode >= 400) {
                    source.destroy();
                    delete global.pendingVodPromises[key];
                    return;
                }
                const PassThrough = require('stream').PassThrough;
                const pipeStream = new PassThrough();
                source.pipe(pipeStream);
                resolveFn(pipeStream);
                delete global.pendingVodPromises[key];

                res.writeHead(200, {
                    'Content-Type': headers['content-type'] || 'video/mp4',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                });
                pipeStream.pipe(res);
                source.on('end', () => {});
                source.on('error', () => {});
                req.on('close', () => {});
            }

            return; // fim do VOD
        }

        // ----- TV STALKER (COM FFMPEG) -----
        const streamKey = `${configData.url}_${channelId}`;

        if (!global.pendingTvLinks) global.pendingTvLinks = {};

        if (activeTvStreams[streamKey]) {
            const cached = activeTvStreams[streamKey];
            if (cached.stream && cached.source && !cached.source.destroyed && !cached.source.finished) {
                res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
                cached.stream.pipe(res);
                return;
            } else {
                delete activeTvStreams[streamKey];
                if (global.pendingTvLinks) delete global.pendingTvLinks[streamKey];
            }
        }

        if (global.pendingTvLinks[streamKey] && (Date.now() - global.pendingTvLinks[streamKey].timestamp < 30000)) {
            res.setHeader('Accept-Ranges', 'none');
            res.setHeader('Connection', 'close');
            return res.redirect(302, global.pendingTvLinks[streamKey].url);
        }

        if (!global.pendingTvPromises) global.pendingTvPromises = {};
        if (global.pendingTvPromises[streamKey]) {
            const outcome = await global.pendingTvPromises[streamKey];
            if (outcome && outcome.type === 'stream') {
                res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
                outcome.stream.pipe(res);
                return;
            } else if (outcome && outcome.type === 'redirect') {
                res.setHeader('Accept-Ranges', 'none');
                res.setHeader('Connection', 'close');
                return res.redirect(302, outcome.url);
            }
            delete global.pendingTvPromises[streamKey];
        }

        let resolveOutcome;
        const outcomePromise = new Promise(resolve => { resolveOutcome = resolve; });
        global.pendingTvPromises[streamKey] = outcomePromise;

        try {
            const auth = await addon.authenticate(configData);
            if (!auth) {
                delete global.pendingTvPromises[streamKey];
                return res.status(401).end();
            }

            const stalkerCmd = decodeURIComponent(channelId);
            const linkUrl = `${auth.api}type=itv&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;

            const linkRes = await axios.get(linkUrl, addon.getAxiosOpts(configData, { headers: auth.authData.headers }));
            let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;
            if (!streamUrl || typeof streamUrl !== 'string') {
                delete global.pendingTvPromises[streamKey];
                return res.status(404).end();
            }

            let cleanUrl = streamUrl.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").trim();
            if (!cleanUrl.startsWith('http')) {
                const basePortal = configData.url.split('/c/')[0];
                cleanUrl = basePortal + (cleanUrl.startsWith('/') ? '' : '/') + cleanUrl;
            }

            const streamHeaders = {
                ...auth.authData.headers,
                'Referer': configData.url.replace(/\/$/, "") + "/c/",
                'Accept': '*/*',
                'Connection': 'keep-alive'
            };

            let resolved = false;
            let hasRetried = false;

            const doRedirect = () => {
                if (resolved || res.headersSent) return;
                resolved = true;
                delete global.pendingTvPromises[streamKey];
                global.pendingTvLinks[streamKey] = { url: cleanUrl, timestamp: Date.now() };
                if (!res.headersSent) {
                    res.setHeader('Accept-Ranges', 'none');
                    res.setHeader('Connection', 'close');
                    res.redirect(302, cleanUrl);
                }
            };

            const startPipe = (src, key, resolveFn, isResolved) => {
                if (isResolved) {
                    if (src.killProcess) src.killProcess();
                    return;
                }
                isResolved = true;
                delete global.pendingTvLinks[key];

                const PassThrough = require('stream').PassThrough;
                const pipeStream = new PassThrough();
                src.pipe(pipeStream);
                activeTvStreams[key] = { stream: pipeStream, source: src };

                res.writeHead(200, {
                    'Content-Type': 'video/mp2t',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                });
                pipeStream.pipe(res);

                resolveFn({ type: 'stream', stream: pipeStream });
                delete global.pendingTvPromises[key];

                src.on('end', () => delete activeTvStreams[key]);
                src.on('error', () => delete activeTvStreams[key]);
                
                req.on('close', () => {
                    delete activeTvStreams[key];
                    delete global.pendingTvLinks[key];
                    if (src.killProcess) src.killProcess();
                });
            };

            const execFfmpeg = (urlToPlay) => {
                if (resolved || res.headersSent) return;

                const ffmpegHeaders = Object.entries(streamHeaders)
                    .map(([key, val]) => `${key}: ${val}`)
                    .join('\r\n') + '\r\n';

                const ffmpeg = spawn('ffmpeg', [
                    '-headers', ffmpegHeaders,
                    '-re',
                    '-i', urlToPlay,
                    '-c', 'copy',
                    '-f', 'mpegts',
                    '-loglevel', 'error',
                    'pipe:1'
                ]);

                const source = ffmpeg.stdout;
                
                source.killProcess = () => {
                    try {
                        if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
                    } catch (e) {}
                };

                ffmpeg.on('error', () => {
                    if (!resolved) {
                        source.killProcess();
                        doRedirect();
                    }
                });

                ffmpeg.on('close', (code) => {
                    if (code !== 0 && !resolved) {
                        if (!hasRetried) {
                            hasRetried = true;
                            retryWithFreshAuth();
                        } else {
                            doRedirect();
                        }
                    }
                });

                startPipe(source, streamKey, resolveOutcome, resolved);
            };

            const retryWithFreshAuth = async () => {
                try {
                    const newAuth = await addon.authenticate(configData);
                    if (!newAuth) return doRedirect();
                    
                    const newLinkUrl = `${newAuth.api}type=itv&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}&sn=${newAuth.authData.sn}&token=${newAuth.token}&JsHttpRequest=1-0`;
                    const newLinkRes = await axios.get(newLinkUrl, addon.getAxiosOpts(configData, { headers: newAuth.authData.headers }));
                    let newStreamUrl = newLinkRes.data?.js?.cmd || newLinkRes.data?.js || newLinkRes.data?.cmd;
                    
                    if (!newStreamUrl) return doRedirect();
                    cleanUrl = newStreamUrl.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").trim();
                    if (!cleanUrl.startsWith('http')) {
                        const basePortal = configData.url.split('/c/')[0];
                        cleanUrl = basePortal + (cleanUrl.startsWith('/') ? '' : '/') + cleanUrl;
                    }
                    
                    execFfmpeg(cleanUrl);
                } catch (e) {
                    doRedirect();
                }
            };

            execFfmpeg(cleanUrl);

        } catch (e) {
            console.error("[PROXY] Erro interno no pipe TV:", e.message);
            delete global.pendingTvPromises[streamKey];
            if (!res.headersSent) res.status(500).end();
        }

    } catch (e) {
        console.error("[PROXY] Erro geral do router:", e.message);
        if (!res.headersSent) res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Addon Online na porta ${PORT}`));