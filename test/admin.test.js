const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { subirDestino, subirGateway, tokenMorador, loginAdmin, ADMIN_JWT_SECRET, JWT_SECRET } = require("./ajuda");
const { ApiStore } = require("../src/store");
const { gerarHash, conferir } = require("../src/senha");
const { carregarConfig } = require("../src/config");

const json = (token, metodo, corpo) => ({
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(corpo ? { body: JSON.stringify(corpo) } : {}),
});

async function admin(t, opcoes) {
  const gw = await subirGateway(opcoes);
  t.after(gw.fechar);
  const { token } = await (await loginAdmin(gw.url)).json();
  return { gw, token };
}

test("login do painel: certo entra; usuário ou senha errados dão 401 com a mesma mensagem", async (t) => {
  const gw = await subirGateway();
  t.after(gw.fechar);
  const ok = await loginAdmin(gw.url);
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).token);
  const senhaErrada = await loginAdmin(gw.url, "errada");
  const usuarioErrado = await loginAdmin(gw.url, undefined, "outro");
  assert.equal(senhaErrada.status, 401);
  assert.equal(usuarioErrado.status, 401);
  assert.deepEqual(await senhaErrada.json(), await usuarioErrado.json());
});

test("depois de muitas falhas o login é bloqueado (429) até a janela passar", async (t) => {
  const gw = await subirGateway();
  t.after(gw.fechar);
  for (let i = 0; i < 10; i++) assert.equal((await loginAdmin(gw.url, "errada")).status, 401);
  const bloqueado = await loginAdmin(gw.url, "errada");
  assert.equal(bloqueado.status, 429);
  assert.ok(bloqueado.headers.get("retry-after"));
});

test("a API do painel exige o token do administrador; token de morador e token do painel não se misturam", async (t) => {
  const { gw, token } = await admin(t);
  assert.equal((await fetch(`${gw.url}/admin/api/apis`)).status, 401);
  assert.equal((await fetch(`${gw.url}/admin/api/apis`, json(tokenMorador(), "GET"))).status, 401, "token de morador não abre o painel");
  assert.equal((await fetch(`${gw.url}/admin/api/apis`, json(jwt.sign({ sub: "admin" }, ADMIN_JWT_SECRET), "GET"))).status, 401, "sem emissor/público");
  assert.equal((await fetch(`${gw.url}/admin/api/apis`, json(token, "GET"))).status, 200);
  assert.equal((await fetch(`${gw.url}/admin/api/sessao`, json(token, "GET"))).status, 200);

  // o token do painel também não vale nas APIs cadastradas
  const destino = await subirDestino();
  t.after(destino.fechar);
  await fetch(`${gw.url}/admin/api/apis`, json(token, "POST", { nome: "X", prefixo: "/x", destino: destino.url }));
  assert.equal((await fetch(`${gw.url}/x/algo`, json(token, "GET"))).status, 401);
  assert.equal(destino.recebidas.length, 0);
});

test("cadastrar, listar, editar, testar e excluir uma API; a rota passa a valer na hora", async (t) => {
  const destino = await subirDestino((req) => ({ status: req.url === "/saude" ? 200 : 200, corpo: { url: req.url } }));
  t.after(destino.fechar);
  const { gw, token } = await admin(t);

  const novo = await fetch(`${gw.url}/admin/api/apis`, json(token, "POST", {
    nome: "MS Serviços", prefixo: "Servicos", destino: `${destino.url}/`, healthPath: "/saude", rotasPublicas: ["GET /avisos", " GET  /avisos ", "GET /docs/*"],
  }));
  assert.equal(novo.status, 201);
  const api = await novo.json();
  assert.equal(api.prefixo, "/servicos", "prefixo normalizado");
  assert.equal(api.destino, destino.url, "barra final removida");
  assert.equal(api.exigeToken, true);
  assert.deepEqual(api.rotasPublicas, ["GET /avisos", "GET /docs/*"], "duplicadas e espaços tratados");

  // vale imediatamente, sem reiniciar
  assert.equal((await fetch(`${gw.url}/servicos/avisos`)).status, 200);
  assert.equal((await fetch(`${gw.url}/servicos/reservas`)).status, 401);

  const edit = await fetch(`${gw.url}/admin/api/apis/${api.id}`, json(token, "PUT", { exigeToken: false }));
  assert.equal(edit.status, 200);
  assert.equal((await fetch(`${gw.url}/servicos/reservas`)).status, 200);

  const teste = await (await fetch(`${gw.url}/admin/api/apis/${api.id}/testar`, json(token, "POST"))).json();
  assert.equal(teste.ok, true);
  assert.equal(destino.recebidas.at(-1).url, "/saude");

  assert.equal((await fetch(`${gw.url}/admin/api/apis/${api.id}`, json(token, "DELETE"))).status, 204);
  assert.equal((await fetch(`${gw.url}/servicos/avisos`)).status, 404);
  assert.equal((await fetch(`${gw.url}/admin/api/apis/${api.id}`, json(token, "DELETE"))).status, 404);
});

test("testar aponta serviço fora do ar sem derrubar o painel", async (t) => {
  const { gw, token } = await admin(t);
  const api = await (await fetch(`${gw.url}/admin/api/apis`, json(token, "POST", { nome: "Fora", prefixo: "/fora", destino: "http://127.0.0.1:1" }))).json();
  const r = await (await fetch(`${gw.url}/admin/api/apis/${api.id}/testar`, json(token, "POST"))).json();
  assert.equal(r.ok, false);
  assert.ok(r.erro);
});

test("validações: prefixo reservado/duplicado/inválido, destino inválido, regras públicas mal escritas", async (t) => {
  const { gw, token } = await admin(t, { semente: { morador: "http://127.0.0.1:9" } });
  const base = { nome: "A", prefixo: "/a", destino: "http://127.0.0.1:9" };
  const tenta = async (extra) => {
    const r = await fetch(`${gw.url}/admin/api/apis`, json(token, "POST", { ...base, ...extra }));
    return { status: r.status, corpo: await r.json() };
  };
  for (const extra of [
    { prefixo: "/admin" }, { prefixo: "/health" }, { prefixo: "/morador" }, // reservados e duplicado (a semente criou /morador)
    { prefixo: "/a/b" }, { prefixo: "/A B" }, { prefixo: "" },
    { destino: "ftp://x" }, { destino: "não é url" }, { destino: "http://u:s@h" }, { destino: "http://h/?a=1" }, { destino: "http://169.254.169.254" },
    { nome: "" }, { nome: "x".repeat(61) }, { exigeToken: "sim" }, { healthPath: "sem-barra" },
    { rotasPublicas: ["LOGIN /x"] }, { rotasPublicas: ["GET x"] }, { rotasPublicas: "GET /x" },
  ]) {
    const r = await tenta(extra);
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.ok(r.corpo.detalhes.length >= 1);
  }
  assert.equal((await fetch(`${gw.url}/admin/api/apis`, { ...json(token, "POST"), body: "{quebrado" })).status, 400);
});

test("o cadastro sobrevive a reinício (arquivo JSON) e a semente só vale na primeira subida", async (t) => {
  const { gw, token } = await admin(t, { semente: { morador: "http://127.0.0.1:7522", financeiro: "http://127.0.0.1:7523/condominio/financeiro" } });
  const semente = gw.store.listar();
  assert.deepEqual(semente.map((a) => a.prefixo).sort(), ["/financeiro", "/morador"]);
  assert.deepEqual(semente.find((a) => a.prefixo === "/morador").rotasPublicas, ["POST /auth/login", "GET /health"]);

  await fetch(`${gw.url}/admin/api/apis`, json(token, "POST", { nome: "Nova", prefixo: "/nova", destino: "http://127.0.0.1:9" }));
  const depois = new ApiStore(gw.dataDir, { servicos: "http://outro:1" }); // "reinicia" lendo o mesmo diretório
  assert.deepEqual(depois.listar().map((a) => a.prefixo).sort(), ["/financeiro", "/morador", "/nova"], "não recria a semente nem perde o que foi cadastrado");
});

test("painel (HTML): servido com e sem barra final, com CSP por requisição e sem cache", async (t) => {
  const gw = await subirGateway();
  t.after(gw.fechar);
  for (const caminho of ["/admin", "/admin/", "//admin", "/condominio/gateway/admin"]) {
    const r = await fetch(`${gw.url}${caminho}`);
    assert.equal(r.status, 200, caminho);
    const html = await r.text();
    assert.match(r.headers.get("content-type"), /text\/html/);
    const csp = r.headers.get("content-security-policy");
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)[1];
    assert.ok(html.includes(`nonce="${nonce}"`), "o nonce da resposta está no script");
    assert.ok(!html.includes("__NONCE__"));
    assert.match(csp, /default-src 'none'/);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  const a = (await fetch(`${gw.url}/admin`)).headers.get("content-security-policy");
  const b = (await fetch(`${gw.url}/admin`)).headers.get("content-security-policy");
  assert.notEqual(a, b, "nonce novo a cada resposta");
});

test("senha: hash scrypt confere a certa e rejeita a errada e formatos quebrados", () => {
  const h = gerarHash("Segredo@123456");
  assert.match(h, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(conferir("Segredo@123456", h), true);
  assert.equal(conferir("segredo@123456", h), false);
  assert.notEqual(gerarHash("Segredo@123456"), h, "sal diferente a cada hash");
  for (const ruim of ["", "abc", "scrypt:zz:zz", "md5:aa:bb", "scrypt$aa$bb", undefined]) assert.equal(conferir("x", ruim), false);
});

test("configuração: sem segredos o gateway não sobe, e o segredo do painel não pode ser o dos serviços", () => {
  const ok = { JWT_SECRET: "a", ADMIN_JWT_SECRET: "b", ADMIN_USUARIO: "u", ADMIN_SENHA_HASH: "h" };
  assert.equal(carregarConfig(ok).port, 7521);
  for (const falta of Object.keys(ok)) {
    const env = { ...ok }; delete env[falta];
    assert.throws(() => carregarConfig(env), new RegExp(falta));
  }
  assert.throws(() => carregarConfig({ ...ok, ADMIN_JWT_SECRET: JWT_SECRET, JWT_SECRET }), /diferente/);
});
