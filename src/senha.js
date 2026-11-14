// Hash de senha do administrador do gateway (scrypt, nativo do Node: sem dependência extra).
// Formato guardado no Infisical (ADMIN_SENHA_HASH):  scrypt:<sal em hex>:<hash em hex>
// (separador ":" e não "$": o Docker Compose interpreta "$" dentro do .env e corromperia o valor)
const crypto = require("node:crypto");

function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 64);
  return `scrypt:${sal.toString("hex")}:${hash.toString("hex")}`;
}

function conferir(senha, guardado) {
  const partes = String(guardado).split(":");
  if (partes.length !== 3 || partes[0] !== "scrypt") return false;
  try {
    const esperado = Buffer.from(partes[2], "hex");
    const obtido = crypto.scryptSync(String(senha), Buffer.from(partes[1], "hex"), esperado.length);
    return esperado.length > 0 && crypto.timingSafeEqual(esperado, obtido);
  } catch {
    return false;
  }
}

function iguais(a, b) {
  // compara em tempo constante, mesmo com tamanhos diferentes
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { gerarHash, conferir, iguais };
