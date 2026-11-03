'use strict';

// Fatura do WeChat Pay (微信支付账单明细) → despesas do controle de viagem.
// Aceita o .xlsx exportado pelo WeChat (e o .csv das versões antigas). Só entram as saídas (支出);
// as totalmente reembolsadas vêm desmarcadas (o usuário decide) e as com reembolso parcial entram pelo valor líquido.
// A leitura não grava nada: devolve as linhas para o usuário conferir no app.

const { cellValue } = require('./itinerary');

const HEADERS = {
  time: ['交易时间'], type: ['交易类型'], party: ['交易对方'], item: ['商品'], dir: ['收/支'],
  amount: ['金额(元)', '金额（元）', '金额'], method: ['支付方式'], status: ['当前状态'], id: ['交易单号'], note: ['备注'],
};

// Nomes chineses comuns → nome conhecido no Brasil.
const KNOWN = [
  [/美团/, 'Meituan'], [/饿了么/, 'Ele.me'], [/麦当劳/, "McDonald's"], [/肯德基/, 'KFC'], [/星巴克/, 'Starbucks'], [/瑞幸/, 'Luckin Coffee'],
  [/全家/, 'FamilyMart'], [/罗森/, 'Lawson'], [/7-?11|柒一拾壹/i, '7-Eleven'], [/京东/, 'JD.com'], [/淘宝/, 'Taobao'], [/天猫/, 'Tmall'],
  [/拼多多/, 'Pinduoduo'], [/滴滴/, 'DiDi'], [/携程/, 'Trip.com'], [/12306|铁路/, 'Trem (12306)'], [/高德/, 'Amap'], [/中国移动/, 'China Mobile'],
  [/中国联通/, 'China Unicom'], [/中国电信/, 'China Telecom'], [/盒马/, 'Hema'], [/喜茶/, 'Heytea'], [/蜜雪冰城/, 'Mixue'],
];

// Categoria pelo nome do estabelecimento e do produto (o usuário pode trocar antes de salvar).
const CATEGORY_RULES = [
  ['hospedagem', /酒店|宾馆|旅馆|民宿|客栈|住宿|hotel|hostel|inn\b/i],
  ['passagens', /12306|铁路|高铁|动车|航空|机票|航班|飞猪|携程/i],
  ['transporte', /滴滴|出行|打车|出租|地铁|公交|高德|曹操|T3|哈啰|摩拜|共享单车|停车|加油|didi|metro|taxi/i],
  ['comunicacao', /移动|联通|电信|话费|流量|esim|sim卡/i],
  ['alimentacao', /餐|饭|食|菜|面馆|粉|烧烤|火锅|咖啡|奶茶|茶|饮|麦当劳|肯德基|星巴克|瑞幸|喜茶|美团|饿了么|全家|罗森|便利|超市|超巿|烟酒|水果|面包|蛋糕|commune|lawson|familymart|7-?11|coffee|cafe|restaurant/i],
  ['compras', /京东|淘宝|天猫|拼多多|商城|商行|服装|鞋|布|百货|商场|mall|shop/i],
];

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const text = (v) => {
  const c = cellValue(v);
  return c instanceof Date ? c : norm(c);
};
const money = (v) => {
  const c = cellValue(v);
  if (typeof c === 'number') return c;
  const n = Number(String(c ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Data/hora local da China. O Excel guarda "2026-10-31 21:30:22" como data sem fuso: a leitura
// devolve um Date em UTC com os mesmos números, por isso usamos as partes em UTC.
function dateParts(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const iso = v.toISOString();
    return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
  }
  const m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(v || ''));
  if (!m) return null;
  const pad = (x) => String(x).padStart(2, '0');
  return { day: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, time: m[4] ? `${pad(m[4])}:${m[5]}` : '' };
}

function describe(party, item) {
  const known = KNOWN.find(([re]) => re.test(`${party} ${item}`));
  const name = known ? `${known[1]}${known[1] !== party && party ? ` (${party})` : ''}` : party || 'WeChat Pay';
  // Número de pedido, "收款方备注:二维码收款" e "/" não ajudam a lembrar a compra.
  const same = (a) => a && norm(a).toLowerCase() === item.toLowerCase();
  const useful = item && item !== '/' && !/^收款方备注|订单|单号|^\d[\d-]{8,}$/.test(item) && !same(party) && !same(known?.[1]) ? item : '';
  return `${name}${useful ? ` — ${useful}` : ''}`.slice(0, 200);
}

function guessCategory(party, item, type) {
  if (/转账|红包/.test(type)) return 'outros';
  const hay = `${party} ${item}`;
  return (CATEGORY_RULES.find(([, re]) => re.test(hay)) || ['outros'])[0];
}

// Linhas da planilha (cabeçalho em chinês em qualquer linha das 40 primeiras).
async function readRows(buf) {
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => rows.push(row.values.slice(1).map(text)));
    return rows;
  }
  // CSV (exportação antiga): texto UTF-8, vírgulas, campos podem vir entre aspas.
  const csv = buf.toString('utf8').replace(/^﻿/, '');
  return csv.split(/\r?\n/).map((line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(norm(cur)); cur = ''; } else cur += ch;
    }
    out.push(norm(cur));
    return out;
  });
}

// existing: despesas do usuário [{ id, spent_on, amount, currency, client_ref, description }].
async function parseWechatBill(buf, existing = []) {
  const rows = await readRows(buf);
  const headerAt = rows.findIndex((r, i) => i < 40 && r.some((c) => c === '交易时间') && r.some((c) => c === '收/支'));
  if (headerAt < 0) {
    return { rows: [], error: 'Não encontrei a lista de transações. Envie a fatura do WeChat Pay (微信支付账单明细) exportada pelo WeChat.' };
  }
  const header = rows[headerAt].map((c) => String(c));
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  const refs = new Set(existing.map((e) => e.client_ref).filter(Boolean));
  const out = [];
  for (const r of rows.slice(headerAt + 1)) {
    const get = (k) => (col[k] >= 0 ? r[col[k]] : '');
    const dir = String(get('dir'));
    if (dir !== '支出') continue; // entradas, transferências neutras (/), recargas
    const when = dateParts(get('time'));
    const amount = money(get('amount'));
    if (!when || !(amount > 0)) continue;
    const status = String(get('status'));
    const type = String(get('type'));
    const party = String(get('party'));
    const item = String(get('item'));
    const txId = String(get('id')).replace(/\s/g, '');
    // Número da transação do WeChat: importar a mesma fatura de novo não duplica.
    const ref = /^\w{6,56}$/.test(txId) ? `wechat-${txId}`
      : `wechat-${require('node:crypto').createHash('sha1').update(`${when.day} ${when.time} ${amount} ${party}`).digest('hex').slice(0, 32)}`;
    // Reembolso parcial aparece como "已退款(￥12.50)": entra só o que sobrou.
    const partial = /已退款[（(]\s*[￥¥]?\s*([\d.]+)/.exec(status);
    const refunded = /全额退款/.test(status) ? amount : partial ? Number(partial[1]) : 0;
    const net = Math.round((amount - refunded) * 100) / 100;
    const row = {
      ref, spent_on: when.day, time: when.time, description: describe(party, item), category: guessCategory(party, item, type),
      amount: net > 0 ? net : amount, original_amount: amount, refunded: refunded > 0 ? Math.min(refunded, amount) : 0,
      party, item: item === '/' ? '' : item, type, status: 'new', include: true, note: '',
    };
    const twin = existing.find((e) => !String(e.client_ref || '').startsWith('wechat-') && e.currency === 'CNY'
      && e.spent_on === when.day && Math.abs(Number(e.amount) - row.amount) < 0.01);
    if (refs.has(ref)) {
      Object.assign(row, { status: 'imported', include: false, note: 'Já importada antes.' });
    } else if (net <= 0) {
      Object.assign(row, { status: 'refunded', include: false,
        note: `Reembolsada: só entra se você marcar.${twin ? ` Parece já lançada: "${twin.description}".` : ''}` });
    } else {
      if (twin) Object.assign(row, { status: 'possible_duplicate', include: false, note: `Parece já lançada: "${twin.description}".` });
      else if (/银行卡/.test(type)) Object.assign(row, { include: false, note: 'Transferência para cartão bancário: confira se é uma despesa.' });
      else if (refunded > 0) row.note = `Reembolso parcial de ¥ ${refunded.toFixed(2)}: entra o valor líquido.`;
    }
    out.push(row);
  }
  out.sort((a, b) => (a.spent_on + a.time).localeCompare(b.spent_on + b.time));
  return { rows: out, error: out.length ? null : 'Nenhuma despesa (支出) encontrada nesta fatura.' };
}

module.exports = { parseWechatBill, guessCategory, describe };
