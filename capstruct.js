// capstruct.js: the finance math for the AGE capital structure app.
// Plain functions that never touch the page, so they can be checked with Node:
//   node -e "const c = require('./capstruct.js'); console.log(c.round(0.14025 * 100, 2))"

(function (root) {
  "use strict";

  // ---------- Rounding and formatting ----------

  // Round half up on the decimal value. toFixed() rounds the binary value and
  // gets cases like 14.025 and 3.495 wrong; toPrecision(12) cleans that up first.
  function round(x, d) {
    const f = Math.pow(10, d);
    const sign = x < 0 ? -1 : 1;
    return (sign * Math.round(Number((Math.abs(x) * f).toPrecision(12)))) / f;
  }

  function withCommas(x, d) {
    const parts = round(Math.abs(x), d).toFixed(d).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  // Dollars to the nearest dollar. paren: show as (4,000), the way the case shows costs.
  function dollars(x, paren) {
    if (x === null || x === undefined) return "n/a";
    const s = "$" + withCommas(x, 0);
    if (paren) return "(" + withCommas(x, 0) + ")";
    return x < 0 ? "−" + s : s;
  }
  // Prices, EPS and dividends to the cent.
  function cents(x) {
    if (x === null || x === undefined) return "n/a";
    return (x < 0 ? "−$" : "$") + withCommas(x, 2);
  }
  // Rates as percents to two decimals.
  function pct(x) {
    if (x === null || x === undefined) return "n/a";
    return (x < 0 ? "−" : "") + withCommas(x * 100, 2) + "%";
  }
  // TIE, CV and other multiples to two decimals.
  function times(x) {
    if (x === null || x === undefined) return "n/a";
    return (x < 0 ? "−" : "") + withCommas(x, 2) + "×";
  }
  function num(x, d) {
    if (x === null || x === undefined) return "n/a";
    return (x < 0 ? "−" : "") + withCommas(x, d);
  }

  // ---------- CSV ----------

  // Parse a small CSV file into an array of objects keyed by the header row.
  function parseCSV(text) {
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
    const split = (line) => {
      const out = [];
      let cur = "", q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const head = split(lines[0]);
    return lines.slice(1).map((l) => {
      const cells = split(l);
      const row = {};
      head.forEach((h, i) => (row[h] = cells[i] === undefined ? "" : cells[i]));
      return row;
    });
  }

  // Number from a CSV cell; a blank cell becomes null (e.g. no cost of debt at $0).
  function toNum(s) {
    return s === "" || s === undefined ? null : Number(s);
  }

  // item,value files (assumptions, example_firms, cdss) -> { item: number }
  function toMap(rows) {
    const m = {};
    rows.forEach((r) => (m[r.item || r.assumption] = toNum(r.value)));
    return m;
  }

  // ---------- Statistics ----------

  function expected(probs, xs) {
    return xs.reduce((s, x, i) => s + probs[i] * x, 0);
  }
  function stdev(probs, xs) {
    const m = expected(probs, xs);
    return Math.sqrt(xs.reduce((s, x, i) => s + probs[i] * (x - m) * (x - m), 0));
  }

  // ---------- Firm U and Firm L (question c) ----------

  // scenarios: [{probability, sales, operating_costs}], debt: the firm's debt.
  function firm(totalAssets, debt, rate, T, scenarios) {
    const equity = totalAssets - debt;
    const years = scenarios.map((s) => {
      const p = Number(s.probability);
      const sales = Number(s.sales);
      const opCosts = Number(s.operating_costs);
      const ebit = sales - opCosts;
      const interest = rate * debt;
      const ebt = ebit - interest;
      const taxes = T * ebt;
      const netIncome = ebt - taxes;
      return {
        probability: p, sales, opCosts, ebit, interest, ebt, taxes, netIncome,
        roe: netIncome / equity,
        tie: interest > 0 ? ebit / interest : null,
      };
    });
    const probs = years.map((y) => y.probability);
    const roes = years.map((y) => y.roe);
    const eRoe = expected(probs, roes);
    const sRoe = stdev(probs, roes);
    const hasTie = years.every((y) => y.tie !== null);
    const ties = years.map((y) => y.tie);
    return {
      assets: totalAssets, debt, equity, rate, years,
      eRoe, sRoe, cvRoe: eRoe !== 0 ? sRoe / eRoe : null,
      eTie: hasTie ? expected(probs, ties) : null,
      sTie: hasTie ? stdev(probs, ties) : null,
    };
  }

  // ---------- CDSS ----------

  // base: the cdss.csv map. Returns EBIT and the firm's starting numbers.
  function cdssBase(c) {
    return {
      ebit: c.sales * (1 - c.variable_cost_rate) - c.fixed_costs,
      n: c.shares_outstanding,
      p0: c.share_price,
      assets: c.total_assets,
      mgmt: c.management_share,
    };
  }

  // Management's stake after the buyback. Management doesn't sell.
  function mgmtStake(b, repurchased, remaining) {
    const outside = (1 - b.mgmt) * b.n;
    const diff = repurchased - outside;
    if (Math.abs(diff) < 1e-6) {
      return { stake: 1, note: "No outside shareholders would be left." };
    }
    if (diff > 0) {
      return { stake: null, warning: "The buyback needs more shares than outside investors own, so management would have to sell." };
    }
    return { stake: (b.mgmt * b.n) / remaining };
  }

  // One amount of borrowing. row: {debt, cost_of_debt, cost_of_equity}.
  function cdssAt(b, row, T) {
    const D = row.debt;
    const rd = row.cost_of_debt === null ? 0 : row.cost_of_debt;
    const rs = row.cost_of_equity;
    const interest = rd * D;
    const netIncome = (b.ebit - interest) * (1 - T);
    const tie = interest > 0 ? b.ebit / interest : null;

    // Case method (d(3), d(4)): buy back at today's price P0.
    const cRep = D / b.p0;
    const cRem = b.n - cRep;
    const cEps = netIncome / cRem;
    const cPrice = cEps / rs;
    const caseM = {
      repurchased: cRep, remaining: cRem, eps: cEps, dps: cEps, tie, price: cPrice,
      wacc: (D / b.assets) * rd * (1 - T) + ((b.assets - D) / b.assets) * rs, // book weights
      mgmt: mgmtStake(b, cRep, cRem),
    };

    // New-price method: buy back at the price after the announcement.
    const S = netIncome / rs;
    const V = S + D;
    const P = V / b.n;
    const nRep = D / P;
    const nRem = b.n - nRep;
    const nEps = netIncome / nRem;
    const nWacc = (D / V) * rd * (1 - T) + (S / V) * rs; // market weights
    const newM = {
      repurchased: nRep, remaining: nRem, eps: nEps, dps: nEps, tie, price: P,
      equityValue: S, firmValue: V, wacc: nWacc,
      mgmt: mgmtStake(b, nRep, nRem),
      checks: {
        epsEqualsRsP: Math.abs(nEps - rs * P) < 1e-9,
        waccEqualsEbitOverV: Math.abs(nWacc - (b.ebit * (1 - T)) / V) < 1e-12,
      },
    };

    return { debt: D, rd: row.cost_of_debt, rs, interest, netIncome, caseM, newM };
  }

  // The whole schedule plus which debt is best by each measure.
  function cdssSchedule(c, schedule, T) {
    const b = cdssBase(c);
    const rows = schedule.map((r) => cdssAt(b, r, T));
    // Pick the row with the best value; on an exact tie keep the smaller debt.
    const pick = (get, better) => rows.reduce((best, r) => {
      const v = round(get(r), 10), bv = round(get(best), 10);
      return better(v, bv) || (v === bv && r.debt < best.debt) ? r : best;
    }, rows[0]).debt;
    const hi = (a, z) => a > z, lo = (a, z) => a < z;
    const best = {
      priceCase: pick((r) => r.caseM.price, hi),
      priceNew: pick((r) => r.newM.price, hi),
      epsCase: pick((r) => r.caseM.eps, hi),
      epsNew: pick((r) => r.newM.eps, hi),
      waccBook: pick((r) => r.caseM.wacc, lo),
      waccMarket: pick((r) => r.newM.wacc, lo),
    };
    const zero = rows.find((r) => r.debt === 0);
    const priceCheck = zero
      ? { ok: Math.abs(zero.caseM.eps / zero.rs - c.share_price) < 0.005, implied: zero.caseM.eps / zero.rs, stated: c.share_price }
      : { ok: false, implied: null, stated: c.share_price, missingZero: true };
    return { base: b, rows, best, priceCheck };
  }

  const api = {
    round, dollars, cents, pct, times, num,
    parseCSV, toNum, toMap, expected, stdev,
    firm, cdssBase, cdssAt, cdssSchedule, mgmtStake,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CapStruct = api;
})(typeof window !== "undefined" ? window : this);
