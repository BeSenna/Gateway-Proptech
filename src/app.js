// Monta o aplicativo Express do gateway (separado do server.js para os testes poderem subir várias instâncias).
const express = require("express");
const { normalizar, temSegmentoPerigoso } = require("./caminho");
const { validarToken } = require("./token");
const { encaminhar } = require("./proxy");
const { ehPublica } = require("./store");
const { criarAdmin } = require("./admin/rotas");
const { paginaAdmin } = require("./admin/pagina");

function criarApp(config, store) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  // 1) caminho limpo (barra dupla, prefixo público) antes de qualquer rota
  app.use((req, _res, next) => {
    const { caminho, consulta } = normalizar(req.url, config.prefixoPublico);
    req.caminho = caminho;
    req.consulta = consulta;
    req.url = caminho + consulta;
    next();
  });

  // 2) log de acesso: método, caminho (sem a query, que pode ter dados) e status. Nunca registra tokens.
  app.use((req, res, next) => {
    const inicio = Date.now();
    res.on("finish", () => console.log(`${req.method} ${req.caminho} ${res.statusCode} ${Date.now() - inicio}ms`));
    next();
  });

  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });

  // 3) saúde do próprio gateway (pública)
  app.get("/health", (_req, res) => {
    const apis = store.listar();
    res.json({ status: "Healthy", checks: { gateway: "up", apis: { cadastradas: apis.length, ativas: apis.filter((a) => a.ativo).length } } });
  });

  // 4) painel de administração (página) e a API do painel
  app.get(["/admin", "/admin/"], (_req, res) => paginaAdmin(res));
  app.use("/admin/api", express.json({ limit: "100kb" }), criarAdmin(config, store));

  // 5) todo o resto: procura a API cadastrada, confere o token (se a rota for protegida) e encaminha
  app.use((req, res) => {
    if (temSegmentoPerigoso(req.caminho)) return res.status(400).json({ erro: "Caminho inválido." });
    const alvo = store.casar(req.caminho);
    if (!alvo) return res.status(404).json({ erro: "Rota não encontrada no Gateway." });

    if (!ehPublica(alvo.api, req.method, alvo.restante)) {
      const resultado = validarToken(req, config.jwtSecret);
      if (!resultado.ok) return res.status(401).json({ erro: resultado.erro });
    }
    return encaminhar({ api: alvo.api, restante: alvo.restante, consulta: req.consulta, req, res, timeoutMs: config.timeoutMs });
  });

  // erros inesperados: resposta genérica, sem expor detalhes internos
  // eslint-disable-next-line no-unused-vars
  app.use((erro, _req, res, _next) => {
    if (erro.type === "entity.parse.failed") return res.status(400).json({ erro: "JSON inválido." });
    if (erro.type === "entity.too.large") return res.status(413).json({ erro: "Corpo grande demais." });
    console.error("Erro inesperado:", erro.message);
    return res.status(500).json({ erro: "Erro interno do gateway." });
  });

  return app;
}

module.exports = { criarApp };
