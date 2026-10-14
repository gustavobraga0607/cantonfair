'use strict';
// Gera test/fixtures/roteiro-exemplo.xlsx (planilha de roteiro usada nos testes).
const path = require('node:path');
const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Guangzhou');
  ws.addRow(['ROTEIRO CHINA – OUTUBRO 2026']);
  ws.mergeCells('A1:G1');
  ws.addRow([]);
  ws.addRow(['Data', 'Horário', 'Cidade', 'Atividade', 'Local / Endereço', 'Hotel', 'Observações']);
  const d = (s) => new Date(`${s}T00:00:00Z`);
  const t = (h, m) => new Date(Date.UTC(1899, 11, 30, h, m));
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
}
main();
