'use strict';
// Gera test/fixtures/roteiro-exemplo.xlsx (planilha de roteiro usada nos testes).
const path = require('node:path');
const ExcelJS = require('exceljs');

const d = (s) => new Date(`${s}T00:00:00Z`);
const t = (h, m) => new Date(Date.UTC(1899, 11, 30, h, m));

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Guangzhou');
  ws.addRow(['ROTEIRO CHINA – OUTUBRO 2026']);
  ws.mergeCells('A1:G1');
  ws.addRow([]);
  ws.addRow(['Data', 'Horário', 'Cidade', 'Atividade', 'Local / Endereço', 'Hotel', 'Observações']);
  const rows = [
    [d('2026-10-15'), t(7, 30), 'Guangzhou', 'Chegada – voo EK362', 'Aeroporto Baiyun (CAN)', 'Langham Place', 'Motorista Sr. Li: +86 138 0000 1111'],
    [null, t(14, 0), 'Guangzhou', 'Feira de Cantão – Fase 1', 'Canton Fair Complex, Pazhou', null, 'Levar crachá'],
    [d('2026-10-16'), t(9, 0), 'Guangzhou', 'Visita fábrica Sunrise', '宁波日升 – Panyu District', 'Langham Place', null],
    [d('2026-10-17'), '08:00', 'Foshan', 'Trem rápido G6xxx para Foshan', 'Guangzhou South Station', null, null],
  ];
  rows.forEach((r) => ws.addRow(r));
  ws.mergeCells('A4:A5'); // data mesclada em 2 linhas
  ws.getColumn(2).numFmt = 'hh:mm';

  const ws2 = wb.addWorksheet('Shenzhen');
  ws2.addRow(['日期', '时间', '城市', '行程', '酒店', 'Fornecedor']);
  ws2.addRow(['18/10', '10:00', 'Shenzhen', 'Reunião com fornecedor de eletrônicos', 'Futian Shangri-La', 'Shenzhen Micheng']);
  await wb.xlsx.writeFile(path.join(__dirname, 'roteiro-exemplo.xlsx'));

  // Modelo com a estrutura usada pela BR Trading: títulos no topo, colunas DATA | (nº) | DIA | HORÁRIO | ROTEIRO | (info),
  // datas mescladas, horários em texto e tipo da atividade indicado pela cor, com legenda no fim.
  const wb2 = new ExcelJS.Workbook();
  const m = wb2.addWorksheet('Cliente');
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const [MOVE, FAIR, FACTORY] = ['FFFFF3DC', 'FFE6EEFC', 'FFE4F5EC'];
  m.getCell('A2').value = 'PROGRAMAÇÃO CHINA - 2026'; m.mergeCells('A2:E2');
  m.getCell('A3').value = 'Cliente  •  Roteiro de viagem'; m.mergeCells('A3:E3');
  m.getRow(4).values = ['DATA', null, 'DIA', 'HORÁRIO', 'ROTEIRO'];
  const lines = [
    [5, d('2026-10-25'), 1, 'Domingo', t(7, 25), 'Chegada em Hong Kong e transfer para Guangzhou', null, MOVE],
    [6, null, null, null, '13:00:00 as 17:00', 'Feira de Cantão - 2ª Edição', null, FAIR],
    [8, d('2026-10-27'), 3, 'Terça', t(8, 25), 'Voo para Jinan TNA (a partir de Guangzhou CAN)', 'Shenzhen Airlines', MOVE],
    [9, null, null, null, t(15, 0), 'Fábrica de embalagens', null, FACTORY],
  ];
  for (const [r, date, n, wd, time, act, info, color] of lines) {
    m.getRow(r).values = [date, n, wd, time, act, info];
    m.getCell(`D${r}`).fill = fill(color);
    m.getCell(`E${r}`).fill = fill(color);
  }
  m.mergeCells('A5:A6'); m.mergeCells('C5:C6'); m.mergeCells('A8:A9'); m.mergeCells('C8:C9');
  m.getCell('A12').value = 'LEGENDA';
  [['Deslocamento (voo, trem, transfer)', MOVE], ['Feira de Cantão', FAIR], ['Visita a fábrica', FACTORY]].forEach(([label, color], i) => {
    const r = 13 + i;
    m.getCell(`D${r}`).value = label; m.getCell(`D${r}`).fill = fill(color); m.mergeCells(`D${r}:E${r}`);
  });
  await wb2.xlsx.writeFile(path.join(__dirname, 'roteiro-modelo-cores.xlsx'));
}
main();
