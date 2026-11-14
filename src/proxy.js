// Encaminhamento (proxy) de uma chamada para o serviço de destino, em streaming (não lê nem reescreve o corpo:
// funciona com JSON, arquivos e PDFs). O cliente continua falando só com o gateway.
const http = require("node:http");
const https = require("node:https");

const SALTO_A_SALTO = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host",
]);

function filtrar(cabecalhos) {
  const saida = {};
  for (const [nome, valor] of Object.entries(cabecalhos)) {
    if (!SALTO_A_SALTO.has(nome.toLowerCase()) && valor !== undefined) saida[nome] = valor;
  }
  return saida;
}

function responderErro(res, status, erro) {
  if (res.headersSent) return res.destroy();
  res.status(status).json({ erro });
}

function encaminhar({ api, restante, consulta, req, res, timeoutMs }) {
  const destino = new URL(api.destino);
  const cliente = destino.protocol === "https:" ? https : http;
  const cabecalhos = filtrar(req.headers);
  cabecalhos.host = destino.host;
  const ip = req.socket.remoteAddress ?? "";
  cabecalhos["x-forwarded-for"] = [req.headers["x-forwarded-for"], ip].filter(Boolean).join(", ");
  cabecalhos["x-forwarded-host"] = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
  cabecalhos["x-forwarded-proto"] = req.headers["x-forwarded-proto"] ?? "http";

  const proximo = cliente.request(
    {
      protocol: destino.protocol,
      hostname: destino.hostname,
      port: destino.port || undefined,
      method: req.method,
      path: `${destino.pathname.replace(/\/+$/, "")}${restante}${consulta}`,
      headers: cabecalhos,
      timeout: timeoutMs,
    },
    (resposta) => {
      res.writeHead(resposta.statusCode ?? 502, filtrar(resposta.headers));
      resposta.pipe(res);
      resposta.on("error", () => res.destroy());
    },
  );

  let tempoEsgotado = false;
  proximo.on("timeout", () => { tempoEsgotado = true; proximo.destroy(); });
  proximo.on("error", (erro) => {
    console.error(`Falha ao acessar ${api.nome} (${destino.host}): ${tempoEsgotado ? "tempo esgotado" : erro.code ?? erro.message}`);
    if (tempoEsgotado) responderErro(res, 504, "O serviço de destino demorou demais para responder.");
    else responderErro(res, 502, "Serviço de destino indisponível.");
  });
  res.on("close", () => { if (!res.writableEnded) proximo.destroy(); });
  req.pipe(proximo);
}

module.exports = { encaminhar };
