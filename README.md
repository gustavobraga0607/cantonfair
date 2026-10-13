# Canton Fair Buyer by BR Trading

Aplicativo web (instalável no celular como PWA) de apoio a compradores na **Feira de Cantão**:
cadastre fornecedores e produtos durante as visitas aos stands, calcule o custo estimado no
Brasil e veja quais itens — e quais fornecedores — são mais vantajosos.

## Funcionalidades

- **Login com e-mail e senha** (senhas com hash scrypt, sessão em cookie HttpOnly).
- **Cadastro de usuário**: nome, e-mail, senha e CNPJ.
  - O CNPJ é validado pelos dígitos verificadores (inclui o novo **CNPJ alfanumérico**) e
    consultado na Receita Federal via [BrasilAPI](https://brasilapi.com.br/) — CNPJ inexistente é recusado
    e a razão social é exibida. Se a consulta estiver fora do ar, vale a validação dos dígitos.
- **Dados compartilhados por CNPJ**: todos os usuários de um mesmo CNPJ veem e editam os mesmos
  fornecedores, produtos e câmbio. Empresas diferentes nunca enxergam os dados umas das outras
  (inclusive as fotos).
- **Fornecedores**: nome\*, foto do cartão de visitas\* (tirada direto pela câmera), nº do stand, observações.
- **Produtos**: nome, foto, preço no Brasil (R$) e uma ou mais ofertas — cada oferta tem
  fornecedor, preço em US$, MOQ, Incoterm e % de custo de nacionalização.
  Um mesmo produto pode ter vários fornecedores.
- **Cálculo**: `preço estimado no Brasil = preço US$ × (1 + % nacionalização) × câmbio`.
  O câmbio (R$ por US$) é configurável em *Conta* e vale para toda a equipe do CNPJ.
- **Ranking de vantagens**:
  - *Por produto*: melhor fornecedor de cada item (menor preço estimado), comparação com o preço
    no Brasil e economia em R$ e %; ordenado do mais vantajoso para o menos.
  - *Melhores fornecedores*: em quantos produtos cada fornecedor é a melhor opção e a economia total.

## Publicar na Vercel

O projeto já está pronto para a Vercel (`vercel.json` + função em `api/index.js`).
Como a Vercel não tem disco persistente, em produção os dados e as fotos ficam num banco **Postgres**.

1. Em [vercel.com/new](https://vercel.com/new), importe este repositório do GitHub
   (Framework Preset: **Other**; não precisa mudar build nem output).
2. No projeto criado, abra **Storage → Create Database → Neon (Postgres)** e conecte ao projeto.
   Isso cria automaticamente as variáveis `DATABASE_URL`/`POSTGRES_URL`.
   (Qualquer Postgres serve — Supabase, Neon, etc. — basta definir `DATABASE_URL`.)
3. Faça **Redeploy**. As tabelas são criadas sozinhas na primeira requisição.

A cada `git push` a Vercel publica uma nova versão automaticamente. O HTTPS da Vercel
já permite instalar o app no celular ("Adicionar à tela inicial") e usar a câmera.

## Executar localmente

Requer **Node.js 22.5+**. Sem `DATABASE_URL`, usa o SQLite embutido do Node (zero configuração).

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes (SQLite); TEST_DATABASE_URL=postgres://... npm test para testar no Postgres
```

Variáveis de ambiente:

| Variável | Padrão | Descrição |
|---|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | — | Postgres (obrigatório na Vercel). Sem ela, usa SQLite local |
| `PORT` | `3000` | Porta HTTP (local) |
| `DATA_DIR` | `./data` | Pasta do banco SQLite local |
| `CNPJ_ONLINE_CHECK` | `true` | `false` desativa a consulta à Receita (só valida os dígitos) |
| `CNPJ_API_URL` | BrasilAPI | URL base da consulta de CNPJ |
| `SECURE_COOKIES` | `false` | Cookies só via HTTPS (automático na Vercel) |

## Estrutura

```
server.js          # servidor HTTP local
api/index.js       # função serverless da Vercel
vercel.json        # configuração da Vercel (rotas /api e /uploads)
src/config.js      # monta o app a partir das variáveis de ambiente
src/app.js         # rotas da API, autenticação, fotos e arquivos estáticos
src/db.js          # esquema e acesso ao banco (Postgres ou SQLite)
src/cnpj.js        # validação e consulta de CNPJ
src/calc.js        # cálculo de preço estimado e ranking
src/auth.js        # hash de senha, sessões, limite de tentativas de login
public/            # interface (HTML/CSS/JS, PWA)
test/              # testes (node:test)
```
