# API Gateway — PropTech

Ponto de entrada único dos microsserviços (Moradores, Financeiro, Serviços). O frontend chama **um só endereço**; o
gateway descobre qual serviço deve receber a chamada, confere o token nas rotas protegidas e encaminha a requisição.
Segue o modelo da aula de API Gateway: ele **encaminha** (proxy), não redireciona, e **não guarda regra de negócio**.

```
Frontend ──► Gateway (7521) ──┬──► MS Moradores  (7522)
 /condominio/gateway/...      ├──► MS Financeiro (7523)
                              └──► MS Serviços   (7524)
```

- Express + `jsonwebtoken`; sem banco de dados (o cadastro das APIs é o arquivo `data/apis.json`).
- Painel para o desenvolvedor cadastrar/editar APIs: `/admin`.
- Porta **7521**. Público: <http://academico3.rj.senac.br/condominio/gateway>

## Como a chamada é encaminhada

| O frontend chama                                   | O gateway encaminha para                  | Token? |
|----------------------------------------------------|-------------------------------------------|--------|
| `POST /condominio/gateway/morador/auth/login`      | `MS Moradores` → `POST /auth/login`       | não (rota pública cadastrada) |
| `GET  /condominio/gateway/morador/bloco`           | `MS Moradores` → `GET /bloco`             | sim |
| `GET  /condominio/gateway/financeiro/cobranca`     | `MS Financeiro` → `GET <destino>/cobranca` | sim |
| `GET  /condominio/gateway/health`                  | resposta do próprio gateway               | não |
| `GET  /condominio/gateway/admin`                   | painel de cadastro de APIs                | login do painel |

Regras:

1. O **prefixo** (`/morador`) escolhe a API; o resto do caminho, o método, o corpo e a query seguem para o serviço.
   O **destino** pode ter caminho base (ex.: `http://10.136.38.50:7523/condominio/financeiro`).
2. Rotas **protegidas** exigem `Authorization: Bearer <token>`: o gateway confere assinatura (HS256, o mesmo `JWT_SECRET`
   dos microsserviços) e validade. Sem token, inválido ou expirado → `401`. Ele **não** pede login de novo e **não
   substitui** a validação dos serviços: cada microsserviço continua protegendo as suas rotas.
3. **Rotas públicas** (login, saúde) são cadastradas por API, no formato `MÉTODO /caminho` (`GET /docs/*` libera tudo abaixo).
4. Respostas de erro do gateway: `404` rota/API inexistente ou inativa, `502` serviço fora do ar, `504` serviço lento (30 s).
5. Caminhos com `..` são recusados (`400`), para ninguém escapar do caminho base do serviço.

> **Proxy do servidor.** O servidor da faculdade retira `/condominio/gateway` e repassa o resto com uma barra a mais
> (`//morador/...`). O gateway normaliza as barras e aceita o caminho **com ou sem** o prefixo público, então funciona
> nos dois casos (`GATEWAY_PREFIXO`, padrão `/condominio/gateway`).

## Painel de cadastro de APIs (`/admin`)

Tela para o desenvolvedor **cadastrar, editar, ativar/desativar, testar e excluir** APIs, sem mexer em código nem
reiniciar o gateway (vale na hora). Cada API tem: nome, prefixo público, destino (endereço interno), caminho de teste de
saúde, se exige token, rotas públicas e se está ativa. O botão **Testar** faz um `GET` no destino e mostra o resultado.

- Entrada com **usuário e senha próprios** do gateway (`ADMIN_USUARIO` / `ADMIN_SENHA_HASH`); não depende de nenhum microsserviço.
- O token do painel usa segredo e público **próprios** (`ADMIN_JWT_SECRET`): um token de morador não abre o painel e o do painel não vale nas APIs.
- Login com limite de tentativas (10 erros → bloqueio de 15 min), página com CSP por requisição e sem cache.
- Na primeira subida, se `MORADOR_API_URL`/`FINANCEIRO_API_URL`/`SERVICOS_API_URL` existirem, essas APIs já aparecem cadastradas.

## Segredos no Infisical

Obrigatório (padrão do projeto): nada de segredo no código, no `.env` versionado ou no `docker-compose.yml`.
Crie estes segredos no ambiente `dev` do projeto do gateway (o gateway **não sobe** sem os 4 primeiros):

| Segredo | Valor |
|---|---|
| `JWT_SECRET` | **o mesmo** do MS Moradores/Financeiro/Serviços |
| `ADMIN_USUARIO` | usuário do painel |
| `ADMIN_SENHA_HASH` | gerado por `npm run hash-senha` (guarde só o hash, nunca a senha) |
| `ADMIN_JWT_SECRET` | texto longo e aleatório, **diferente** do `JWT_SECRET` |
| `MORADOR_API_URL` | `http://10.136.38.50:7522` (endereço interno do Moradores) |
| `FINANCEIRO_API_URL` | `http://10.136.38.50:7523/condominio/financeiro` |
| `SERVICOS_API_URL` | vazio por enquanto |
| `PORT` | `7521` (opcional) |

Gerar um valor aleatório para o `ADMIN_JWT_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## Rodando na sua máquina (Windows)

```powershell
npm install
npm run hash-senha          # pede a senha (não aparece na tela) e imprime o ADMIN_SENHA_HASH para colar no Infisical
npm run start:dev           # = infisical run --env=dev -- node --watch src/server.js
```

Abra <http://localhost:7521/admin>. Para testar o roteamento com o frontend local, aponte
`NEXT_PUBLIC_API_URL` para o gateway (ver a seção do frontend abaixo).

Sem Infisical (só para um teste rápido): copie `.env.example` para `.env`, preencha e rode `npm start`.

### Frontend

O frontend já usa `NEXT_PUBLIC_API_URL=/condominio/gateway/morador` e `NEXT_PUBLIC_FINANCEIRO_API_URL=/condominio/gateway/financeiro`:
com o gateway no ar e as APIs cadastradas com os prefixos `/morador` e `/financeiro`, **nada muda no frontend em produção**.
No desenvolvimento local o frontend continua podendo chamar os serviços direto (como hoje); o gateway é opcional na sua máquina.

## Docker e Jenkins

```bash
npx infisical run --env=dev -- docker compose up --build     # sobe o gateway em http://localhost:7521
```

- O cadastro de APIs fica no volume Docker `gateway-data` (`/app/data/apis.json`): **sobrevive a deploys**. Não rode `docker compose down -v` no servidor (apaga o volume).
- `Jenkinsfile` (Linux) segue o do MS Moradores: busca os segredos no Infisical, grava um `.env` temporário, sobe com `docker compose`, confere `/health` e apaga o `.env`.
- **Antes do primeiro deploy**, troque no `Jenkinsfile` os dois `COLOQUE_AQUI_...` (ID do projeto do Infisical do gateway e a credencial do Jenkins com o token desse projeto — ambos criados pelo professor) e confira a URL do repositório.
- O `.env` gerado pelo Infisical passa pelo Docker Compose: por isso o hash de senha usa `:` e não `$` (o Compose interpretaria `$`).

## Testes

```bash
npm test      # 19 testes: roteamento, token, barra dupla, 502/504, painel, validações, persistência, senha, configuração
```

Usam serviços de destino falsos; não precisam de banco, Infisical nem rede.

## Estrutura

```
src/server.js        sobe o servidor (lê config, abre o cadastro, escuta a porta)
src/app.js           Express: normaliza caminho → /health → /admin → procura API → token → proxy
src/config.js        variáveis de ambiente (segredos obrigatórios, sem valor padrão)
src/store.js         cadastro de APIs (apis.json atômico), validações e regras públicas
src/proxy.js         encaminhamento em streaming (http/https), timeout, 502/504
src/token.js         validação do JWT (HS256)
src/caminho.js       normalização de barras/prefixo e bloqueio de ".."
src/senha.js         hash scrypt da senha do painel
src/admin/rotas.js   API do painel (login + CRUD + testar)
src/admin/painel.html  a tela (uma página só, sem arquivos externos)
```

## Segurança (resumo)

- HTTPS: o servidor da faculdade ainda publica em `http`; quando houver HTTPS, nada muda no gateway.
- Segredos só no Infisical; logs registram método, caminho e status — **nunca** token, query ou corpo.
- O gateway não é a única barreira: os microsserviços continuam validando o token.
- Só o administrador do painel cadastra destinos (endereços `169.254.x.x`, usuário/senha na URL e parâmetros são recusados).
- O gateway repassa `Authorization` ao serviço, mas não confia em nenhum cabeçalho de identidade vindo do cliente.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Gateway não sobe: `X não definida` | falta o segredo no Infisical (ver tabela acima) |
| `401` em tudo, até logo depois do login | `JWT_SECRET` do gateway diferente do usado pelo MS Moradores |
| `404 Rota não encontrada no Gateway` | prefixo não cadastrado ou API desativada no painel |
| `502 Serviço de destino indisponível` | destino errado/fora do ar (use o botão **Testar** no painel) |
| Painel: "Muitas tentativas" | 10 senhas erradas seguidas; aguarde 15 min |
| Cadastro sumiu depois do deploy | o volume `gateway-data` foi removido (`down -v`) |
