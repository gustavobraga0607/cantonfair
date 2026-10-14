'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { parseItineraryXlsx, normalizeDays, fieldFor } = require('../src/itinerary');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'roteiro-exemplo.xlsx'));

test('reconhece colunas em português, inglês e chinês', () => {
  assert.equal(fieldFor('Data'), 'date');
  assert.equal(fieldFor('Horário'), 'time');
  assert.equal(fieldFor('Local / Endereço'), 'location');
  assert.equal(fieldFor('Observações'), 'notes');
  assert.equal(fieldFor('Obs.'), 'notes');
  assert.equal(fieldFor('Flight / Train'), 'transport');
  assert.equal(fieldFor('行程'), 'activity');
  assert.equal(fieldFor('Fornecedor'), null);
});

test('lê o roteiro: título mesclado, data mesclada, horas do Excel, várias abas', async () => {
  const r = await parseItineraryXlsx(SAMPLE, { year: 2026 });
  assert.equal(r.start_date, '2026-10-15');
  assert.equal(r.end_date, '2026-10-18');
  assert.deepEqual(r.days.map((d) => d.date), ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  const [d1] = r.days;
  assert.equal(d1.items.length, 2, 'data mesclada vale para as duas linhas');
  assert.deepEqual(d1.items[0], {
    time: '07:30', city: 'Guangzhou', activity: 'Chegada – voo EK362', location: 'Aeroporto Baiyun (CAN)',
    hotel: 'Langham Place', notes: 'Motorista Sr. Li: +86 138 0000 1111',
  });
  assert.equal(r.days[3].sheet, 'Shenzhen');
  assert.deepEqual(r.days[3].items[0].extra, [{ label: 'Fornecedor', value: 'Shenzhen Micheng' }]);
});

test('planilha sem cabeçalho reconhecível ou inválida gera erro claro', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('x').addRow(['qualquer', 'coisa']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await assert.rejects(parseItineraryXlsx(buf), /títulos como Data/);
  await assert.rejects(parseItineraryXlsx(Buffer.from('não é excel')), /\.xlsx/);
});

test('normaliza dias editados (limpa campos, datas inválidas, limites)', () => {
  const r = normalizeDays([{ date: '2026-10-20', items: [{ activity: '  Visita  ', hack: 'x', extra: [{ label: 'A', value: '' }] }] },
    { date: 'amanhã', label: 'Livre', items: [{}] }]);
  assert.deepEqual(r.days[0].items, [{ activity: 'Visita' }]);
  assert.equal(r.days[1].date, null);
  assert.deepEqual(r.days[1].items, []);
  assert.equal(r.start_date, '2026-10-20');
  assert.throws(() => normalizeDays('x'), /inválido/);
});

test('modelo BR Trading: título, dia da semana e numeração ignorados, coluna sem título, cores da legenda', async () => {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'roteiro-modelo-cores.xlsx'));
  const r = await parseItineraryXlsx(buf);
  assert.equal(r.title, 'PROGRAMAÇÃO CHINA - 2026 · Cliente • Roteiro de viagem');
  assert.deepEqual(r.days.map((x) => x.date), ['2026-10-25', '2026-10-27'], 'a legenda não vira um dia');
  assert.deepEqual(r.days[0].items, [
    { time: '07:25', activity: 'Chegada em Hong Kong e transfer para Guangzhou', category: 'Deslocamento (voo, trem, transfer)', color: '#FFF3DC' },
    { time: '13:00 – 17:00', activity: 'Feira de Cantão - 2ª Edição', category: 'Feira de Cantão', color: '#E6EEFC' },
  ]);
  assert.deepEqual(r.days[1].items[0], {
    time: '08:25', activity: 'Voo para Jinan TNA (a partir de Guangzhou CAN)', notes: 'Shenzhen Airlines',
    category: 'Deslocamento (voo, trem, transfer)', color: '#FFF3DC',
  });
  assert.equal(r.days[1].items[1].category, 'Visita a fábrica');
});
