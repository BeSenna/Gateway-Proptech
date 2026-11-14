const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const { subirDestino, subirGateway, tokenMorador, JWT_SECRET } = require("./ajuda");

async function cenario(respostaDestino, destinoExtra = "") {
  const destino = await subirDestino(respostaDestino);
  const gw = await subirGateway({ semente: { morador: destino.url + destinoExtra } });
  return { destino, gw, fechar: async () => { await gw.fechar(); await destino.fechar(); } };
}

test("rota pública (login) passa sem token e chega ao serviço sem o prefixo", async (t) => {
  const c = await cenario({ status: 201, corpo: { accessToken: "x" } });
  t.after(c.fechar);
  const r = await fetch(`${c.gw.url}/morador/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuarioLogin: "a", usuarioSenha: "b" }),
  });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { accessToken: "x" });
  assert.equal(c.destino.recebidas[0].url, "/auth/login");
  assert.equal(c.destino.recebidas[0].metodo, "POST");
  assert.equal(c.destino.recebidas[0].corpo, JSON.stringify({ usuarioLogin: "a", usuarioSenha: "b" }));
});

test("rota protegida: sem token, token inválido, de outro segredo e expirado dão 401", async (t) => {
  const c = await cenario();
  t.after(c.fechar);
  const chamar = (auth) => fetch(`${c.gw.url}/morador/bloco`, { headers: auth ? { Authorization: auth } : {} });
  assert.equal((await chamar()).status, 401);
  assert.equal((await chamar("Bearer lixo")).status, 401);
  assert.equal((await chamar("Basic abc")).status, 401);
  assert.equal((await chamar(`Bearer ${jwt.sign({ sub: 1 }, "outro-segredo")}`)).status, 401);
  assert.equal((await chamar(`Bearer ${tokenMorador({}, { expiresIn: -10 })}`)).status, 401);
  assert.equal((await chamar(`Bearer ${jwt.sign({ sub: 1 }, JWT_SECRET, { algorithm: "HS512" })}`)).status, 401, "algoritmo fora do esperado");
  assert.equal(c.destino.recebidas.length, 0, "nada disso pode ter chegado ao serviço");
});

test("token válido passa; Authorization, query e status do serviço são preservados", async (t) => {
  const c = await cenario((req) => (req.url.startsWith("/bloco/99") ? { status: 404, corpo: { message: "nao achei" } } : { status: 200, corpo: [1, 2] }));
  t.after(c.fechar);
  const auth = { Authorization: `Bearer ${tokenMorador()}` };
  const ok = await fetch(`${c.gw.url}/morador/bloco?pagina=2&nome=A%20B`, { headers: auth });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), [1, 2]);
  assert.equal(c.destino.recebidas[0].url, "/bloco?pagina=2&nome=A%20B");
  assert.equal(c.destino.recebidas[0].cabecalhos.authorization, auth.Authorization);
  assert.match(c.destino.recebidas[0].cabecalhos["x-forwarded-for"], /127\.0\.0\.1/);
  const naoAcha = await fetch(`${c.gw.url}/morador/bloco/99`, { headers: auth });
  assert.equal(naoAcha.status, 404);
  assert.deepEqual(await naoAcha.json(), { message: "nao achei" });
});

test("aceita o caminho como o proxy do servidor entrega: barra dupla e/ou prefixo público", async (t) => {
  const c = await cenario();
  t.after(c.fechar);
  const auth = { Authorization: `Bearer ${tokenMorador()}` };
  for (const caminho of ["//morador/bloco", "/condominio/gateway/morador/bloco", "//condominio/gateway/morador/bloco", "///morador//bloco"]) {
    const r = await fetch(`${c.gw.url}${caminho}`, { headers: auth });
    assert.equal(r.status, 200, caminho);
  }
  assert.ok(c.destino.recebidas.every((x) => x.url === "/bloco"), "o serviço sempre recebe /bloco");
  const saude = await fetch(`${c.gw.url}//health`);
  assert.equal(saude.status, 200);
});

test("destino com caminho base (Financeiro) e proteção contra .. no caminho", async (t) => {
  const c = await cenario(undefined, "/condominio/financeiro");
  t.after(c.fechar);
  const auth = { Authorization: `Bearer ${tokenMorador()}` };
  await fetch(`${c.gw.url}/morador/cobranca?x=1`, { headers: auth });
  assert.equal(c.destino.recebidas[0].url, "/condominio/financeiro/cobranca?x=1");
  // caminho CRU (o fetch normalizaria o ".." antes de enviar)
  const cru = (caminho) => new Promise((resolve, reject) => {
    http.get(`${c.gw.url}`.replace(/\/$/, "") + "", { path: caminho, headers: auth }, (r) => { r.resume(); resolve(r.statusCode); }).on("error", reject);
  });
  for (const ruim of ["/morador/../admin", "/morador/a/../../b", "/morador/%2e%2e/segredo", "/morador/a/..%2f..%2fb", "/morador/%zz"]) {
    const status = await cru(ruim);
    assert.ok([400, 404].includes(status), `${ruim} → ${status}`);
  }
  assert.equal(c.destino.recebidas.length, 1, "nenhuma tentativa de escapar chegou ao serviço");
});

test("corpo e método repassados (PUT/DELETE) e cabeçalhos do serviço devolvidos", async (t) => {
  const c = await cenario((req) => ({ status: 200, corpo: { metodo: req.method }, cabecalhos: { "X-Total": "7" } }));
  t.after(c.fechar);
  const auth = { Authorization: `Bearer ${tokenMorador()}`, "Content-Type": "application/json" };
  const put = await fetch(`${c.gw.url}/morador/bloco/1`, { method: "PUT", headers: auth, body: JSON.stringify({ blocoNome: "B" }) });
  assert.equal(put.headers.get("x-total"), "7");
  assert.equal(c.destino.recebidas[0].corpo, JSON.stringify({ blocoNome: "B" }));
  const del = await fetch(`${c.gw.url}/morador/bloco/1`, { method: "DELETE", headers: auth });
  assert.deepEqual(await del.json(), { metodo: "DELETE" });
});

test("rota desconhecida e API inativa dão 404; serviço fora do ar dá 502; serviço lento dá 504", async (t) => {
  const c = await cenario({ demora: 4000 });
  t.after(c.fechar);
  const auth = { Authorization: `Bearer ${tokenMorador()}` };
  assert.equal((await fetch(`${c.gw.url}/naoexiste/x`, { headers: auth })).status, 404);
  const lento = await fetch(`${c.gw.url}/morador/bloco`, { headers: auth });
  assert.equal(lento.status, 504);

  const [api] = c.gw.store.listar();
  c.gw.store.atualizar(api.id, { ativo: false });
  assert.equal((await fetch(`${c.gw.url}/morador/bloco`, { headers: auth })).status, 404);

  c.gw.store.atualizar(api.id, { ativo: true, destino: "http://127.0.0.1:1" }); // porta sem ninguém
  const fora = await fetch(`${c.gw.url}/morador/bloco`, { headers: auth });
  assert.equal(fora.status, 502);
  assert.deepEqual(await fora.json(), { erro: "Serviço de destino indisponível." });
});

test("API cadastrada sem exigir token passa livre; regra curinga /* libera o que está abaixo", async (t) => {
  const c = await cenario();
  t.after(c.fechar);
  const [api] = c.gw.store.listar();
  c.gw.store.atualizar(api.id, { rotasPublicas: ["GET /docs/*", "* /aberto"] });
  assert.equal((await fetch(`${c.gw.url}/morador/docs`)).status, 200);
  assert.equal((await fetch(`${c.gw.url}/morador/docs/json`)).status, 200);
  assert.equal((await fetch(`${c.gw.url}/morador/documentos`)).status, 401, "docs/* não pode liberar documentos");
  assert.equal((await fetch(`${c.gw.url}/morador/aberto`, { method: "POST" })).status, 200);
  assert.equal((await fetch(`${c.gw.url}/morador/bloco`)).status, 401);
  c.gw.store.atualizar(api.id, { exigeToken: false });
  assert.equal((await fetch(`${c.gw.url}/morador/bloco`)).status, 200);
});

test("/health do gateway é público e informa as APIs", async (t) => {
  const c = await cenario();
  t.after(c.fechar);
  const r = await fetch(`${c.gw.url}/health`);
  const corpo = await r.json();
  assert.equal(r.status, 200);
  assert.equal(corpo.status, "Healthy");
  assert.deepEqual(corpo.checks.apis, { cadastradas: 1, ativas: 1 });
});
