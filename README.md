# Missão China by BR Trading

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
- **Administrador**: usuários com papel `admin` veem e editam fornecedores e produtos de **todas** as
  empresas, com filtro por empresa nas listas e no ranking, e podem cadastrar itens em nome de qualquer empresa.
  Os e-mails de administrador vêm da variável `ADMIN_EMAILS` (padrão: `gustavo.braga0607@gmail.com`);
  o papel é gravado na coluna `users.role` no login.
- **Administração de usuários e empresas** (aba *Conta* → *Usuários e empresas*, só administrador): lista todos os
  usuários e empresas, permite mudar a empresa de um usuário e excluir usuários (exceto a si mesmo). Uma empresa só
  pode ser excluída quando não tiver mais usuários; a exclusão apaga fornecedores, produtos, roteiros e fotos dela.
- **Fornecedores**: nome\*, foto do cartão de visitas\* (tirada direto pela câmera), nome de contato, telefone
  (com atalhos para ligar e WhatsApp), nº do stand, endereço (texto livre, com botão Copiar), província (lista das
  províncias e regiões da China) e observações.
- **Leitor de cartões de visita (OCR)**: ao fotografar o cartão, o app usa o Claude (visão) para ler o cartão
  — inclusive em chinês — e preenche automaticamente nome da empresa, contato, telefone, stand, endereço e
  província (deduzida pela cidade quando o cartão não a traz); e-mail, WeChat, site e outros dados vão para as
  observações. Só campos vazios são preenchidos.
  Requer a variável `ANTHROPIC_API_KEY`; sem ela, o cadastro funciona normalmente sem a leitura automática.
- **Produtos**: nome, foto, preço no Brasil (R$), unidades por container 40HQ e uma ou mais ofertas — cada oferta tem
  fornecedor, preço em US$, MOQ, Incoterm e % de custo de nacionalização.
  Um mesmo produto pode ter vários fornecedores.
- **Frete 40HQ**: o administrador define em *Conta* o valor do frete internacional de um container 40HQ (USD),
  válido para todas as empresas; o frete por unidade entra no preço estimado (ver Cálculo).
- **Cálculo**: `preço estimado no Brasil = (preço US$ + frete por unidade) × (1 + % nacionalização) × câmbio`,
  com `frete por unidade = frete 40HQ ÷ unidades por container 40HQ`. O frete não é somado quando o Incoterm
  da oferta já inclui o frete internacional (CFR, CIF, CPT, CIP, DAP, DPU, DDP).
- **Câmbio do dia automático**: busca a cotação do dólar (taxa de venda) na PTAX do Banco Central,
  com AwesomeAPI e ExchangeRate-API como reserva, a cada 30 minutos. Se todas falharem, o app mantém o
  último valor, avisa o usuário e permite informar o câmbio manualmente em *Conta* (vale para toda a
  equipe do CNPJ; dá para voltar ao automático a qualquer momento). `FX_AUTO=false` desliga a busca.
- **Roteiro de viagem** (aba *Roteiro*): o administrador envia o roteiro da viagem na China em Excel (.xlsx), por CNPJ;
  o app lê a planilha (colunas reconhecidas pelo título: Data, Hora, Cidade, Atividade, Local, Transporte, Hotel,
  Contato, Observações — em português, inglês ou chinês; colunas extras também aparecem; cores das células com
  legenda viram o tipo de cada atividade; o título no topo da planilha vira o título do roteiro) e mostra dia a dia para
  os usuários daquela empresa, destacando o dia de hoje. O administrador pode editar na tela, substituir a planilha
  ou excluir; só ele baixa a planilha original — os usuários veem apenas o roteiro visual.
- **Mapa da feira**: aba "Mapa" com o mapa oficial dos pavilhões (365.cantonfair.org.cn) dentro do app,
  mantido carregado ao trocar de aba, e atalho para abrir no navegador.
- **Ranking de vantagens**:
  - *Por produto*: melhor fornecedor de cada item (menor preço estimado), comparação com o preço
    no Brasil e economia em R$ e %; ordenado do mais vantajoso para o menos.
  - *Melhores fornecedores*: em quantos produtos cada fornecedor é a melhor opção e a economia total.

## Desempenho e segurança

- **Offline e abertura instantânea**: um service worker (`public/sw.js`) guarda as telas do app, as fotos
  e os últimos dados vistos; sem internet o app abre e mostra o que já foi carregado (com aviso).
  Os dados salvos são apagados ao sair da conta.
- **Miniaturas**: as fotos são enviadas com uma miniatura (240 px) usada nas listas (`/uploads/<id>/thumb`).
- **Cotação em segundo plano**: a atualização do dólar não atrasa as respostas (na Vercel usa `waitUntil`).
- **Segurança**: Content-Security-Policy, imagens validadas pelo conteúdo real, senha com scrypt
  assíncrono e tempo de login igual para e-mails existentes ou não, limites de tentativas
  (login, consulta de CNPJ, leitura de cartões).

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
| `ADMIN_EMAILS` | `gustavo.braga0607@gmail.com` | E-mails de administradores, separados por vírgula |
| `ANTHROPIC_API_KEY` | — | Chave da API do Claude para o leitor de cartões de visita |
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
