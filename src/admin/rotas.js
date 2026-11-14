// API do painel de administração (/admin/api/*): login do administrador e CRUD das APIs cadastradas.
const express = require("express");
const jwt = require("jsonwebtoken");
const { conferir, iguais } = require("../senha");
const { ErroValidacao } = require("../store");

const AUDIENCIA = "gateway-admin";
const EMISSOR = "api-gateway";
const JANELA_MS = 15 * 60 * 1000;
const MAX_FALHAS = 10;

function criarAdmin(config, store) {
  const rotas = express.Router();
  const falhas = { n: 0, ate: 0 }; // limite GLOBAL: o IP real não é confiável atrás do proxy (cabeçalhos podem ser forjados)

  rotas.post("/login", (req, res) => {
    const agora = Date.now();
    if (agora > falhas.ate) { falhas.n = 0; falhas.ate = agora + JANELA_MS; }
    if (falhas.n >= MAX_FALHAS) {
      res.set("Retry-After", String(Math.ceil((falhas.ate - agora) / 1000)));
      return res.status(429).json({ erro: "Muitas tentativas. Aguarde alguns minutos." });
    }
    const { usuario, senha } = req.body ?? {};
    // as duas conferências sempre rodam, para o tempo de resposta não revelar se o usuário existe
    const usuarioOk = iguais(usuario ?? "", config.adminUsuario);
    const senhaOk = conferir(senha ?? "", config.adminSenhaHash);
    if (!usuarioOk || !senhaOk) {
      falhas.n += 1;
      return res.status(401).json({ erro: "Usuário ou senha inválidos." });
    }
    falhas.n = 0;
    const token = jwt.sign({ sub: config.adminUsuario }, config.adminJwtSecret, {
      algorithm: "HS256", expiresIn: config.adminTokenExpira, issuer: EMISSOR, audience: AUDIENCIA,
    });
    return res.json({ token, usuario: config.adminUsuario });
  });

  // tudo abaixo exige o token do administrador (segredo e público próprios: o token de morador não vale aqui)
  rotas.use((req, res, next) => {
    const auth = req.get("authorization") ?? "";
    try {
      if (!auth.startsWith("Bearer ")) throw new Error("sem token");
      req.admin = jwt.verify(auth.slice(7), config.adminJwtSecret, { algorithms: ["HS256"], issuer: EMISSOR, audience: AUDIENCIA });
      next();
    } catch {
      res.status(401).json({ erro: "Sessão inválida ou expirada. Entre novamente." });
    }
  });

  const tratar = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (erro) {
      if (erro instanceof ErroValidacao) return res.status(400).json({ erro: erro.message, detalhes: erro.erros });
      console.error("Erro no painel:", erro.message);
      return res.status(500).json({ erro: "Erro interno do gateway." });
    }
  };

  rotas.get("/sessao", (req, res) => res.json({ usuario: req.admin.sub }));
  rotas.get("/apis", (_req, res) => res.json(store.listar()));

  rotas.post("/apis", tratar((req, res) => res.status(201).json(store.criar(req.body))));

  rotas.put("/apis/:id", tratar((req, res) => {
    const api = store.atualizar(req.params.id, req.body ?? {});
    return api ? res.json(api) : res.status(404).json({ erro: "API não encontrada." });
  }));

  rotas.delete("/apis/:id", tratar((req, res) => (
    store.remover(req.params.id) ? res.status(204).end() : res.status(404).json({ erro: "API não encontrada." })
  )));

  // Testa se o serviço responde (GET no healthPath cadastrado). Só chama destinos já cadastrados pelo administrador.
  rotas.post("/apis/:id/testar", async (req, res) => {
    const api = store.obter(req.params.id);
    if (!api) return res.status(404).json({ erro: "API não encontrada." });
    const inicio = Date.now();
    try {
      const r = await fetch(`${api.destino}${api.healthPath}`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      return res.json({ ok: r.status >= 200 && r.status < 400, status: r.status, ms: Date.now() - inicio });
    } catch (erro) {
      return res.json({ ok: false, erro: erro.name === "TimeoutError" ? "Sem resposta em 5 segundos." : "Não foi possível conectar.", ms: Date.now() - inicio });
    }
  });

  return rotas;
}

module.exports = { criarAdmin };
