const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const https = require("https");
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

// Página de Configuração (mantida igual)
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
        // --- VOD (filmes e séries) com pipe simples + lock anti‑corrida ---
        if (type === 'movie' || type === 'series') {
            const vodKey = `${configData.url}_${channelId}_${type}`;

            // Lock para evitar múltiplos pipes simultâneos (com timeout)
            if (!global.pendingVodPromises) global.pendingVodPromises = {};
            if (global.pendingVodPromises[vodKey]) {
                console.log(`[PROXY] Aguardando pipe VOD pendente para: ${vodKey}`);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
                try {
                    const pendingStream = await Promise.race([global.pendingVodPromises[vodKey], timeoutPromise]);
                    if (pendingStream && pendingStream.pipe) {
                        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
                        pendingStream.pipe(res);
                        return;
                    }
                } catch (e) {
                    console.log(`[PROXY] Timeout ao aguardar pipe VOD pendente, a processar novo pedido.`);
                }
                delete global.pendingVodPromises[vodKey];
            }

            // Cache de link (5s)
            if (!global.vodCache) global.vodCache = {};
            let cleanUrl = null;
            if (global.vodCache[vodKey] && (Date.now() - global.vodCache[vodKey].timestamp < 5000)) {
                cleanUrl = global.vodCache[vodKey].url;
                console.log(`[PROXY] Reutilizando link VOD em cache: ${cleanUrl}`);
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

            console.log(`[PROXY] Iniciar pipe VOD: ${cleanUrl}`);

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
                    console.log(`[PROXY] Redirecionamento VOD -> ${finalUrl}`);
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
                console.error(`[PROXY] Erro no pipe VOD: ${e.message}`);
                delete global.pendingVodPromises[vodKey];
                if (!res.headersSent) res.status(500).end();
            }

            // Função auxiliar para pipe de VOD
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

       // ----- TV STALKER: PIPE COM FALLBACK PARA REDIRECT COM CACHE DE LINK -----
const streamKey = `${configData.url}_${channelId}`;

// Cache de links de TV (30s) – usada tanto para pipe como para fallback
if (!global.pendingTvLinks) global.pendingTvLinks = {};

// Se existe um stream ativo e saudável, reutiliza
if (activeTvStreams[streamKey]) {
    const cached = activeTvStreams[streamKey];
    if (cached.stream && cached.source && !cached.source.destroyed && !cached.source.finished) {
        console.log(`[PROXY] Reutilizando stream ativo para: ${streamKey}`);
        res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
        cached.stream.pipe(res);
        return;
    } else {
        console.log(`[PROXY] Stream em cache inativo, removendo e forçando nova ligação para: ${streamKey}`);
        delete activeTvStreams[streamKey];
        delete global.pendingTvLinks[streamKey];
    }
}

// Se há um link em cache (fallback recente), redireciona diretamente
if (global.pendingTvLinks[streamKey] && (Date.now() - global.pendingTvLinks[streamKey].timestamp < 30000)) {
    console.log(`[PROXY] Redirecionando com link em cache: ${global.pendingTvLinks[streamKey].url}`);
    res.setHeader('Accept-Ranges', 'none');
    res.setHeader('Connection', 'close');
    return res.redirect(302, global.pendingTvLinks[streamKey].url);
}

// Lock com promessa única que resolve para um stream ou para um redirect
if (!global.pendingTvPromises) global.pendingTvPromises = {};
if (global.pendingTvPromises[streamKey]) {
    console.log(`[PROXY] Aguardando resultado pendente para: ${streamKey}`);
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

// Criar promessa que representa o resultado da tentativa de pipe
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

    console.log(`[PROXY] Tentar pipe TV (única tentativa): ${cleanUrl}`);

    const streamHeaders = {
        ...auth.authData.headers,
        'Referer': configData.url.replace(/\/$/, "") + "/c/",
        'Accept': '*/*',
        'Connection': 'keep-alive'
    };

    let resolved = false;

    const doRedirect = async () => {
        if (resolved) return;
        resolved = true;
        delete global.pendingTvPromises[streamKey];
        // Guarda o link em cache para reutilizar durante 30s
        global.pendingTvLinks[streamKey] = { url: cleanUrl, timestamp: Date.now() };
        console.log(`[PROXY] Pipe falhou, a redirecionar (link em cache)...`);
        res.setHeader('Accept-Ranges', 'none');
        res.setHeader('Connection', 'close');
        return res.redirect(302, cleanUrl);
    };

    const parsedUrl = new URL(cleanUrl);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const upstreamReq = httpModule.get(cleanUrl, { headers: streamHeaders, agent: false, timeout: 15000 }, (upstreamRes) => {
        if (resolved) {
            upstreamRes.destroy();
            return;
        }
        // Seguir redirecionamentos (máx. 3)
        if ([301, 302, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
            upstreamRes.destroy();
            const nextUrl = upstreamRes.headers.location;
            console.log(`[PROXY] Redirecionamento inicial -> ${nextUrl}`);
            let redirectLevel = 0;
            const follow = (url, cb) => {
                if (redirectLevel >= 3) {
                    console.error(`[PROXY] Máximo de redirecionamentos atingido`);
                    doRedirect();
                    return;
                }
                const parsed2 = new URL(url);
                const mod2 = parsed2.protocol === 'https:' ? https : http;
                const req2 = mod2.get(url, { headers: streamHeaders, agent: false, timeout: 10000 }, (res2) => {
                    if ([301, 302, 307, 308].includes(res2.statusCode) && res2.headers.location) {
                        res2.destroy();
                        redirectLevel++;
                        follow(res2.headers.location, cb);
                    } else {
                        cb(res2);
                    }
                });
                req2.on('error', () => doRedirect());
                req2.on('timeout', () => { req2.destroy(); doRedirect(); });
            };
            follow(nextUrl, (finalRes) => {
                if (finalRes.statusCode >= 400) {
                    finalRes.destroy();
                    return doRedirect();
                }
                const ct = (finalRes.headers['content-type'] || '').toLowerCase();
                if (ct.includes('application/json')) {
                    let errorBody = '';
                    finalRes.on('data', chunk => errorBody += chunk.toString());
                    finalRes.on('end', () => {
                        console.error(`[PROXY] JSON após redirecionamento: ${errorBody.substring(0, 200)}`);
                        finalRes.destroy();
                        doRedirect();
                    });
                    return;
                }
                startPipe(finalRes, streamKey, resolveOutcome, resolved);
            });
            return;
        }

        if (upstreamRes.statusCode >= 400) {
            upstreamRes.destroy();
            return doRedirect();
        }

        const ct = (upstreamRes.headers['content-type'] || '').toLowerCase();
        if (ct.includes('application/json')) {
            let errorBody = '';
            upstreamRes.on('data', chunk => errorBody += chunk.toString());
            upstreamRes.on('end', () => {
                console.error(`[PROXY] JSON inesperado: ${errorBody.substring(0, 200)}`);
                upstreamRes.destroy();
                doRedirect();
            });
            return;
        }

        startPipe(upstreamRes, streamKey, resolveOutcome, resolved);
    });

    // Timeout manual de segurança
    const timer = setTimeout(() => {
        if (!resolved) {
            console.error(`[PROXY] Timeout manual (15s) - sem resposta do servidor`);
            upstreamReq.destroy();
            doRedirect();
        }
    }, 15000);

    upstreamReq.on('response', () => clearTimeout(timer));

    upstreamReq.on('error', (err) => {
        clearTimeout(timer);
        if (!resolved) {
            console.error("[PROXY] Erro ao ligar ao stream:", err.message);
            doRedirect();
        }
    });

    upstreamReq.on('timeout', () => {
        clearTimeout(timer);
        if (!resolved) {
            console.error("[PROXY] Timeout nativo ao ligar ao stream");
            upstreamReq.destroy();
            doRedirect();
        }
    });

} catch (e) {
    console.error("[PROXY] Erro ao iniciar pipe TV:", e.message);
    delete global.pendingTvPromises[streamKey];
    if (!res.headersSent) res.status(500).end();
}

// Função startPipe modificada para aceitar a flag 'resolved'
const startPipe = (source, key, resolveFn, isResolved) => {
    if (isResolved) {
        source.destroy();
        return;
    }
    isResolved = true;
    delete global.pendingTvLinks[key]; // sucesso, remove cache de fallback

    const PassThrough = require('stream').PassThrough;
    const pipeStream = new PassThrough();
    source.pipe(pipeStream);
    activeTvStreams[key] = { stream: pipeStream, source };

    const contentType = source.headers['content-type'] || 'video/mp2t';
    res.writeHead(200, {
        'Content-Type': contentType,
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
    });
    pipeStream.pipe(res);

    resolveFn({ type: 'stream', stream: pipeStream });
    delete global.pendingTvPromises[key];

    source.on('end', () => delete activeTvStreams[key]);
    source.on('error', () => delete activeTvStreams[key]);
    req.on('close', () => {
        delete activeTvStreams[key];
        delete global.pendingTvLinks[key];
    });
};

    } catch (e) {
        console.error("[PROXY] Erro geral:", e.message);
        if (!res.headersSent) res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Addon Online na porta ${PORT}`));