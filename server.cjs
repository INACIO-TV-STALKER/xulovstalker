require("dotenv").config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // Resolve erro de certificado
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const https = require("https");
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Middlewares para evitar cache chata no Stremio
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  // Passa o host atual para o addon conseguir gerar o link do proxy
  addon.currentHost = req.get('host');
  next();
});

const escapeHTML = (str) => {
  if (!str) return "";
  return str.toString().replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

// --- ROTAS DO STREMIO ---

app.get("/manifest.json", (req, res) => res.json(addon.getManifest()));

app.get("/catalog/:type/:id/:extra?.json", async (req, res) => {
  const { type, id, extra } = req.params;
  let extraObj = {};
  if (extra) {
    try {
      const cleanExtra = extra.replace(".json", "");
      if (cleanExtra.includes("=")) {
        cleanExtra.split("&").forEach(p => {
          const [k, v] = p.split("=");
          if (k && v) extraObj[k] = decodeURIComponent(v);
        });
      }
    } catch (e) {}
  }
  res.json(await addon.getCatalog(type, id, extraObj));
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  res.json(await addon.getCatalog(req.params.type, req.params.id, {}));
});

app.get("/meta/:type/:id.json", (req, res) => {
    const parts = req.params.id.split(":");
    let channelName = parts.length >= 4 ? decodeURIComponent(parts[3]) : "Canal IPTV";
    res.json({ meta: { id: req.params.id, type: "tv", name: channelName, posterShape: "square" } });
});

app.get("/stream/:type/:id.json", async (req, res) => {
    res.json(await addon.getStreams(req.params.type, req.params.id));
});

// --- PROXY DE VÍDEO OTIMIZADO PARA TIZEN ---

app.get("/proxy/:listId/:channelId", async (req, res) => {
    const { listId, channelId } = req.params;
    const config = addon.loadLists().find(l => l.id === listId);
    if (!config) return res.status(404).end();

    const auth = await addon.authenticate(config.url, config);
    if (!auth) return res.status(401).end();

    try {
        const cmd = encodeURIComponent(`ffrt http://localhost/ch/${channelId}`);
        const sUrl = `${auth.api}type=itv&action=create_link&cmd=${cmd}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
        
        const linkRes = await axios.get(sUrl, { headers: auth.authData.headers });
        let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;

        if (typeof streamUrl === 'string') {
            const finalUrl = streamUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
            
            // Usar axios para fazer o stream (Suporta HTTP e HTTPS)
            const response = await axios({
                method: 'get',
                url: finalUrl,
                headers: auth.authData.headers,
                responseType: 'stream',
                timeout: 15000
            });

            // Tizen 8 precisa do Content-Type correto
            res.setHeader("Content-Type", response.headers['content-type'] || "video/mp2t");
            response.data.pipe(res);

            req.on('close', () => { if(response.data) response.data.destroy(); });
        } else {
            res.status(404).end();
        }
    } catch (e) { res.status(500).end(); }
});

// --- PÁGINA DE CONFIG (MANTIDA) ---

app.get("/config", (req, res) => {
  const lists = addon.loadLists();
  const listItems = lists.map(l => `
    <li style="margin-bottom:10px; padding:10px; border:1px solid #ddd; border-radius:8px; background:#fff; display:flex; justify-content:space-between; align-items:center;">
      <div><strong>${escapeHTML(l.name)}</strong><br><small>MAC: ${escapeHTML(l.mac)}</small></div>
      <form method="POST" action="/config/delete"><input type="hidden" name="id" value="${l.id}"><button type="submit" style="background:#ff4d4d; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer;">Apagar</button></form>
    </li>`).join("");

  res.send(`
    <body style="font-family:sans-serif; max-width:500px; margin:15px auto; background:#f4f4f9; padding:15px;">
      <h2 style="text-align:center;">XuloV Stalker Hub</h2>
      <form method="POST" action="/config" style="background:#fff; padding:20px; border-radius:12px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
        <input name="name" placeholder="Nome da Lista" style="width:100%; padding:12px; margin-bottom:10px; border:1px solid #ddd; border-radius:6px;" required>
        <input name="url" placeholder="URL do Portal" style="width:100%; padding:12px; margin-bottom:10px; border:1px solid #ddd; border-radius:6px;" required>
        <input name="mac" placeholder="MAC (00:1A:79:...)" style="width:100%; padding:12px; margin-bottom:10px; border:1px solid #ddd; border-radius:6px;" required>
        <select name="model" style="width:100%; padding:12px; margin-bottom:15px; border:1px solid #ddd; border-radius:6px;">
          <option value="MAG322">MAG 322 (Recomendado)</option>
          <option value="MAG254">MAG 254</option>
        </select>
        <button type="submit" style="width:100%; padding:14px; background:#007bff; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">ADICIONAR</button>
      </form>
      <ul style="padding:0; margin-top:25px;">${listItems}</ul>
      <a href="stremio://${req.get('host')}/manifest.json" style="display:block; text-align:center; padding:18px; background:#8a2be2; color:white; text-decoration:none; border-radius:12px; font-weight:bold; margin-top:20px;">🚀 INSTALAR NO STREMIO</a>
    </body>
  `);
});

app.post("/config", async (req, res) => {
  if (req.body.name && req.body.url && req.body.mac) await addon.addList(req.body);
  res.redirect("/config");
});

app.post("/config/delete", (req, res) => {
  if (req.body.id) addon.deleteList(req.body.id);
  res.redirect("/config");
});

app.get("/", (req, res) => res.redirect("/config"));

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Online na porta ${PORT}`));

