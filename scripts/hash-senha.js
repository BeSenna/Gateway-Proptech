// Cria o valor de ADMIN_SENHA_HASH (a senha do PAINEL do gateway, em /admin).
// Uso:  npm run hash-senha      (pede a senha duas vezes; nada aparece na tela enquanto você digita)
// Guarde a SENHA no seu gerenciador de senhas e só o HASH impresso no final no Infisical.
const readline = require("node:readline");
const { gerarHash } = require("../src/senha");

function validar(senha) {
  if (senha.length < 10) return "use pelo menos 10 caracteres";
  if (!/[a-z]/.test(senha) || !/[A-Z]/.test(senha) || !/\d/.test(senha) || !/[^A-Za-z0-9]/.test(senha)) {
    return "use maiúscula, minúscula, número e caractere especial";
  }
  return null;
}

// Pergunta sem mostrar o que é digitado (o texto da pergunta aparece; a resposta não).
function perguntarEscondido(pergunta) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let esconder = false;
    rl._writeToOutput = (texto) => { if (!esconder) process.stdout.write(texto); };
    rl.question(pergunta, (resposta) => { rl.close(); process.stdout.write("\n"); resolve(resposta); });
    esconder = true;
  });
}

function mostrarHash(senha) {
  console.log("\nADMIN_SENHA_HASH (cole este valor, sem aspas, no Infisical):\n");
  console.log(gerarHash(senha));
  console.log("\nGuarde a senha no seu gerenciador de senhas. Ela NÃO vai para o Infisical, só o hash acima.");
}

(async () => {
  // Modo direto (aparece no histórico do terminal; prefira o modo interativo):  npm run hash-senha -- "SuaSenha"
  if (process.argv[2] !== undefined) {
    const problema = validar(process.argv[2]);
    if (problema) { console.error(`Senha fraca: ${problema}.`); process.exit(1); }
    return mostrarHash(process.argv[2]);
  }

  console.log("Criar a senha do painel do gateway (tela /admin).");
  console.log("Esta senha ainda NÃO existe: você está criando uma NOVA agora, só para este painel.");
  console.log("Regras: mínimo de 10 caracteres, com maiúscula, minúscula, número e caractere especial.");
  console.log("Nada aparece na tela enquanto você digita (é normal).\n");

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const senha = await perguntarEscondido("Crie a nova senha: ");
    const problema = validar(senha);
    if (problema) { console.error(`Senha fraca: ${problema}. Tente de novo.\n`); continue; }
    const repetida = await perguntarEscondido("Repita a nova senha: ");
    if (repetida !== senha) { console.error("As senhas não são iguais. Tente de novo.\n"); continue; }
    return mostrarHash(senha);
  }
  console.error("Três tentativas sem sucesso. Rode o comando de novo.");
  process.exit(1);
})();
