// Configuração do gateway. Tudo vem de variáveis de ambiente (no dia a dia, do Infisical; localmente, de um .env).
// Segredos NUNCA têm valor padrão: sem eles o gateway não sobe, em vez de rodar "aberto" por esquecimento.
const path = require("node:path");

function obrigatoria(env, nome) {
  const valor = (env[nome] ?? "").trim();
  if (!valor) throw new Error(`${nome} não definida. Defina no Infisical (ou no .env).`);
  return valor;
}

function carregarConfig(env = process.env) {
  const jwtSecret = obrigatoria(env, "JWT_SECRET");
  const adminJwtSecret = obrigatoria(env, "ADMIN_JWT_SECRET");
  if (adminJwtSecret === jwtSecret) {
    throw new Error("ADMIN_JWT_SECRET precisa ser diferente de JWT_SECRET (o token do painel não pode valer nas APIs).");
  }
  return {
    port: Number(env.PORT) || 7521,
    // Segredo que assina os tokens emitidos pelo MS Moradores (o mesmo dos outros microsserviços).
    jwtSecret,
    // Segredo próprio do painel de administração do gateway.
    adminJwtSecret,
    adminUsuario: obrigatoria(env, "ADMIN_USUARIO"),
    adminSenhaHash: obrigatoria(env, "ADMIN_SENHA_HASH"), // gerado por: npm run hash-senha
    adminTokenExpira: env.ADMIN_TOKEN_EXPIRA || "2h",
    // Onde fica o cadastro de APIs (um arquivo JSON). No Docker é um volume, para sobreviver aos deploys.
    dataDir: path.resolve(env.DATA_DIR || "data"),
    // O proxy do servidor pode repassar o caminho com ou sem este prefixo; o gateway aceita os dois.
    prefixoPublico: (env.GATEWAY_PREFIXO ?? "/condominio/gateway").replace(/\/+$/, ""),
    timeoutMs: Number(env.PROXY_TIMEOUT_MS) || 30000,
    // Usados só na primeira subida, para já deixar Moradores/Financeiro/Serviços cadastrados.
    semente: {
      morador: (env.MORADOR_API_URL ?? "").trim(),
      financeiro: (env.FINANCEIRO_API_URL ?? "").trim(),
      servicos: (env.SERVICOS_API_URL ?? "").trim(),
    },
  };
}

module.exports = { carregarConfig };
