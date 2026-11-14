// Cadastro de APIs do gateway: um arquivo JSON (data/apis.json), gravado de forma atômica.
// Cada API tem: prefixo público (/morador), destino (URL base do serviço), se exige token, rotas públicas e se está ativa.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RESERVADOS = new Set(["admin", "health"]);
const PREFIXO_RE = /^\/[a-z0-9][a-z0-9_-]{0,39}$/;
const REGRA_PUBLICA_RE = /^(GET|POST|PUT|PATCH|DELETE|\*) \/\S*$/;

class ErroValidacao extends Error {
  constructor(erros) {
    super("Dados inválidos.");
    this.erros = erros;
  }
}

function validar(entrada, existentes, idAtual) {
  const erros = [];
  const d = entrada && typeof entrada === "object" ? entrada : {};

  const nome = typeof d.nome === "string" ? d.nome.trim() : "";
  if (!nome || nome.length > 60) erros.push("nome: informe de 1 a 60 caracteres.");

  let prefixo = typeof d.prefixo === "string" ? d.prefixo.trim().toLowerCase() : "";
  if (prefixo && !prefixo.startsWith("/")) prefixo = `/${prefixo}`;
  if (!PREFIXO_RE.test(prefixo)) {
    erros.push("prefixo: use um segmento como /morador (letras minúsculas, números, - ou _).");
  } else if (RESERVADOS.has(prefixo.slice(1))) {
    erros.push(`prefixo: "${prefixo}" é reservado pelo gateway.`);
  } else if (existentes.some((a) => a.prefixo === prefixo && a.id !== idAtual)) {
    erros.push(`prefixo: "${prefixo}" já está cadastrado em outra API.`);
  }

  let destino = typeof d.destino === "string" ? d.destino.trim() : "";
  try {
    const u = new URL(destino);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("protocolo");
    if (u.username || u.password) throw new Error("credenciais");
    if (u.search || u.hash) throw new Error("consulta");
    if (/^169\.254\./.test(u.hostname)) throw new Error("endereço de metadados");
    destino = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    erros.push("destino: informe uma URL http(s) sem usuário, senha ou parâmetros (ex.: http://10.136.38.50:7522).");
  }

  let healthPath = d.healthPath === undefined || d.healthPath === "" ? "/health" : d.healthPath;
  if (typeof healthPath !== "string" || !healthPath.startsWith("/") || /\s/.test(healthPath) || healthPath.includes("..")) {
    erros.push("healthPath: informe um caminho começando por / (ex.: /health).");
    healthPath = "/health";
  }

  const exigeToken = d.exigeToken === undefined ? true : d.exigeToken;
  if (typeof exigeToken !== "boolean") erros.push("exigeToken: use true ou false.");
  const ativo = d.ativo === undefined ? true : d.ativo;
  if (typeof ativo !== "boolean") erros.push("ativo: use true ou false.");

  let rotasPublicas = d.rotasPublicas === undefined ? [] : d.rotasPublicas;
  if (!Array.isArray(rotasPublicas) || rotasPublicas.length > 50) {
    erros.push("rotasPublicas: informe uma lista com até 50 itens.");
    rotasPublicas = [];
  } else {
    rotasPublicas = [...new Set(rotasPublicas.map((r) => String(r).trim().replace(/\s+/g, " ")).filter(Boolean))];
    const ruins = rotasPublicas.filter((r) => !REGRA_PUBLICA_RE.test(r) || r.includes(".."));
    if (ruins.length) erros.push(`rotasPublicas: formato inválido em "${ruins[0]}" (use "POST /auth/login" ou "GET /docs/*").`);
  }

  if (erros.length) throw new ErroValidacao(erros);
  return { nome, prefixo, destino, healthPath, exigeToken, ativo, rotasPublicas };
}

class ApiStore {
  constructor(dataDir, semente = {}) {
    this.arquivo = path.join(dataDir, "apis.json");
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(this.arquivo)) {
      this.apis = JSON.parse(fs.readFileSync(this.arquivo, "utf8")).apis ?? [];
    } else {
      this.apis = this.#semente(semente);
      this.#gravar();
    }
  }

  #semente({ morador, financeiro, servicos }) {
    const agora = new Date().toISOString();
    const base = (nome, prefixo, destino, rotasPublicas) => ({
      id: crypto.randomUUID(), nome, prefixo, destino, healthPath: "/health",
      exigeToken: true, ativo: true, rotasPublicas, criadoEm: agora, atualizadoEm: agora,
    });
    const lista = [];
    if (morador) lista.push(base("MS Moradores", "/morador", morador, ["POST /auth/login", "GET /health"]));
    if (financeiro) lista.push(base("MS Financeiro", "/financeiro", financeiro, ["GET /health"]));
    if (servicos) lista.push(base("MS Serviços", "/servicos", servicos, ["GET /health"]));
    return lista.map((a) => ({ ...a, ...validar(a, [], a.id) })); // normaliza e valida (URL inválida no Infisical falha na subida)
  }

  #gravar() {
    const temp = `${this.arquivo}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ apis: this.apis }, null, 2));
    fs.renameSync(temp, this.arquivo); // troca atômica: nunca fica um arquivo pela metade
  }

  listar() { return this.apis.map((a) => ({ ...a })); }
  obter(id) { const a = this.apis.find((x) => x.id === id); return a ? { ...a } : null; }

  criar(entrada) {
    const dados = validar(entrada, this.apis, null);
    const agora = new Date().toISOString();
    const api = { id: crypto.randomUUID(), ...dados, criadoEm: agora, atualizadoEm: agora };
    this.apis.push(api);
    this.#gravar();
    return { ...api };
  }

  atualizar(id, entrada) {
    const i = this.apis.findIndex((a) => a.id === id);
    if (i === -1) return null;
    const dados = validar({ ...this.apis[i], ...entrada }, this.apis, id);
    this.apis[i] = { ...this.apis[i], ...dados, atualizadoEm: new Date().toISOString() };
    this.#gravar();
    return { ...this.apis[i] };
  }

  remover(id) {
    const i = this.apis.findIndex((a) => a.id === id);
    if (i === -1) return false;
    this.apis.splice(i, 1);
    this.#gravar();
    return true;
  }

  // Acha a API ativa cujo prefixo casa com o caminho e devolve o resto do caminho para o serviço.
  casar(caminho) {
    const api = this.apis
      .filter((a) => a.ativo && (caminho === a.prefixo || caminho.startsWith(`${a.prefixo}/`)))
      .sort((a, b) => b.prefixo.length - a.prefixo.length)[0];
    if (!api) return null;
    return { api, restante: caminho.slice(api.prefixo.length) || "/" };
  }
}

// Rota pública = não exige token. OPTIONS (pré-voo de CORS) nunca leva token.
function ehPublica(api, metodo, restante) {
  if (!api.exigeToken || metodo === "OPTIONS") return true;
  const caminho = restante.replace(/\/+$/, "") || "/";
  return api.rotasPublicas.some((regra) => {
    const [m, p] = regra.split(" ");
    if (m !== "*" && m !== metodo) return false;
    if (p.endsWith("/*")) {
      const base = p.slice(0, -2) || "/";
      return caminho === base || caminho.startsWith(`${base === "/" ? "" : base}/`);
    }
    return (p.replace(/\/+$/, "") || "/") === caminho;
  });
}

module.exports = { ApiStore, ErroValidacao, validar, ehPublica };
