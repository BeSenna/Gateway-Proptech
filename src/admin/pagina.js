// Página do painel: um único HTML com estilo e script embutidos (nada de arquivos externos, então funciona em
// qualquer prefixo do proxy). A política de segurança (CSP) só aceita o script/estilo com o "nonce" desta resposta.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "painel.html"), "utf8");

function paginaAdmin(res) {
  const nonce = crypto.randomBytes(16).toString("base64");
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, "connect-src 'self'",
      "img-src 'self' data:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
  });
  res.send(html.replaceAll("__NONCE__", nonce));
}

module.exports = { paginaAdmin };
