'use strict';

// Leitura do roteiro de viagem a partir de uma planilha Excel (.xlsx).
// O formato da planilha é livre: as colunas são reconhecidas pelo título
// (em português, inglês ou chinês) e as linhas são agrupadas por dia.
// Colunas não reconhecidas aparecem como campos extras com o título original.


const FIELDS = ['time', 'city', 'activity', 'location', 'transport', 'hotel', 'contact', 'notes'];

// Palavras-chave por campo (comparadas sem acento e em minúsculas). A ordem importa.
const KEYWORDS = [
  ['date', ['data', 'dia', 'date', 'day', '日期', '日']],
  ['time', ['hora', 'horario', 'time', 'hour', '时间']],
  ['city', ['cidade', 'city', '城市']],
  ['transport', ['transporte', 'translado', 'transfer', 'voo', 'trem', 'transport', 'flight', 'train', '交通', '航班']],
  ['hotel', ['hotel', 'hospedagem', 'accommodation', '酒店', '住宿']],
  ['location', ['local', 'lugar', 'endereco', 'address', 'location', 'place', '地点', '地址']],
  ['contact', ['contato', 'responsavel', 'guia', 'contact', 'guide', '联系']],
  ['notes', ['obs', 'observ', 'nota', 'notes', 'note', 'remark', '备注']],
  ['activity', ['atividade', 'programacao', 'programa', 'agenda', 'evento', 'descricao', 'compromisso', 'visita',
    'roteiro', 'activity', 'description', 'event', 'schedule', 'itinerary', '活动', '行程', '安排']],
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const pad = (n) => String(n).padStart(2, '0');

function fieldFor(header) {
  const h = norm(header);
  if (!h) return null;
  for (const [field, words] of KEYWORDS) {
    if (words.some((w) => (w.length <= 3 && /^[a-z]+$/.test(w) ? new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(h) : h.includes(w)))) {
      return field;
    }
  }
  return null;
}

// Texto de uma célula do ExcelJS (texto rico, link, fórmula, data...).
function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return cellValue(v.text);
    if ('hyperlink' in v) return String(v.hyperlink);
    if ('error' in v) return null;
    return null;
  }
  return v;
}

const asText = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  return String(v).replace(/\r\n?/g, '\n').trim();
};

// Hora: datas do Excel com ano 1899/1900 ou frações de dia viram "HH:MM".
function asTime(v) {
  if (v instanceof Date) {
    return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  }
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  return asText(v);
}

// Data: Date do Excel ou textos como "20/10/2026", "20/10", "2026-10-20", "Dia 1 - 20/10".
function asDate(v, fallbackYear) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === 'number' && v > 30000 && v < 80000) { // número de série do Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400_000);
    return asDate(d);
  }
  const s = asText(v);
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
    let y = m[3] ? Number(m[3]) : fallbackYear;
    if (y && y < 100) y += 2000;
    return y ? `${y}-${pad(m[2])}-${pad(m[1])}` : null;
  }
  return null;
}

// Valores de uma linha. Em células mescladas na horizontal (ex.: um título que ocupa
// a linha inteira) só a primeira célula conta; mescladas na vertical repetem o valor.
function rowValues(ws, rowNumber, colCount) {
  const row = ws.getRow(rowNumber);
  const out = [];
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    const master = cell.isMerged ? cell.master : cell;
    out.push(master !== cell && master.row === cell.row ? null : cellValue(cell.value));
  }
  return out;
}

// Acha a linha de cabeçalho: a primeira (entre as 15 primeiras) com 2+ títulos reconhecidos.
function findHeader(ws, colCount) {
  const last = Math.min(ws.rowCount, 15);
  for (let r = 1; r <= last; r++) {
    const vals = rowValues(ws, r, colCount);
    const known = new Set(vals.filter((v) => typeof v === 'string').map(fieldFor).filter(Boolean));
    if (known.size >= 2) return r;
  }
  return null;
}

function parseSheet(ws, { year }) {
  const colCount = Math.min(ws.columnCount || ws.actualColumnCount || 0, 30);
  if (!colCount || !ws.actualRowCount) return null;

  const headerRow = findHeader(ws, colCount);
  if (!headerRow) return null;
  const headers = rowValues(ws, headerRow, colCount).map((h) => asText(h));

  // Mapeia cada coluna para um campo (cada campo usado uma vez; o resto vira extra).
  const mapping = [];
  const used = new Set();
  headers.forEach((h, i) => {
    const f = fieldFor(h);
    if (f && !used.has(f)) { used.add(f); mapping[i] = f; } else if (h) mapping[i] = `extra:${h}`;
  });

  const days = [];
  let current = null;
  let currentKey = null;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const vals = rowValues(ws, r, colCount);
    if (vals.every((v) => v == null || asText(v) === '')) continue;

    const item = { extra: [] };
    let dateRaw = null;
    vals.forEach((v, i) => {
      const f = mapping[i];
      if (!f || v == null) return;
      if (f === 'date') dateRaw = v;
      else if (f === 'time') item.time = asTime(v);
      else if (f.startsWith('extra:')) { const t = asText(v); if (t) item.extra.push({ label: f.slice(6), value: t }); }
      else item[f] = asText(v);
    });

    // A data "continua" para baixo quando a célula está vazia (comum em células mescladas).
    if (dateRaw != null && asText(dateRaw)) {
      const iso = asDate(dateRaw, year);
      const label = asText(dateRaw);
      const key = iso || label;
      if (key !== currentKey) {
        // Guarda o texto do dia quando ele diz mais que a data (ex.: "Dia 2 – Foshan").
        current = { date: iso, label: iso && /^[\d/.\-\s]+$/.test(label) ? '' : label, items: [] };
        days.push(current);
        currentKey = key;
      }
    }
    if (!current) {
      current = { date: null, label: '', items: [] };
      days.push(current);
      currentKey = '';
    }
    const hasContent = FIELDS.some((f) => item[f]) || item.extra.length;
    if (hasContent) current.items.push(item);
  }
  const filled = days.filter((d) => d.items.length);
  return filled.length ? { name: ws.name, days: filled, columns: mapping.filter(Boolean) } : null;
}

async function parseItineraryXlsx(buffer, { year = new Date().getFullYear() } = {}) {
  const ExcelJS = require('exceljs'); // carregado só quando um roteiro é enviado
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    const err = new Error('Não foi possível ler a planilha. Envie um arquivo Excel .xlsx.');
    err.status = 400;
    throw err;
  }
  const sheets = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return;
    const s = parseSheet(ws, { year });
    if (s) sheets.push(s);
  });
  if (!sheets.length) {
    const err = new Error('Não encontrei o roteiro na planilha. A primeira linha da tabela deve ter títulos como Data, Hora, Cidade, Atividade, Local, Hotel.');
    err.status = 400;
    throw err;
  }
  // Várias abas viram uma sequência só, com o nome da aba no dia.
  const days = sheets.flatMap((s) => s.days.map((d) => ({ ...d, sheet: sheets.length > 1 ? s.name : undefined })));
  return normalizeDays(days);
}

// Valida e limpa os dias (usado na leitura do Excel e na edição pelo administrador).
function normalizeDays(days) {
  if (!Array.isArray(days)) throw Object.assign(new Error('Roteiro inválido.'), { status: 400 });
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const out = days.slice(0, 200).map((d) => ({
    date: /^\d{4}-\d{2}-\d{2}$/.test(d?.date || '') ? d.date : null,
    label: str(d?.label, 120),
    sheet: str(d?.sheet, 80) || undefined,
    items: (Array.isArray(d?.items) ? d.items : []).slice(0, 100).map((it) => {
      const item = {};
      for (const f of FIELDS) { const v = str(it?.[f], f === 'activity' || f === 'notes' ? 2000 : 500); if (v) item[f] = v; }
      const extra = (Array.isArray(it?.extra) ? it.extra : []).slice(0, 20)
        .map((e) => ({ label: str(e?.label, 80), value: str(e?.value, 1000) })).filter((e) => e.label && e.value);
      if (extra.length) item.extra = extra;
      return item;
    }).filter((it) => Object.keys(it).length),
  }));
  const dates = out.map((d) => d.date).filter(Boolean).sort();
  return { days: out, start_date: dates[0] || null, end_date: dates[dates.length - 1] || null };
}

module.exports = { parseItineraryXlsx, normalizeDays, fieldFor, FIELDS };
