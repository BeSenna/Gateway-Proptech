const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { carregarConfig } = require("../src/config");
const { ApiStore } = require("../src/store");
const { criarApp } = require("../src/app");
const { gerarHash } = require("../src/senha");

const JWT_SECRET = "segredo-dos-microsservicos-so-para-teste";
const ADMIN_JWT_SECRET = "segredo-do-painel-so-para-teste";
const ADMIN_SENHA = "Painel@Forte123";

// silencia o log de acesso durante os testes
console.log = () => {};
console.error = () => {};

function escutar(servidor) {
  return new Promise((resolve) => servidor.listen(0, "127.0.0.1", () => resolve(servidor.address().port)));
}

// Serviço de destino falso: guarda o que recebeu e responde ao que o teste mandar.
async function subirDestino(resposta) {
  const recebidas = [];
  const servidor = http.createServer((req, res) => {
    const partes = [];
    req.on("data", (p) => partes.push(p));
    req.on("end", () => {
      recebidas.push({ metodo: req.method, url: req.url, cabecalhos: req.headers, corpo: Buffer.concat(partes).toString() });
      const r = typeof resposta === "function" ? resposta(req, recebidas.at(-1)) : resposta ?? { status: 200, corpo: { ok: true } };
      if (r.demora) return setTimeout(() => res.end("tarde"), r.demora);
      res.writeHead(r.status ?? 200, { "Content-Type": "application/json", ...(r.cabecalhos ?? {}) });
      res.end(JSON.stringify(r.corpo ?? {}));
    });
  });
  const porta = await escutar(servidor);
  return { url: `http://127.0.0.1:${porta}`, recebidas, fechar: () => new Promise((r) => { servidor.closeAllConnections(); servidor.close(r); }) };
}

async function subirGateway({ semente = {}, ambiente = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-teste-"));
  const config = carregarConfig({
    JWT_SECRET, ADMIN_JWT_SECRET, ADMIN_USUARIO: "admin", ADMIN_SENHA_HASH: gerarHash(ADMIN_SENHA),
    DATA_DIR: dataDir, PROXY_TIMEOUT_MS: "1500", ...ambiente,
    MORADOR_API_URL: semente.morador ?? "", FINANCEIRO_API_URL: semente.financeiro ?? "", SERVICOS_API_URL: semente.servicos ?? "",
  });
  const store = new ApiStore(config.dataDir, config.semente);
  const servidor = http.createServer(criarApp(config, store));
  const porta = await escutar(servidor);
  return {
    url: `http://127.0.0.1:${porta}`, config, store, dataDir,
    fechar: () => new Promise((r) => { servidor.closeAllConnections(); servidor.close(r); }),
  };
}

const tokenMorador = (extra = {}, opcoes = { expiresIn: "1h" }) => jwt.sign({ sub: 1, perfil: "SINDICO", ...extra }, JWT_SECRET, opcoes);

async function loginAdmin(url, senha = ADMIN_SENHA, usuario = "admin") {
  return fetch(`${url}/admin/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario, senha }),
  });
}

module.exports = { subirDestino, subirGateway, tokenMorador, loginAdmin, JWT_SECRET, ADMIN_JWT_SECRET, ADMIN_SENHA };
