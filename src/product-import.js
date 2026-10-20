'use strict';

// Cadastro de produtos por planilha Excel: modelo para baixar e leitura das linhas.
// A leitura não grava nada: devolve as linhas já normalizadas para o usuário conferir no app.

const { cellValue } = require('./itinerary');
const { priceFromText } = require('./ocr');

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const MAX_ROWS = 500;

// Colunas do modelo (na ordem) e os nomes de cabeçalho aceitos em planilhas próprias.
const COLUMNS = [
  ['name', 'Produto', ['produto', 'nome', 'nome do produto', 'product', 'item', 'descricao', 'description']],
  ['supplier', 'Fornecedor', ['fornecedor', 'supplier', 'fabricante', 'factory', 'empresa']],
  ['price', 'Preço', ['preco', 'preco unitario', 'price', 'unit price', 'valor', 'fob price']],
  ['currency', 'Moeda (RMB ou USD)', ['moeda', 'currency', 'moeda (rmb ou usd)']],
  ['moq', 'MOQ', ['moq', 'quantidade minima', 'pedido minimo', 'min order', 'minimum order']],
  ['incoterm', 'Incoterm', ['incoterm', 'incoterms', 'condicao', 'price terms']],
  ['nat', 'Nacionalização (%)', ['nacionalizacao', 'nacionalizacao (%)', '% nacionalizacao', 'nacionaliz.', 'nacionaliz. (%)', 'nationalization']],
  ['price_brl', 'Preço no Brasil (R$)', ['preco no brasil', 'preco no brasil (r$)', 'preco brasil', 'preco br', 'brazil price']],
  ['units', 'Unidades por 40HQ', ['unidades por 40hq', 'unid. / 40hq', 'unidades 40hq', '40hq', 'units per 40hq']],
  ['notes', 'Observações', ['observacoes', 'obs', 'observacao', 'notes', 'especificacoes', 'specs']],
];

// Títulos fora da lista exata: reconhecidos por palavras-chave. A ordem importa: "Preço no Brasil",
// "Preço de venda (R$)" etc. são conferidos antes do preço do fornecedor.
const FUZZY = [
  ['units', /40\s*hq|container|conteiner|contêiner/],
  ['nat', /nacionaliz|nationaliz|% *nac/],
  ['price_brl', /brasil|brazil|\bbr\b|r\$|\breais\b|\bbrl\b|venda|varejo|revenda|mercado|retail/],
  ['moq', /\bmoq\b|minim|min\.? order/],
  ['incoterm', /incoterm/],
  ['currency', /^(moeda|currency)/],
  ['supplier', /fornecedor|supplier|fabrica|fabricante|factory|vendor/],
  ['price', /preco|price|valor|custo|cost|\bfob\b|\bexw\b|rmb|cny|yuan|usd|us\$|dolar|dollar/],
  ['notes', /^obs|observ|nota|spec|especific|detalhe/],
  ['name', /produto|nome|item|descri|product|modelo|model/],
];
// Moeda indicada no título da coluna de preço (ex.: "Preço (RMB)", "Price USD").
const headerCurrency = (h) => (/rmb|cny|yuan|¥|￥/.test(h) ? 'CNY' : /usd|us\$|dolar|dollar/.test(h) ? 'USD' : null);

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function buildTemplate(supplierNames = []) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Produtos');
  ws.columns = COLUMNS.map(([, label]) => ({ header: label, width: Math.max(14, label.length + 4) }));
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 28;
  ws.getColumn(10).width = 40;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.addRow(['Garrafa térmica inox 500 ml', supplierNames[0] || '', 16.8, 'RMB', 1000, 'FOB', 85, 129.9, 12000, 'Inox 304, caixa com 50']);
  ws.addRow(['Copo térmico 350 ml', supplierNames[0] || '', 2.35, 'USD', 500, 'FOB', 85, 69.9, '', '']);

  // Lista de fornecedores cadastrados: a coluna Fornecedor vira uma lista de escolha.
  const list = wb.addWorksheet('Fornecedores');
  list.getColumn(1).width = 40;
  list.addRow(['Fornecedores cadastrados no app (escolha na coluna Fornecedor da aba Produtos)']).font = { bold: true };
  for (const n of supplierNames) list.addRow([n]);
  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    if (supplierNames.length) {
      ws.getCell(`B${r}`).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`Fornecedores!$A$2:$A$${supplierNames.length + 1}`] };
    }
    ws.getCell(`D${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"RMB,USD"'] };
    ws.getCell(`F${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${INCOTERMS.join(',')}"`] };
  }

  const help = wb.addWorksheet('Instruções');
  help.getColumn(1).width = 110;
  [
    'Como preencher',
    '• Uma linha por produto. Só a coluna Produto é obrigatória.',
    '• Fornecedor: escolha um da lista (aba Fornecedores). Se o nome não for encontrado no app, o produto entra sem fornecedor e o preço fica nas observações para você vincular depois, editando o produto.',
    '• Preço: valor unitário, sem converter. Moeda: RMB (yuan, padrão) ou USD (dólar).',
    '• Incoterm: FOB, EXW, FCA, CIF… Nacionalização: só o número (ex.: 85).',
    '• Preço no Brasil e Unidades por 40HQ são opcionais e servem para o cálculo de vantagem e de frete.',
    '• Apague as duas linhas de exemplo antes de importar.',
  ].forEach((t, i) => { help.addRow([t]).font = { bold: i === 0 }; });
  return wb.xlsx.writeBuffer();
}

const text = (v) => {
  const c = cellValue(v);
  return c == null ? '' : String(c).replace(/\r\n?/g, '\n').trim();
};

// Número de uma célula: aceita número ou texto ("16,80", "1.000", "¥ 16.8").
function number(v, { integer = false } = {}) {
  const c = cellValue(v);
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  let t = String(c ?? '').replace(/[^\d.,-]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = /,\d{3}$/.test(t) && integer ? t.replace(/,/g, '') : t.replace(',', '.');
  else if (integer && /\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function currencyOf(v, priceText) {
  const t = norm(text(v));
  if (/^(usd|us\$|\$|dolar|dolares|dollar|us dollar)$/.test(t)) return 'USD';
  if (/^(rmb|cny|yuan|¥|￥|renminbi|元)$/.test(t)) return 'CNY';
  return priceFromText(priceText)?.currency || 'CNY';
}

// suppliers: [{ id, name }] da empresa; o nome é comparado sem acentos/maiúsculas.
async function parseProductsXlsx(buf, suppliers = []) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find((w) => norm(w.name) === 'produtos') || wb.worksheets[0];
  if (!ws) return { rows: [], error: 'A planilha está vazia.' };

  // Cabeçalho: a primeira linha (até a 10ª) que tenha a coluna de produto.
  let headerRow = null;
  let map = null;
  let titles = null;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const found = {};
    const names = {};
    const loose = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const raw = text(cell.value);
      const h = norm(raw);
      if (!h) return;
      const c = COLUMNS.find(([, label, aliases]) => norm(label) === h || aliases.includes(h));
      if (c && !found[c[0]]) { found[c[0]] = col; names[c[0]] = raw; } else if (!c) loose.push([col, h, raw]);
    });
    // Depois dos títulos exatos, os parecidos (só preenche campos ainda sem coluna).
    for (const [col, h, raw] of loose) {
      const f = FUZZY.find(([k, re]) => !found[k] && re.test(h));
      if (f) { found[f[0]] = col; names[f[0]] = raw; }
    }
    if (found.name) { headerRow = r; map = found; titles = names; break; }
  }
  if (!headerRow) return { rows: [], error: 'Não encontrei a coluna "Produto" no cabeçalho. Use o modelo de planilha do app.' };

  const byName = new Map(suppliers.map((s) => [norm(s.name), s]));
  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount && rows.length < MAX_ROWS; r++) {
    const row = ws.getRow(r);
    const get = (k) => (map[k] ? row.getCell(map[k]).value : null);
    const name = text(get('name'));
    if (!name) continue;
    const priceRaw = text(get('price'));
    let price = number(get('price'));
    let currency = map.currency && text(get('currency')) ? currencyOf(get('currency'), priceRaw)
      : headerCurrency(norm(titles.price || '')) || currencyOf(null, priceRaw);
    if (price == null && priceRaw) { const f = priceFromText(priceRaw); if (f) ({ price, currency } = f); }
    const supplierName = text(get('supplier'));
    const supplier = supplierName ? byName.get(norm(supplierName)) : null;
    const incoterm = text(get('incoterm')).toUpperCase();
    rows.push({
      line: r,
      name: name.slice(0, 150),
      supplier_name: supplierName,
      supplier_id: supplier?.id ?? null,
      price: price != null && price > 0 ? Math.round(price * 10000) / 10000 : null,
      currency,
      moq: (() => { const n = number(get('moq'), { integer: true }); return n != null && n > 0 ? Math.round(n) : null; })(),
      incoterm: INCOTERMS.includes(incoterm) ? incoterm : '',
      nat: number(get('nat')),
      price_brl: number(get('price_brl')),
      units_per_40hq: (() => { const n = number(get('units'), { integer: true }); return n != null && n > 0 ? Math.round(n) : null; })(),
      notes: text(get('notes')).slice(0, 2000),
    });
  }
  // Qual coluna da planilha foi lida em cada campo (o app mostra para o usuário conferir).
  const columns = COLUMNS.filter(([k]) => titles[k]).map(([k, label]) => ({ field: k, label: label.replace(/ \(.*\)$/, ''), header: titles[k] }));
  return { rows, columns, error: rows.length ? null : 'Nenhum produto encontrado na planilha (a coluna Produto está vazia).' };
}

module.exports = { buildTemplate, parseProductsXlsx, COLUMNS };
