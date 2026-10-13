# Canton Fair Buyer

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

## Como executar

Requer **Node.js 22.5+** (usa o SQLite embutido do Node; não há dependências para instalar).

```bash
npm start          # http://localhost:3000
npm test           # testes automatizados
```

Variáveis de ambiente opcionais:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./data` | Onde ficam o banco SQLite e as fotos |
| `CNPJ_ONLINE_CHECK` | `true` | `false` desativa a consulta à Receita (só valida os dígitos) |
| `CNPJ_API_URL` | BrasilAPI | URL base da consulta de CNPJ |
| `SECURE_COOKIES` | `false` | `true` em produção com HTTPS |

Para usar na feira, publique o app em um servidor com HTTPS (necessário para instalar como
app no celular e para a câmera funcionar em todos os navegadores) e defina `SECURE_COOKIES=true`.
Faça backup da pasta `DATA_DIR`.

## Estrutura

```
server.js          # inicialização do servidor HTTP
src/app.js         # rotas da API, autenticação, uploads e arquivos estáticos
src/db.js          # esquema SQLite
src/cnpj.js        # validação e consulta de CNPJ
src/calc.js        # cálculo de preço estimado e ranking
src/auth.js        # hash de senha, sessões, limite de tentativas de login
public/            # interface (HTML/CSS/JS, PWA)
test/              # testes (node:test)
```
