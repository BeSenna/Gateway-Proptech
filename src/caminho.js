// Normalização do caminho que chega ao gateway.
// O proxy do servidor da faculdade retira o prefixo público (/condominio/gateway) e deixa uma barra sobrando
// (//morador/...). Aqui o caminho é limpo e o prefixo, se vier, é removido: o gateway funciona com ou sem ele.
function normalizar(url, prefixo = "") {
  const i = url.indexOf("?");
  let caminho = i === -1 ? url : url.slice(0, i);
  const consulta = i === -1 ? "" : url.slice(i);
  caminho = caminho.replace(/\/{2,}/g, "/");
  if (!caminho.startsWith("/")) caminho = `/${caminho}`;
  if (prefixo && (caminho === prefixo || caminho.startsWith(`${prefixo}/`))) {
    caminho = caminho.slice(prefixo.length) || "/";
  }
  return { caminho, consulta };
}

// ".." e "." permitiriam sair do caminho base do serviço de destino (ex.: /condominio/financeiro/../..).
function temSegmentoPerigoso(caminho) {
  let decodificado;
  try {
    decodificado = decodeURIComponent(caminho);
  } catch {
    return true;
  }
  return decodificado.split(/[\\/]/).some((s) => s === ".." || s === ".");
}

module.exports = { normalizar, temSegmentoPerigoso };
