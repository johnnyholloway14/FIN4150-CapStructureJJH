// app.js: reads the CSV files in data/ and fills in the page.
// The finance math lives in capstruct.js (window.CapStruct).
(function () {
  "use strict";
  const C = window.CapStruct;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  async function load(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error("Couldn't read " + path + " (" + res.status + ")");
    return C.parseCSV(await res.text());
  }

  // ---------- Firm U and Firm L ----------

  function firmTable(f) {
    const y = f.years;
    const row = (label, fn, cls) =>
      "<tr" + (cls ? ' class="' + cls + '"' : "") + "><td>" + label + "</td>" +
      y.map((v) => "<td>" + fn(v) + "</td>").join("") + "</tr>";
    const stat = (label, val) =>
      '<tr class="stat"><td>' + label + '</td><td></td><td>' + val + "</td><td></td></tr>";
    return "<table><thead><tr><th></th><th>Bad year</th><th>Average</th><th>Good year</th></tr></thead><tbody>" +
      row("Assets", () => C.dollars(f.assets)) +
      row("Equity", () => C.dollars(f.equity)) +
      row("Probability", (v) => C.num(v.probability, 2)) +
      row("Sales", (v) => C.dollars(v.sales)) +
      row("Oper. costs", (v) => C.dollars(v.opCosts, true)) +
      row("EBIT", (v) => C.dollars(v.ebit), "total") +
      row("Interest", (v) => C.dollars(v.interest, true)) +
      row("EBT", (v) => C.dollars(v.ebt)) +
      row("Taxes", (v) => C.dollars(v.taxes, true)) +
      row("Net income", (v) => C.dollars(v.netIncome), "total") +
      row("ROE", (v) => C.pct(v.roe)) +
      row("TIE", (v) => C.times(v.tie)) +
      stat("E(ROE)", C.pct(f.eRoe)) +
      stat("σ(ROE)", C.pct(f.sRoe)) +
      stat("CV(ROE)", C.num(f.cvRoe, 2)) +
      stat("E(TIE)", C.times(f.eTie)) +
      stat("σ(TIE)", C.times(f.sTie)) +
      "</tbody></table>";
  }

  // ---------- CDSS ----------

  function stakeText(m) {
    if (m.warning) return "⚠ management must sell";
    return C.pct(m.stake) + (m.note ? " *" : "");
  }

  function cdssTable(sched, which) {
    const cols = [
      ["Debt", (r) => C.dollars(r.debt)],
      ["r<sub>d</sub>", (r) => (r.rd === null ? "—" : C.pct(r.rd))],
      ["r<sub>s</sub>", (r) => C.pct(r.rs)],
      ["Shares repurchased", (r) => C.num(r[which].repurchased, 2)],
      ["Shares remaining", (r) => C.num(r[which].remaining, 2)],
      ["Net income", (r) => C.dollars(r.netIncome)],
      ["EPS", (r) => C.cents(r[which].eps)],
      ["TIE", (r) => C.times(r[which].tie)],
      ["Share price", (r) => C.cents(r[which].price)],
      [which === "caseM" ? "WACC (book)" : "WACC (market)", (r) => C.pct(r[which].wacc)],
      ["Mgmt stake", (r) => stakeText(r[which].mgmt)],
    ];
    const bestDebt = which === "caseM" ? sched.best.priceCase : sched.best.priceNew;
    const label = (h) => h.replace(/<[^>]+>/g, "");
    let html = '<table class="stack"><thead><tr>' + cols.map((c) => "<th>" + c[0] + "</th>").join("") + "</tr></thead><tbody>";
    sched.rows.forEach((r) => {
      html += '<tr data-debt="' + r.debt + '"' + (r.debt === bestDebt ? ' class="best"' : "") + ">" +
        cols.map((c) => '<td data-label="' + esc(label(c[0])) + '">' + c[1](r) + "</td>").join("") + "</tr>";
    });
    html += "</tbody></table>";
    const notes = [];
    sched.rows.forEach((r) => {
      const m = r[which].mgmt;
      if (m.note) notes.push("* At " + C.dollars(r.debt) + ": " + m.note);
      if (m.warning) notes.push("⚠ At " + C.dollars(r.debt) + ": " + m.warning);
    });
    if (which === "newM") {
      const bad = sched.rows.filter((r) => !r.newM.checks.epsEqualsRsP || !r.newM.checks.waccEqualsEbitOverV);
      notes.push(bad.length
        ? "⚠ Check failed at " + bad.map((r) => C.dollars(r.debt)).join(", ") + ": EPS should equal r_s × price and WACC should equal EBIT × (1 − T) / V."
        : '<span class="ok">✓</span> Checks pass at every amount: EPS = r<sub>s</sub> × price, and WACC = EBIT × (1 − T) / V.');
    }
    html += '<p class="note">Highlighted row: highest share price under this method.</p>';
    if (notes.length) html += '<p class="note">' + notes.join("<br>") + "</p>";
    return html;
  }

  function summary(sched) {
    const b = sched.best, d = C.dollars;
    const items = [
      "Highest share price, case method ($" + C.num(sched.base.p0, 2) + " buyback): " + d(b.priceCase),
      "Highest share price, new-price method: " + d(b.priceNew),
      "Lowest WACC, book weights: " + d(b.waccBook),
      "Lowest WACC, market weights: " + d(b.waccMarket),
      "Highest EPS, case method: " + d(b.epsCase) + "; new-price method: " + d(b.epsNew),
    ];
    const agree = b.priceCase === b.priceNew && b.priceNew === b.waccBook && b.waccBook === b.waccMarket;
    const verdict = agree
      ? "<p>All four measures of price and WACC point to the same amount: <strong>" + d(b.priceCase) + "</strong>.</p>"
      : '<p class="warn">The measures don\'t all agree, so the app doesn\'t pick one. Compare the amounts above.</p>';
    return '<ul class="summary-list">' + items.map((i) => "<li>" + i + "</li>").join("") + "</ul>" + verdict;
  }

  // ---------- Levers (Part C) ----------

  // Two-column list of label / value for the CDSS lever cards.
  function kv(pairs) {
    return '<table class="kv"><tbody>' +
      pairs.map((p) => "<tr><td>" + p[0] + "</td><td>" + p[1] + "</td></tr>").join("") + "</tbody></table>";
  }

  function leverCard(r, which) {
    const m = r[which];
    const stake = m.mgmt.warning ? "⚠ not possible" : C.pct(m.mgmt.stake);
    let html = kv([
      ["Share price", C.cents(m.price)],
      ["Shares repurchased", C.num(m.repurchased, 2)],
      ["Shares remaining", C.num(m.remaining, 2)],
      ["EPS", C.cents(m.eps)],
      ["Dividends per share", C.cents(m.dps)],
      ["TIE", C.times(m.tie)],
      [which === "caseM" ? "WACC (book weights)" : "WACC (market weights)", C.pct(m.wacc)],
      ["Management's share", stake],
    ]);
    if (m.mgmt.note) html += '<p class="note">' + esc(m.mgmt.note) + "</p>";
    if (m.mgmt.warning) html += '<p class="warn">⚠ ' + esc(m.mgmt.warning) + "</p>";
    return html;
  }

  function ticks(el, amounts) {
    el.innerHTML = amounts.map((a) => "<span>" + C.dollars(a) + "</span>").join("");
  }

  function setupCdssLever(s) {
    const slider = $("c-debt");
    slider.max = String(s.rows.length - 1);
    ticks($("c-ticks"), s.rows.map((r) => r.debt));

    function show(i) {
      const r = s.rows[i];
      slider.value = String(i);
      slider.setAttribute("aria-valuetext", C.dollars(r.debt));
      $("c-debt-out").textContent = C.dollars(r.debt);
      $("c-rates").textContent = "r_d " + (r.rd === null ? "—" : C.pct(r.rd)) + ", r_s " + C.pct(r.rs);
      $("lever-case").innerHTML = leverCard(r, "caseM");
      $("lever-new").innerHTML = leverCard(r, "newM");
      document.querySelectorAll("#cdss tr[data-debt]").forEach((tr) =>
        tr.classList.toggle("sel", Number(tr.dataset.debt) === r.debt));
    }
    const indexOf = (debt) => s.rows.findIndex((r) => r.debt === debt);

    // Go to the amount both methods agree on; if they differ, go to the case
    // method's amount and say so. (Ties already go to the smaller debt.)
    function jump(caseDebt, newDebt, what) {
      show(indexOf(caseDebt));
      const note = $("jump-note");
      if (caseDebt === newDebt) {
        note.hidden = true;
      } else {
        note.hidden = false;
        note.textContent = what + ": the case method picks " + C.dollars(caseDebt) + " and the new-price method picks " +
          C.dollars(newDebt) + ". The slider shows the case method's amount.";
      }
    }

    slider.addEventListener("input", () => { $("jump-note").hidden = true; show(Number(slider.value)); });
    $("btn-best").addEventListener("click", () => jump(s.best.priceCase, s.best.priceNew, "Highest share price"));
    $("btn-eps").addEventListener("click", () => jump(s.best.epsCase, s.best.epsNew, "Highest EPS"));
    show(Math.max(0, indexOf(0)));
  }

  function setupFirmLever(ex, T, scenarios) {
    const slider = $("l-debt");
    slider.min = "0";
    slider.max = String(ex.slider_max);
    slider.step = String(ex.slider_step);
    const amounts = [];
    for (let d = 0; d <= ex.slider_max; d += ex.slider_step) amounts.push(d);
    ticks($("l-ticks"), amounts);
    $("btn-case").textContent = "Case (" + C.dollars(ex.firm_l_debt) + ")";
    $("l-rate-note").textContent = "The interest rate is held at " + C.pct(ex.interest_rate) +
      " at every amount, so the slider shows what debt does to Firm L's return and risk, not how lenders would respond.";

    function show(debt) {
      slider.value = String(debt);
      slider.setAttribute("aria-valuetext", C.dollars(debt));
      $("l-debt-out").textContent = C.dollars(debt);
      $("firm-l-title").textContent = "Firm L (" + C.dollars(debt) + " of debt)";
      $("firm-l").innerHTML = firmTable(C.firm(ex.total_assets, debt, ex.interest_rate, T, scenarios));
    }
    slider.addEventListener("input", () => show(Number(slider.value)));
    $("btn-case").addEventListener("click", () => show(ex.firm_l_debt));
    show(ex.firm_l_debt);
  }

  // ---------- Start ----------

  async function start() {
    try {
      const [cdss, assumptions, schedule, firms, scenarios] = await Promise.all([
        load("data/cdss.csv"),
        load("data/assumptions.csv"),
        load("data/banker_schedule.csv"),
        load("data/example_firms.csv"),
        load("data/ebit_scenarios.csv"),
      ]);
      const T = C.toMap(assumptions).tax_rate;
      const c = C.toMap(cdss);
      const ex = C.toMap(firms);
      const sched = schedule.map((r) => ({
        debt: C.toNum(r.debt), cost_of_debt: C.toNum(r.cost_of_debt), cost_of_equity: C.toNum(r.cost_of_equity),
      }));

      // Firm U and Firm L
      const u = C.firm(ex.total_assets, 0, ex.interest_rate, T, scenarios);
      $("firms-note").textContent = "Both firms have " + C.dollars(ex.total_assets) + " of assets and a " +
        C.pct(T) + " tax rate. Firm L has " + C.dollars(ex.firm_l_debt) + " of debt at " + C.pct(ex.interest_rate) +
        " in the case. ROE uses book equity (assets − debt). Firm U has no interest, so its TIE is n/a.";
      $("firm-u").innerHTML = firmTable(u);
      setupFirmLever(ex, T, scenarios);
      $("firms").hidden = false;

      // CDSS
      const s = C.cdssSchedule(c, sched, T);
      document.querySelectorAll(".p0").forEach((el) => (el.textContent = C.cents(s.base.p0)));
      $("cdss-note").textContent = "EBIT = sales × (1 − variable cost rate) − fixed costs = " + C.dollars(s.base.ebit) +
        " at every amount of debt. Tax rate " + C.pct(T) + ". " + C.num(s.base.n, 0) + " shares at " + C.cents(s.base.p0) +
        " today. Book assets " + C.dollars(s.base.assets) + ". CDSS pays out all earnings, so dividends per share = EPS and g = 0.";
      $("cdss-warning").innerHTML = s.priceCheck.ok ? "" :
        '<p class="warn">⚠ EPS / r<sub>s</sub> with no debt is ' + C.cents(s.priceCheck.implied) +
        ", but cdss.csv says today's price is " + C.cents(s.priceCheck.stated) +
        ". The banker's schedule and CDSS's figures don't agree.</p>";
      $("case-table").innerHTML = cdssTable(s, "caseM");
      $("new-table").innerHTML = cdssTable(s, "newM");
      $("summary").innerHTML = summary(s);
      setupCdssLever(s);
      $("cdss").hidden = false;

      $("status").hidden = true;
    } catch (err) {
      $("status").textContent = "⚠ " + err.message + ". Open the app from its web address (not by double-clicking the file).";
      $("status").classList.add("error");
    }
  }

  start();

  // Register the service worker (sw.js) so the app installs and works offline.
  // The relative path keeps it working at https://<username>.github.io/<repository>/.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* the app still works without it */ });
    });
  }
})();
