'use strict';

// Preço estimado no Brasil (R$) = (preço × câmbio da moeda + frete por unidade US$ × câmbio do dólar) × (1 + % nacionalização).
// rates = { CNY: R$ por ¥, USD: R$ por US$ }; o preço do fornecedor vem em RMB (padrão) ou US$.
function estimateBrl(price, currency, nationalizationPct, rates, freightUsd = 0) {
  const rate = currency === 'USD' ? rates.USD : rates.CNY;
  return (price * rate + (freightUsd || 0) * rates.USD) * (1 + (nationalizationPct || 0) / 100);
}

// Incoterms em que o preço do fornecedor já inclui o frete internacional:
// nesses casos o frete do container não é somado de novo.
const FREIGHT_INCLUDED = new Set(['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);

// Frete internacional por unidade (US$) = frete do container 40HQ ÷ unidades por container.
function freightPerUnit(freight40hqUsd, unitsPer40hq) {
  return freight40hqUsd > 0 && unitsPer40hq > 0 ? freight40hqUsd / unitsPer40hq : 0;
}

function offerFreight(incoterm, perUnitUsd) {
  return FREIGHT_INCLUDED.has(String(incoterm || '').toUpperCase()) ? 0 : perUnitUsd;
}

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

// Monta o ranking: para cada produto escolhe o fornecedor com menor preço
// estimado e compara com o preço praticado no Brasil.
function buildRanking(products, offers, rates, freight40hqUsd = 0) {
  const units = new Map(products.map((p) => [p.id, p.units_per_40hq]));
  const byProduct = new Map();
  for (const o of offers) {
    const freight = offerFreight(o.incoterm, freightPerUnit(freight40hqUsd, units.get(o.product_id)));
    const estimated = estimateBrl(o.price, o.currency, o.nationalization_pct, rates, freight);
    const list = byProduct.get(o.product_id) || [];
    list.push({ ...o, freight_usd: round4(freight), estimated_brl: round2(estimated) });
    byProduct.set(o.product_id, list);
  }

  const rows = products.map((p) => {
    const options = (byProduct.get(p.id) || []).sort((a, b) => a.estimated_brl - b.estimated_brl);
    const best = options[0] || null;
    let savingBrl = null;
    let savingPct = null;
    if (best && p.price_brl > 0) {
      savingBrl = round2(p.price_brl - best.estimated_brl);
      savingPct = round2((savingBrl / p.price_brl) * 100);
    }
    return {
      product_id: p.id,
      name: p.name,
      photo: p.photo,
      price_brl: p.price_brl,
      best,
      options,
      saving_brl: savingBrl,
      saving_pct: savingPct,
      advantageous: savingBrl !== null && savingBrl > 0,
    };
  });

  // Mais vantajosos primeiro; itens sem comparação ficam no final.
  rows.sort((a, b) => {
    if (a.saving_pct === null && b.saving_pct === null) return a.name.localeCompare(b.name);
    if (a.saving_pct === null) return 1;
    if (b.saving_pct === null) return -1;
    return b.saving_pct - a.saving_pct;
  });
  return rows;
}

module.exports = { estimateBrl, buildRanking, round2, round4, freightPerUnit, offerFreight, FREIGHT_INCLUDED };
