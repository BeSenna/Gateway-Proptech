// Gera o valor de ADMIN_SENHA_HASH. Uso:  npm run hash-senha -- "SuaSenhaForte@123"
// (ou sem argumento: a senha é pedida e não aparece na tela). Guarde SÓ o hash no Infisical.
const readline = require("node:readline");
const { gerarHash } = require("../src/senha");

function validar(senha) {
  if (senha.length < 10) return "use pelo menos 10 caracteres";
  if (!/[a-z]/.test(senha) || !/[A-Z]/.test(senha) || !/\d/.test(senha) || !/[^A-Za-z0-9]/.test(senha)) {
    return "use maiúscula, minúscula, número e caractere especial";
  }
  return null;
}

function pedir() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes("Senha")) process.stdout.write(s); };
    rl.question("Senha do administrador do gateway: ", (r) => { rl.close(); process.stdout.write("\n"); resolve(r); });
  });
}

(async () => {
  const senha = process.argv[2] ?? (await pedir());
  const problema = validar(senha);
  if (problema) { console.error(`Senha fraca: ${problema}.`); process.exit(1); }
  console.log("\nADMIN_SENHA_HASH (cole no Infisical):\n");
  console.log(gerarHash(senha));
})();
