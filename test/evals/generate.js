// Writes the input files of the evals and the answers they are graded against. Seeded, so a run can be repeated.
//   node test/evals/generate.js
const fs = require('fs');
const path = require('path');

let seed = 20261101;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (a, b) => Math.round(a + rnd() * (b - a));
const write = (name, rows) => fs.writeFileSync(path.join(__dirname, name), rows.join('\n') + '\n');
const sum = (list, f) => list.reduce((a, r) => a + f(r), 0);
const round1 = (v) => Math.round(v * 10) / 10;

// ── sales: 12 months × 4 regions × 3 products ──
const REGIONS = { North: 1.5, South: 0.8, East: 1.1, West: 0.6 };
const PRODUCTS = { Basic: 400, Plus: 900, Pro: 2100 };
const sales = [];
for (let m = 1; m <= 12; m++)
  for (const region of Object.keys(REGIONS))
    for (const product of Object.keys(PRODUCTS)) {
      const units = between(40, 90) * REGIONS[region] * (1 + m / 30);
      const u = Math.round(units);
      sales.push({ month: `2025-${String(m).padStart(2, '0')}`, region, product, units: u, revenue: u * PRODUCTS[product] });
    }
write('sales.csv', ['month,region,product,units,revenue', ...sales.map((r) => `${r.month},${r.region},${r.product},${r.units},${r.revenue}`)]);
const byRegion = Object.keys(REGIONS).map((region) => ({ region, revenue: sum(sales.filter((r) => r.region === region), (r) => r.revenue) }));
const byMonth = [...new Set(sales.map((r) => r.month))].map((month) => ({ month, revenue: sum(sales.filter((r) => r.month === month), (r) => r.revenue) }));
const bestMonth = byMonth.reduce((a, b) => (b.revenue > a.revenue ? b : a));

// ── monthly KPIs ──
const kpis = [];
let customers = 8200;
for (let m = 1; m <= 12; m++) {
  customers += between(-40, 190);
  kpis.push({ month: `2025-${String(m).padStart(2, '0')}`, revenue: between(410, 620) * 1000, customers, churn: between(18, 34) / 10, nps: between(31, 52) });
}
write('kpis.csv', ['month,revenue,customers,churn_pct,nps', ...kpis.map((r) => `${r.month},${r.revenue},${r.customers},${r.churn},${r.nps}`)]);
const last = kpis[11];
const previous = kpis[10];

// ── a warehouse dashboard: 52 weeks × 3 warehouses ──
const HOUSES = { Leeds: 1.4, Lyon: 1, Lodz: 0.7 };
const ops = [];
for (let w = 0; w < 52; w++) {
  const day = new Date(Date.UTC(2025, 0, 6 + w * 7)).toISOString().slice(0, 10);
  for (const warehouse of Object.keys(HOUSES)) {
    const orders = Math.round(between(700, 1100) * HOUSES[warehouse]);
    ops.push({ week: day, warehouse, orders, late: Math.round((orders * between(2, 11)) / 100), cost: orders * between(3, 6) });
  }
}
write('ops.csv', ['week,warehouse,orders,late_orders,cost', ...ops.map((r) => `${r.week},${r.warehouse},${r.orders},${r.late},${r.cost}`)]);
const houses = Object.keys(HOUSES).map((warehouse) => {
  const rows = ops.filter((r) => r.warehouse === warehouse);
  const orders = sum(rows, (r) => r.orders);
  return { warehouse, orders, cost: sum(rows, (r) => r.cost), lateRate: round1((sum(rows, (r) => r.late) / orders) * 100) };
});

// ── dirty numbers: money as people type it, gaps, and a footer line ──
const CLIENTS = ['Acme', 'Borealis', 'Cobalt', 'Delta Foods', 'Everest', 'Fjord', 'Granite'];
const dirty = [];
const amounts = [];
for (let i = 0; i < 60; i++) {
  const client = CLIENTS[between(0, CLIENTS.length - 1)];
  const value = between(300, 9000);
  const date = new Date(Date.UTC(2025, 0, 1 + i * 5)).toISOString().slice(0, 10);
  const kind = i % 10;
  if (kind === 3 && i % 20 === 3) dirty.push(`${date},${client},n/a`);
  else if (kind === 7 && i % 20 === 7) dirty.push(`${date},${client},`);
  else if (i === 44) dirty.push(`${date},${client},-`);
  else {
    amounts.push({ client, value });
    const text = value.toLocaleString('en-US');
    dirty.push(`${date},${client},${kind % 3 === 0 ? `"$${text}"` : kind % 3 === 1 ? `"USD ${text}.00"` : value}`);
  }
}
write('invoices.csv', ['date,client,amount', ...dirty]);
const clients = CLIENTS.map((client) => ({ client, total: sum(amounts.filter((r) => r.client === client), (r) => r.value) })).sort((a, b) => b.total - a.total);

fs.writeFileSync(
  path.join(__dirname, 'expected.json'),
  JSON.stringify(
    {
      'sales-from-csv': {
        charts: 2,
        figures: [sum(sales, (r) => r.revenue), ...byRegion.map((r) => r.revenue), bestMonth.revenue],
        words: [...Object.keys(REGIONS), [bestMonth.month, new Date(bestMonth.month + '-01').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })]],
      },
      'monthly-kpis': {
        charts: 1,
        figures: [last.revenue, last.customers, last.churn, last.nps],
        words: [],
        derived: { revenueChangePct: round1(((last.revenue - previous.revenue) / previous.revenue) * 100) },
      },
      'four-chart-dashboard': {
        charts: 4,
        figures: [...houses.map((h) => h.orders)],
        words: Object.keys(HOUSES),
        derived: { lateRates: houses.map((h) => h.lateRate) },
      },
      'dirty-numbers': {
        charts: 1,
        figures: [...clients.slice(0, 5).map((c) => c.total), sum(amounts, (r) => r.value)],
        words: clients.slice(0, 5).map((c) => c.client),
        derived: { skippedRows: 60 - amounts.length },
      },
    },
    null,
    2,
  ) + '\n',
);
console.log('sales', sales.length, 'kpis', kpis.length, 'ops', ops.length, 'invoices', dirty.length, 'kept', amounts.length);
