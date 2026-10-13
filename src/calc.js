'use strict';

// Preço estimado no Brasil (R$) = preço US$ × (1 + % nacionalização) × câmbio.
function estimateBrl(priceUsd, nationalizationPct, exchangeRate) {
  return priceUsd * (1 + (nationalizationPct || 0) / 100) * exchangeRate;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Monta o ranking: para cada produto escolhe o fornecedor com menor preço
// estimado e compara com o preço praticado no Brasil.
function buildRanking(products, offers, exchangeRate) {
  const byProduct = new Map();
  for (const o of offers) {
    const estimated = estimateBrl(o.price_usd, o.nationalization_pct, exchangeRate);
    const list = byProduct.get(o.product_id) || [];
    list.push({ ...o, estimated_brl: round2(estimated) });
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

module.exports = { estimateBrl, buildRanking, round2 };
