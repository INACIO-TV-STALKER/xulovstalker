require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 3000;
const app = express();

// --- CONFIGURAÇÃO ---
app.use(cors()); // Essencial para o Stremio não bloquear o addon
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Função para limpar o texto (Segurança XSS)
const escapeHTML = (str) => str ? str.replace(/[&<>"']/g, (m) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[m]) : "";

// --- ROTAS DO STREMIO ---

app.get("/manifest.json", (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, "manifest.json"));
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  res.json(await addon.getCatalog(req.params.type, req.params.id));
});

app.get("/stream/:type/:id.json", async (req, res) => {
  res.json(await addon.getStreams(req.params.type, req.params.id));
});

app.get("/configure", (req, res) => res.redirect("/config"));

// --- GESTÃO DE LISTAS ---

// Salvar nova lista
app.post("/config", (req, res) => {
  const { name, url, mac } = req.body;
  if (name && url && mac) {
    addon.addList({ name, url, mac });
  }
  res.redirect("/config");
});

// Apagar lista existente
app.post("/config/delete", (req, res) => {
  const { id } = req.body;
  if (id) {
    addon.deleteList(id);
  }
  res.redirect("/config");
});

// --- PÁGINA DE CONFIGURAÇÃO VISUAL ---

app.get("/config", (req, res) => {
  const lists = addon.loadLists();

  const listItems = lists.map(l => `
    <li style="margin-bottom: 12px; padding: 15px; border: 1px solid #ddd; border-radius: 10px; list-style: none; background: #fff; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
      <div style="max-width: 70%;">
        <strong style="color: #333; font-size: 16px;">${escapeHTML(l.name)}</strong><br>
        <small style="color: #777; word-break: break-all;">MAC: ${escapeHTML(l.mac)}</small>
      </div>
      <form method="POST" action="/config/delete" style="margin: 0;">
        <input type="hidden" name="id" value="${l.id}">
        <button type="submit" style="background: #ff4d4d; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 11px;">APAGAR</button>
      </form>
    </li>
  `).join("");

  // LINKS PARA ABRIR NO ANDROID
  const stremioLink = "stremio://127.0.0.1:3000/manifest.json";
  const androidIntent = "intent://127.0.0.1:3000/manifest.json#Intent;scheme=stremio;package=com.stremio.one;end";

  let html = `
    <body style="font-family: sans-serif; max-width: 500px; margin: 15px auto; padding: 15px; background: #f8f9fa; line-height: 1.5;">
      <h2 style="text-align: center; color: #222; margin-bottom: 20px;">IPTV Stalker Config</h2>
      
      <form method="POST" action="/config" style="background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); margin-bottom: 25px;">
        <input name="name" style="width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box;" required placeholder="Nome do Portal">
        <input name="url" style="width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box;" required placeholder="URL (http://...)">
        <input name="mac" style="width: 100%; padding: 10px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box;" required placeholder="MAC (00:1A:79:XX:XX:XX)">
        <button type="submit" style="background: #007bff; color: white; border: none; padding: 12px; width: 100%; border-radius: 8px; font-weight: bold; cursor: pointer;">+ ADICIONAR PORTAL</button>
      </form>

      <h3 style="color: #444; border-bottom: 2px solid #eee; padding-bottom: 5px;">Listas Salvas (${lists.length}/5)</h3>
      <ul style="padding: 0;">${listItems || '<p style="color: #999; text-align: center;">Vazio.</p>'}</ul>

      <div style="margin-top: 35px; text-align: center; border-top: 1px dashed #ccc; padding-top: 20px;">
        <p style="color: #28a745; font-weight: bold; margin-bottom: 15px; font-size: 14px;">✅ DADOS GUARDADOS!</p>
        
        <!-- BOTÃO HÍBRIDO DE ABERTURA -->
        <a href="${stremioLink}" 
           onclick="window.location.href='${androidIntent}'; return false;"
           style="display:block; padding:18px; background:#8a2be2; color:white; text-align:center; text-decoration:none; border-radius:12px; font-weight:bold; font-size: 17px; box-shadow: 0 4px 12px rgba(138, 43, 226, 0.4);">
           🚀 ABRIR NO STREMIO
        </a>

        <div style="background: #fffbe6; padding: 10px; border-radius: 8px; margin-top: 15px; border: 1px solid #ffe58f;">
          <p style="font-size: 11px; color: #856404; margin: 0;">
            Se o botão não abrir a App, abra o <b>Stremio</b> manualmente. <br>
            As listas já estarão carregadas!
          </p>
        </div>
      </div>
    </body>
  `;
  
  res.send(html);
});

app.get("/", (req, res) => res.redirect("/config"));

app.listen(PORT, "127.0.0.1", () => console.log(`🚀 Servidor: http://127.0.0.1:${PORT}`));

