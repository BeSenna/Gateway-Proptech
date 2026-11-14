require("dotenv").config(); // só para uso local; no servidor as variáveis vêm do Infisical
const { carregarConfig } = require("./config");
const { ApiStore } = require("./store");
const { criarApp } = require("./app");

const config = carregarConfig();
const store = new ApiStore(config.dataDir, config.semente);
const app = criarApp(config, store);

const servidor = app.listen(config.port, () => {
  console.log(`API Gateway ativo na porta ${config.port} (${store.listar().length} API(s) cadastrada(s))`);
});

// Docker/Jenkins mandam SIGTERM ao trocar o container: termina as chamadas em andamento antes de sair.
for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
