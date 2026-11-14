// Validação do token que o cliente manda nas rotas protegidas: "Authorization: Bearer <token>".
// O gateway confere assinatura e validade (HS256, o mesmo segredo dos microsserviços). Não pede login de novo e NÃO
// substitui a validação das próprias APIs: cada microsserviço continua protegendo as suas rotas.
const jwt = require("jsonwebtoken");

function validarToken(req, segredo) {
  const autorizacao = req.get("authorization");
  if (!autorizacao || !autorizacao.startsWith("Bearer ")) {
    return { ok: false, erro: "Token de acesso não informado." };
  }
  try {
    const dados = jwt.verify(autorizacao.slice("Bearer ".length), segredo, { algorithms: ["HS256"] });
    return { ok: true, dados };
  } catch {
    return { ok: false, erro: "Token inválido ou expirado." };
  }
}

module.exports = { validarToken };
