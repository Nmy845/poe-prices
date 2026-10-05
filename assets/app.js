/* PoE Трейд-трекер — статический дашборд. Данные: data/data.json (см. export_site_data.py) */
'use strict';
(function () {
const MSK = 3 * 3600;               // Москва: UTC+3 круглый год
const H = 3600, D = 86400;
const GOLD = '#d4a94a', UP = '#3fbf6f', DOWN = '#f0564f';
const PALETTE = ['#e9c46a', '#5aa7e6', '#e76f51', '#8bd17c', '#c17be6', '#4fd1c5', '#f4a261', '#ff7eb6', '#a0aec0', '#f6e05e',
  '#63b3ed', '#fc8181', '#68d391', '#b794f4', '#76e4f7', '#fbd38d', '#f687b3', '#cbd5e0', '#9ae6b4', '#feb2b2'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const PRESETS = [['24h', '24ч'], ['3d', '3д'], ['7d', '7д'], ['30d', '30д'], ['all', 'Всё']];
const PRESET_SEC = { '24h': D, '3d': 3 * D, '7d': 7 * D, '30d': 30 * D };
const qs = new URLSearchParams(location.search);
const DATA_URL = qs.get('demo') ? 'data/demo.json' : 'data/data.json';
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem('poe.' + k); localStorage.setItem('poe.' + k, v); } catch (e) { return null; } };

const S = {
  data: null, items: [], cur: LS('cur') === 'ex' ? 'ex' : 'div',
  range: { preset: LS('preset') || '7d', from: null, to: null },
  sort: { k: 'idx', dir: 1 }, filter: '', item: null,
  show: JSON.parse(LS('show') || '{"min":true,"avg":true,"med":false,"ma1":true,"ma2":false}'),
  cmpSel: null, cmpMetric: 'min', mvPeriod: '24h', charts: [], fps: [],
  pk: { q: '', sel: null, hi: 0 }, cat: null, calc: null
};

/* ---------- утилиты форматирования ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const mskDate = t => new Date((t + MSK) * 1000);
function fmtDT(t) { if (t == null) return '—'; const d = mskDate(t); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
function fmtD(t) { const d = mskDate(t); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`; }
function mskParts(t) { const d = mskDate(t); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: (d.getUTCDay() + 6) % 7 }; }
function dur(sec) {
  sec = Math.max(0, Math.round(sec)); const d = Math.floor(sec / D), h = Math.floor(sec % D / H), m = Math.floor(sec % H / 60);
  if (d) return `${d} д ${h} ч`; if (h) return `${h} ч ${pad(m)} мин`; return `${m} мин`;
}
const now = () => Date.now() / 1000;
const ago = t => t == null ? '—' : (now() - t < 60 ? 'только что' : dur(now() - t) + ' назад');
const NF = {}; const nf = (d) => NF[d] || (NF[d] = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d }));
function fnum(v, dec) { if (v == null || !isFinite(v)) return '—'; if (dec == null) dec = Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 1 ? 2 : 3; return nf(dec).format(v); }
const curLbl = () => S.cur === 'div' ? 'div' : 'ex';
function conv(vDiv, cpd) { if (vDiv == null) return null; return S.cur === 'div' ? vDiv : vDiv * (cpd || lastRate()); }
function money(vDiv, cpd) { const v = conv(vDiv, cpd); if (v == null) return '—'; return fnum(v, S.cur === 'div' ? null : 0) + ' ' + curLbl(); }
function pctTxt(p, dec = 1) { if (p == null || !isFinite(p)) return '—'; const s = p > 0 ? '+' : p < 0 ? '−' : ''; return s + nf(dec).format(Math.abs(p)) + '%'; }
const dirCls = (p, th = 0.5) => p == null || !isFinite(p) ? 'na' : p > th ? 'up' : p < -th ? 'down' : 'flat';
const chip = (p, title) => `<span class="chip ${dirCls(p)}" title="${esc(title || '')}">${p == null ? '—' : (p > 0.5 ? '▲ ' : p < -0.5 ? '▼ ' : '') + pctTxt(p)}</span>`;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
function std(a) { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }
function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }
function lastRate() { const r = S.data && S.data.rates; return r && r.length ? r[r.length - 1][1] : null; }
function lastChaosRate() { const r = S.data && S.data.rates_chaos; return r && r.length ? r[r.length - 1][1] : null; }
function curName(c) { return ({ divine: 'div', chaos: 'c', exalted: 'ex', mirror: 'mirror' }[c]) || c; }

/* ---------- аналитика ---------- */
function prep(it) {
  const pts = it.s.map(r => ({ t: r[0], min: r[1], avg: r[2] ?? r[1], med: r[3] ?? r[1], vol: r[4], n: r[5], cpd: r[6] }));
  return { ...it, pts, rs: resample(pts) };
}
// одна точка на 3-часовой слот (последняя) — убирает дубли тестовых запусков
function resample(pts, step = 3 * H) {
  const m = new Map();
  for (const p of pts) m.set(Math.floor((p.t + MSK) / step), p);
  return [...m.values()];
}
function refPoint(pts, sec) {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1], target = last.t - sec, tol = Math.min(sec * 0.15, 1.5 * H);
  for (let i = pts.length - 2; i >= 0; i--) if (pts[i].t <= target + tol) return pts[i];
  return null;
}
function change(pts, sec, key = 'min') {
  const r = refPoint(pts, sec); if (!r) return null; const l = pts[pts.length - 1];
  if (r[key] == null || l[key] == null || !r[key]) return null; return (l[key] / r[key] - 1) * 100;
}
const spanOf = pts => pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0;
const lastN = (pts, sec) => { if (!pts.length) return []; const t0 = pts[pts.length - 1].t - sec; return pts.filter(p => p.t >= t0); };
function hiLo(pts, sec, key = 'min') { const w = lastN(pts, sec).map(p => p[key]).filter(v => v != null); return w.length ? { hi: Math.max(...w), lo: Math.min(...w) } : null; }
function volatility(rs) {   // σ лог-доходностей за 7д, приведённая к суткам, %
  const w = lastN(rs, 7 * D); if (w.length < 7) return null;
  const r = []; for (let i = 1; i < w.length; i++) r.push(Math.log(w[i].min / w[i - 1].min));
  const dt = median(w.slice(1).map((p, i) => p.t - w[i].t)) || 3 * H;
  return std(r) * Math.sqrt(D / dt) * 100;
}
function regression(rs, sec) {    // наклон log(цены) — %/сутки, R²
  const w = lastN(rs, sec); if (w.length < 6 || spanOf(w) < D) return null;
  const xs = w.map(p => (p.t - w[0].t) / D), ys = w.map(p => Math.log(p.min));
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  if (!sxx) return null; const b = sxy / sxx; const r2 = syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope: (Math.exp(b) - 1) * 100, r2, n: w.length };
}
function maSeries(pts, winSec, key = 'min') {  // скользящее среднее по времени
  const out = []; let j = 0, sum = 0;
  for (let i = 0; i < pts.length; i++) {
    sum += pts[i][key];
    while (pts[j].t < pts[i].t - winSec) { sum -= pts[j][key]; j++; }
    out.push(pts[i].t - pts[0].t >= winSec * 0.8 ? sum / (i - j + 1) : null);
  }
  return out;
}
function trend(rs) {
  const n = rs.length;
  const c = n >= 56 ? { s: 8, l: 56, conf: .8, lbl: 'MA 24ч vs MA 7д' } : n >= 24 ? { s: 4, l: 24, conf: .55, lbl: 'MA 12ч vs MA 3д' } : n >= 12 ? { s: 3, l: 12, conf: .35, lbl: 'MA 9ч vs MA 36ч' } : null;
  if (!c) return { ok: false, need: 'нужно ≥ 36 ч истории (12 замеров), сейчас ' + n };
  const v = rs.map(p => p.min), sma = (k, e) => mean(v.slice(e - k, e));
  const sN = sma(c.s, n), lN = sma(c.l, n), diff = (sN / lN - 1) * 100;
  let cross = null;
  if (n - 1 >= c.l) { const sP = sma(c.s, n - 1), lP = sma(c.l, n - 1); if ((sP - lP) * (sN - lN) < 0) cross = sN > lN ? 'golden' : 'death'; }
  const th = 1; const dir = diff > th ? 'up' : diff < -th ? 'down' : 'flat';
  return { ok: true, ...c, diff, dir, cross };
}
function seasonality(rs, key = 'min') {
  // отклонение цены от центрированного суточного среднего → по часу и дню недели
  const out = { ok: false, span: spanOf(rs) };
  if (rs.length < 4) return out;
  const devs = [];
  for (let i = 0; i < rs.length; i++) {
    const t = rs[i].t; const w = rs.filter(p => Math.abs(p.t - t) <= 12 * H).map(p => p[key]);
    const base = out.span >= 2 * D ? mean(w) : mean(rs.map(p => p[key]));
    const mp = mskParts(t); devs.push({ h: mp.h, wd: mp.wd, dev: (rs[i][key] / base - 1) * 100, v: rs[i][key], t });
  }
  out.devs = devs;
  const grp = (f) => { const m = {}; devs.forEach(d => { (m[f(d)] = m[f(d)] || []).push(d.dev); }); return m; };
  const byH = grp(d => d.h), byW = grp(d => d.wd);
  const sig = (m, minN) => {
    const ks = Object.keys(m).filter(k => m[k].length >= minN); if (ks.length < 2) return null;
    const avg = ks.map(k => ({ k: +k, m: mean(m[k]), n: m[k].length }));
    avg.sort((a, b) => a.m - b.m); const lo = avg[0], hi = avg[avg.length - 1];
    const noise = (std(devs.map(d => d.dev)) || 0) / Math.sqrt(Math.min(lo.n, hi.n));
    return { buy: lo, sell: hi, amp: hi.m - lo.m, real: hi.m - lo.m > 2 * noise && hi.m - lo.m > 0.5, all: avg };
  };
  out.hour = out.span >= 7 * D ? sig(byH, 3) : null;
  out.wday = out.span >= 14 * D ? sig(byW, 2) : null;
  out.ok = true; return out;
}
function floorInfo(it) {
  const l = (it.l || []).filter(x => x[2] != null);
  if (!l.length) return null;
  const p = l.map(x => x[2]), min = p[0];
  const gap = l.length > 1 ? (p[1] / p[0] - 1) * 100 : null;
  const avg = mean(p), spread = (avg / min - 1) * 100;
  const sellers = {}; l.forEach(x => { sellers[x[4]] = (sellers[x[4]] || 0) + 1; });
  const top = Object.entries(sellers).sort((a, b) => b[1] - a[1])[0];
  const ref = it.lt || now(); const ages = l.map(x => x[3] ? ref - x[3] : null).filter(x => x != null);
  const fresh = ages.filter(a => a < D).length; const floorAge = l[0][3] ? ref - l[0][3] : null;
  const atMin = p.filter(v => v <= min * 1.005).length;
  return { min, gap, spread, top, fresh, floorAge, atMin, n: l.length, medAge: median(ages), second: p[1] };
}
function analyze(it) {
  const pts = it.pts, rs = it.rs, last = pts[pts.length - 1];
  const a = { last, span: spanOf(rs), n: rs.length };
  if (!last) return a;
  a.ch = { '3h': change(pts, 3 * H), '24h': change(pts, D), '7d': change(pts, 7 * D), '30d': change(pts, 30 * D) };
  a.vch = { '24h': change(pts, D, 'vol'), '7d': change(pts, 7 * D, 'vol') };
  a.hl7 = hiLo(pts, 7 * D); a.vol = volatility(rs); a.reg = regression(rs, 7 * D); a.reg3 = regression(rs, 3 * D);
  a.trend = trend(rs); a.season = seasonality(rs); a.floor = floorInfo(it);
  a.pos = a.hl7 && a.hl7.hi > a.hl7.lo ? (last.min - a.hl7.lo) / (a.hl7.hi - a.hl7.lo) : null;
  a.rangeW = a.hl7 ? (a.hl7.hi / a.hl7.lo - 1) * 100 : null;
  a.signals = signals(it, a); a.badge = badge(a);
  return a;
}
function sg(cls, ic, tt, tx, conf, kind) { return { cls, ic, tt, tx, conf, kind }; }
function signals(it, a) {
  const out = [], L = a.last, f = a.floor;
  // тренд
  if (a.trend.ok) {
    const t = a.trend; let tx = `${t.lbl}: короткая средняя ${t.diff >= 0 ? 'выше' : 'ниже'} длинной на ${pctTxt(Math.abs(t.diff)).replace('+', '')}.`;
    if (t.cross === 'golden') tx += ' Только что «золотой крест» — короткая пересекла длинную снизу вверх.';
    if (t.cross === 'death') tx += ' Только что «крест смерти» — короткая ушла под длинную.';
    out.push(sg(t.dir === 'up' ? 'up' : t.dir === 'down' ? 'down' : 'info', t.dir === 'up' ? '↗' : t.dir === 'down' ? '↘' : '→',
      t.dir === 'up' ? 'Тренд: восходящий' : t.dir === 'down' ? 'Тренд: нисходящий' : 'Тренд: боковик', tx, t.conf, 'trend'));
  } else out.push(sg('na', '…', 'Тренд — мало данных', t2(a.trend.need), null, 'trend'));
  // импульс
  if (a.reg) {
    const r = a.reg, strong = r.r2 >= .3 && Math.abs(r.slope) >= .5;
    out.push(sg(strong ? (r.slope > 0 ? 'up' : 'down') : 'info', strong ? (r.slope > 0 ? '⚡' : '⚡') : '≈', strong ? `Импульс: ${r.slope > 0 ? 'рост' : 'снижение'} ~${pctTxt(Math.abs(r.slope)).replace('+', '')}/сутки` : 'Импульс: без выраженного направления',
      `Линейная регрессия по ${r.n} замерам (${dur(spanOf(lastN(it.rs, 7 * D)))}), R² = ${nf(2).format(r.r2)}${r.r2 < .3 ? ' — движение шумное, тренд слабый' : ''}. Δ24ч ${pctTxt(a.ch['24h'])}.`,
      Math.min(.85, .25 + r.r2 * .6), 'mom'));
  } else out.push(sg('na', '…', 'Импульс — мало данных', 'Нужны ≥ 24 ч истории (6+ замеров).', null, 'mom'));
  // позиция в 7-дневном диапазоне
  if (a.span >= 3 * D && a.pos != null) {
    const p = a.pos, w = a.rangeW, full = a.span >= 7 * D;
    const conf = (full ? .65 : .4) * (w < 3 ? .5 : 1);
    if (w < 2) out.push(sg('info', '▭', 'Цена стоит на месте', `Весь диапазон за ${full ? '7 д' : dur(a.span)} — всего ${pctTxt(w).replace('+', '')}. Рынок спокойный.`, .5, 'range'));
    else if (p <= .2) out.push(sg('up', '⬇', 'У дна 7-дневного диапазона — возможно, хороший момент купить', `Мин. цена ${money(L.min, L.cpd)} при диапазоне ${money(a.hl7.lo, L.cpd)} – ${money(a.hl7.hi, L.cpd)} (позиция ${Math.round(p * 100)}%). Но если тренд нисходящий — дно может пробиться.`, conf, 'range'));
    else if (p >= .8) out.push(sg('down', '⬆', 'У пика 7-дневного диапазона — возможно, время продавать', `Мин. цена ${money(L.min, L.cpd)} при диапазоне ${money(a.hl7.lo, L.cpd)} – ${money(a.hl7.hi, L.cpd)} (позиция ${Math.round(p * 100)}%). Покупать сейчас — дороже обычного.`, conf, 'range'));
    else out.push(sg('info', '◆', `Середина диапазона (${Math.round(p * 100)}%)`, `За ${full ? '7 д' : dur(a.span)}: ${money(a.hl7.lo, L.cpd)} – ${money(a.hl7.hi, L.cpd)}. Явного перекоса нет.`, conf * .8, 'range'));
  } else out.push(sg('na', '…', 'Позиция в диапазоне 7д — мало данных', `Нужно ≥ 3 дней истории, сейчас ${dur(a.span)}.`, null, 'range'));
  // предложение
  if (a.vch['24h'] != null) {
    const v = a.vch['24h'], pc = a.ch['24h'] || 0;
    if (v >= 5 && pc <= 1) out.push(sg('down', '📦', `Предложение растёт: лотов ${pctTxt(v)} за 24ч`, 'Больше продавцов при стоящей/падающей цене — обычно давление вниз. Продавцам стоит поторопиться, покупателям — подождать.', .45, 'supply'));
    else if (v >= 5) out.push(sg('info', '📦', `Лотов ${pctTxt(v)} за 24ч, цена тоже растёт`, 'Продавцы подтягиваются на рост цены — за ним часто следует откат.', .35, 'supply'));
    else if (v <= -5) out.push(sg('up', '📉', `Предложение сокращается: лотов ${pctTxt(v)} за 24ч`, 'Лоты выкупают/снимают — опережающий признак возможного роста цены.', .45, 'supply'));
    else out.push(sg('info', '📦', `Предложение стабильно (${pctTxt(v)} за 24ч)`, `Сейчас ${fnum(L.vol, 0)} лотов на рынке.`, .4, 'supply'));
  } else out.push(sg('na', '…', 'Динамика предложения — мало данных', `Нужно ≥ 24 ч истории. Сейчас на рынке ${fnum(L.vol, 0)} лотов.`, null, 'supply'));
  // пол и спред (работает сразу)
  if (f) {
    if (f.gap != null && f.gap >= 5) out.push(sg('warn', '🎯', `Одинокий дешёвый лот: на ${pctTxt(f.gap).replace('+', '')} ниже следующего`,
      `Самый дешёвый — ${money(f.min, L.cpd)}, следующий — ${money(f.second, L.cpd)}. Если брать — брать быстро (или это приманка/ошибка цены). Реальный «пол» ближе к ${money(f.second, L.cpd)}.`, .7, 'floor'));
    if (f.spread <= 3) out.push(sg('info', '🧱', `Плотный пол: топ-10 в пределах ${pctTxt(f.spread).replace('+', '')}`,
      `${f.atMin} из ${f.n} лотов по минимальной цене. Чтобы продать быстро — ставь не выше ${money(f.min, L.cpd)}; перебивать на копейки особого смысла нет.`, .6, 'floor'));
    else if (f.spread >= 10) out.push(sg('info', '🪜', `Тонкий пол: средняя топ-10 на ${pctTxt(f.spread).replace('+', '')} выше минимума`,
      `Дешёвых лотов мало, дальше цены быстро растут. Продавцу: можно встать чуть ниже 2–3-го лота и не демпинговать до минимума.`, .55, 'floor'));
    if (f.top && f.top[1] >= 3) out.push(sg('warn', '👤', `Один продавец держит ${f.top[1]} из ${f.n} лотов`, `${esc(f.top[0])} фактически задаёт цену пола — она может резко сдвинуться, если он передумает.`, .5, 'floor'));
    if (f.floorAge != null && f.floorAge >= 3 * D) out.push(sg('info', '⏳', `Дешёвый лот висит уже ${dur(f.floorAge)}`, 'Самый дешёвый лот давно не выкупают — похоже, спрос по этой цене слабый.', .4, 'floor'));
    else if (f.fresh >= 5) out.push(sg('info', '🔥', `Активный рынок: ${f.fresh} из ${f.n} лотов выставлены за последние 24 ч`, 'Много свежих лотов у пола — продавцы активно перебивают друг друга.', .45, 'floor'));
  }
  // лучшее время
  const se = a.season;
  if (se && se.hour) {
    const h = se.hour; out.push(sg(h.real ? 'info' : 'na', '🕒', h.real ? `Покупать дешевле около ${pad(h.buy.k)}:44, продавать — около ${pad(h.sell.k)}:44 МСК` : 'По времени суток заметной закономерности нет',
      h.real ? `В среднем в ${pad(h.buy.k)}:xx цена на ${pctTxt(Math.abs(h.buy.m)).replace('+', '')} ниже суточной средней, в ${pad(h.sell.k)}:xx — на ${pctTxt(Math.abs(h.sell.m)).replace('+', '')} выше (разница ~${pctTxt(h.amp).replace('+', '')}).` : `Разница между часами ~${pctTxt(h.amp).replace('+', '')} — в пределах шума.`, h.real ? Math.min(.7, .3 + se.span / (30 * D) * .4) : .3, 'time'));
  } else out.push(sg('na', '…', 'Лучшее время суток — мало данных', `Нужно ≥ 7 дней истории, сейчас ${dur(a.span)}.`, null, 'time'));
  if (se && se.wday) {
    const w = se.wday; out.push(sg(w.real ? 'info' : 'na', '📅', w.real ? `Дешевле всего в ${WD[w.buy.k]}, дороже — в ${WD[w.sell.k]}` : 'По дням недели закономерности нет',
      `Среднее отклонение: ${WD[w.buy.k]} ${pctTxt(w.buy.m)}, ${WD[w.sell.k]} ${pctTxt(w.sell.m)}.`, w.real ? .4 : .25, 'time'));
  } else out.push(sg('na', '…', 'Лучший день недели — мало данных', `Нужно ≥ 14 дней истории, сейчас ${dur(a.span)}.`, null, 'time'));
  return out;
}
function t2(s) { return s.charAt(0).toUpperCase() + s.slice(1) + '.'; }
function badge(a) {
  if (!a.last) return { cls: 'na', txt: 'Нет данных', conf: 0 };
  let score = 0, w = 0, confs = [];
  if (a.trend.ok) { score += (a.trend.dir === 'up' ? 1 : a.trend.dir === 'down' ? -1 : 0) * a.trend.conf; w += a.trend.conf; confs.push(a.trend.conf); }
  if (a.reg && a.reg.r2 >= .2) { const c = .25 + a.reg.r2 * .5; score += Math.sign(a.reg.slope) * Math.min(1, Math.abs(a.reg.slope) / 2) * c; w += c; confs.push(c); }
  if (!w) {
    return { cls: 'na', txt: 'Мало данных', sub: a.span < D ? `история ${dur(a.span)}` : '', conf: 0, title: 'Для сигналов тренда нужно хотя бы 1–1,5 суток истории' };
  }
  const s = score / w; const conf = Math.round(mean(confs) * 100);
  let b = s > .3 ? { cls: 'up', txt: '▲ Растёт' } : s < -.3 ? { cls: 'down', txt: '▼ Падает' } : { cls: 'flat', txt: '◆ Флэт' };
  if (a.span >= 3 * D && a.pos != null && a.rangeW >= 2) {
    if (a.pos <= .2) b.extra = { cls: 'buy', txt: 'у дна 7д' }; else if (a.pos >= .8) b.extra = { cls: 'sell', txt: 'у пика 7д' };
  }
  return { ...b, conf, title: `Сводный сигнал (тренд + импульс), уверенность ${conf}%` };
}
const badgeHtml = b => `<span class="badge ${b.cls}" title="${esc(b.title || '')}">${b.txt}${b.conf ? ` <small>${b.conf}%</small>` : ''}${b.sub ? ` <small>${esc(b.sub)}</small>` : ''}</span>${b.extra ? ` <span class="badge ${b.extra.cls}">${b.extra.txt}</span>` : ''}`;

/* ---------- диапазон дат ---------- */
function getRange() {
  const r = S.range;
  if (r.preset === 'custom' && r.from) return [r.from, r.to];
  if (PRESET_SEC[r.preset]) return [now() - PRESET_SEC[r.preset], Infinity];
  return [-Infinity, Infinity];
}
const inRange = pts => { const [a, b] = getRange(); return pts.filter(p => p.t >= a && p.t <= b); };
function rangeLabel() {
  const [a, b] = getRange(); const all = S.items.flatMap(i => i.pts); if (!all.length) return '';
  const t0 = Math.max(a, Math.min(...all.map(p => p.t))), t1 = Math.min(b, Math.max(...all.map(p => p.t)));
  return t1 >= t0 ? `${fmtDT(t0)} — ${fmtDT(t1)} МСК` : 'нет данных в выбранном периоде';
}
function rangeBar() {
  return `<div class="rangebar"><div class="seg rp">${PRESETS.map(([k, l]) => `<button data-p="${k}" class="${S.range.preset === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  <input class="fp-in" placeholder="📅 Свой период: дд.мм.гггг — дд.мм.гггг" readonly><span class="range-info">${rangeLabel()}</span></div>`;
}
function bindRange(root, rerender) {
  $$('.rp button', root).forEach(b => b.onclick = () => { S.range = { preset: b.dataset.p }; LS('preset', b.dataset.p); rerender(); });
  $$('.fp-in', root).forEach(inp => {
    const all = S.items.flatMap(i => i.pts.map(p => p.t)); const lo = all.length ? Math.min(...all) : now(), hi = all.length ? Math.max(...all) : now();
    const toLocal = t => { const p = mskParts(t); return new Date(p.y, p.m, p.d); };
    const fp = flatpickr(inp, {
      mode: 'range', locale: 'ru', dateFormat: 'd.m.Y', disableMobile: true, minDate: toLocal(lo), maxDate: toLocal(Math.max(hi, now())),
      onClose: (sel) => {
        if (!sel.length) return; const a = sel[0], b = sel[1] || sel[0];
        S.range = { preset: 'custom', from: Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) / 1000 - MSK, to: Date.UTC(b.getFullYear(), b.getMonth(), b.getDate() + 1) / 1000 - MSK - 1 };
        rerender();
      }
    });
    if (S.range.preset === 'custom') fp.setDate([toLocal(S.range.from), toLocal(S.range.to)], false);
    S.fps.push(fp);
  });
}

/* ---------- графики ---------- */
const tms = t => (t + MSK) * 1000;      // ECharts с useUTC=true → ось в МСК
function axisTime(v) { const d = new Date(v); const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; const dm = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`; return hm === '00:00' ? `{b|${dm}}` : `${hm}\n${dm}`; }
const tipTime = v => { const d = new Date(v); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} МСК`; };
const AX = { axisLine: { lineStyle: { color: '#323a46' } }, axisLabel: { color: '#8b909b', fontSize: 11 }, splitLine: { lineStyle: { color: '#1e242c' } } };
function baseOpt(extra) {
  return Object.assign({
    useUTC: true, animation: false, backgroundColor: 'transparent', textStyle: { fontFamily: 'system-ui,Segoe UI,Roboto,sans-serif', color: '#c9c6bd' },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(16,19,24,.96)', borderColor: '#3a3220', textStyle: { color: '#e7e3d8', fontSize: 12 }, axisPointer: { type: 'cross', lineStyle: { color: '#8a6a26' }, crossStyle: { color: '#8a6a26' }, label: { backgroundColor: '#3a2f17', color: '#f0cf7a' } } },
    legend: { top: 0, textStyle: { color: '#a9a69c' }, inactiveColor: '#444', itemGap: 14 },
    grid: { left: 8, right: 14, top: 34, bottom: 56, containLabel: true }
  }, extra);
}
const timeAxis = () => Object.assign({ type: 'time', axisLabel: { color: '#8b909b', fontSize: 11, formatter: axisTime, rich: { b: { fontWeight: 'bold', color: '#c9c6bd' } }, hideOverlap: true }, axisPointer: { label: { formatter: p => tipTime(p.value) } } }, { axisLine: AX.axisLine, splitLine: { show: false } });
const valAxis = (name, fmt) => ({ type: 'value', scale: true, name, nameTextStyle: { color: '#6f7480', align: 'left' }, axisLabel: { color: '#8b909b', fontSize: 11, formatter: fmt }, splitLine: AX.splitLine, axisLine: { show: false } });
const zoom = (bottom = 8) => [{ type: 'inside', filterMode: 'none' }, { type: 'slider', height: 18, bottom, borderColor: '#252b35', fillerColor: 'rgba(212,169,74,.15)', handleStyle: { color: '#d4a94a' }, textStyle: { color: '#6f7480' }, dataBackground: { lineStyle: { color: '#3a3220' }, areaStyle: { color: 'rgba(212,169,74,.08)' } }, labelFormatter: v => tipTime(v) }];
function mkChart(el, opt) { const c = echarts.init(el, null, { renderer: 'canvas' }); c.setOption(opt); S.charts.push(c); return c; }
function disposeCharts() { S.charts.forEach(c => c.dispose()); S.charts = []; S.fps.forEach(f => f.destroy()); S.fps = []; }
const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function sparkSvg(vals, w = 110, h = 30) {
  vals = vals.filter(v => v != null); if (vals.length < 2) return `<svg class="spark" width="${w}" height="${h}"><text x="${w / 2}" y="${h / 2 + 4}" fill="#6f7480" font-size="10" text-anchor="middle">мало данных</text></svg>`;
  const lo = Math.min(...vals), hi = Math.max(...vals), rng = hi - lo || 1;
  const pts = vals.map((v, i) => [i / (vals.length - 1) * (w - 4) + 2, h - 3 - (v - lo) / rng * (h - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const c = vals[vals.length - 1] > vals[0] * 1.002 ? UP : vals[vals.length - 1] < vals[0] * .998 ? DOWN : GOLD;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}L${w - 2} ${h}L2 ${h}Z" fill="${hexA(c, .12)}"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.2" fill="${c}"/></svg>`;
}
const ph = (title, txt) => `<div class="ph"><b>${title}</b><span>${txt}</span></div>`;

/* ---------- шапка: статус обновления ---------- */
function nextRun(fromT) {
  const sc = S.data.schedule || { hours: [2, 5, 8, 11, 14, 17, 20, 23], minute: 44 };
  const p = mskParts(fromT); const day0 = Date.UTC(p.y, p.m, p.d) / 1000 - MSK;
  for (let k = 0; k < 3; k++) for (const h of sc.hours) { const t = day0 + k * D + h * H + sc.minute * 60; if (t > fromT) return t; }
  return null;
}
function renderStatus() {
  const d = S.data; if (!d) return; const lr = d.last_run, nr = nextRun(now()), late = lr && now() - lr > 3 * H + 40 * 60;
  $('#status').innerHTML = `<div class="st"><b><i class="dot ${late ? 'late' : ''}"></i>Обновлено: ${fmtDT(lr)} МСК</b><span>${ago(lr)}${late ? ' · обновление задерживается' : ''}</span></div>
    <div class="st"><b>Следующий сбор: ${fmtDT(nr)} МСК</b><span>через ${dur(nr - now())} · сайт обновится через пару минут после</span></div>
    <div class="st rate"><b>1 div = ${fnum(lastRate(), 0)} ex</b><span>${lastChaosRate() ? '= ' + fnum(lastChaosRate(), 1) + ' c · ' : ''}курс poe.ninja</span></div>`;
}

/* ---------- views ---------- */
function rowData(it) {
  const a = it.a, L = a.last || {};
  const bd = bestDivRub();
  return { it, a, L, idx: it.idx, name: it.name, min: L.min, avg: L.avg, med: L.med, chaos: L.min != null ? L.min * L.cpd : null, rub: L.min != null && bd ? L.min * bd.v : null, vol: L.vol,
    ch3: a.ch && a.ch['3h'], ch24: a.ch && a.ch['24h'], ch7: a.ch && a.ch['7d'], ch30: a.ch && a.ch['30d'], volat: a.vol, pos: a.pos };
}
function tradeBtn(it, sm, short) { return it.link ? `<a class="btn ${sm ? 'sm' : ''}" href="${esc(it.link)}" target="_blank" rel="noopener" title="Открыть поиск на pathofexile.com/trade" onclick="event.stopPropagation()">↗ ${short ? 'Трейд' : 'Открыть трейд'}</a>` : `<span class="btn ghost ${sm ? 'sm' : ''}" disabled title="Ссылка ещё не создана">нет ссылки</span>`; }
function rangeCell(a) {
  if (!a.hl7) return '—'; const L = a.last; const p = a.pos == null ? .5 : a.pos;
  return `<div class="rng" title="7д: ${money(a.hl7.lo, L.cpd)} – ${money(a.hl7.hi, L.cpd)}"><i style="left:calc(${(p * 100).toFixed(0)}% - 1px)"></i></div><div class="rng-l"><span>${money(a.hl7.lo, L.cpd)}</span><span>${money(a.hl7.hi, L.cpd)}</span></div>`;
}
function volatTxt(v) { if (v == null) return '<span class="na" title="Нужно ≥ 7 замеров">мало данных</span>'; const l = v < 2 ? 'низкая' : v < 6 ? 'средняя' : 'высокая'; return `<span title="σ дневных изменений">${nf(1).format(v)}% <span class="muted">${l}</span></span>`; }

function viewOverview(root) {
  const rows = S.items.map(rowData);
  const f = S.filter.trim().toLowerCase();
  let list = rows.filter(r => !f || r.name.toLowerCase().includes(f) || (r.it.type || '').toLowerCase().includes(f));
  const k = S.sort.k; list.sort((x, y) => { const a = x[k], b = y[k]; if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1; return (typeof a === 'string' ? a.localeCompare(b) : a - b) * S.sort.dir; });
  const allPts = S.items.flatMap(i => i.rs); const span = Math.max(0, ...S.items.map(i => i.a.span || 0));
  const rates = (S.data.rates || []).map(r => ({ t: r[0], min: r[1] })); const rch = change(rates, D);
  const totalVol = S.items.reduce((s, i) => s + ((i.a.last && i.a.last.vol) || 0), 0);
  const firstT = allPts.length ? Math.min(...allPts.map(p => p.t)) : null;
  const cols = [['name', 'Предмет'], ['min', 'Мин.'], ['avg', 'Ср. топ-10'], ['med', 'Медиана'], ['chaos', 'Мин. в ex'], ['rub', '≈ ₽'], ['vol', 'Лотов'], ['ch3', 'Δ 3ч'], ['ch24', 'Δ 24ч'], ['ch7', 'Δ 7д'], ['ch30', 'Δ 30д'], [null, 'Мин. за 7д'], ['pos', 'Мин/макс 7д'], ['volat', 'Волатильность'], [null, 'Сигнал'], [null, '']];
  const th = cols.map(([k2, l]) => k2 ? `<th data-k="${k2}">${l}${S.sort.k === k2 ? ` <span class="ar">${S.sort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>` : `<th class="nos">${l}</th>`).join('');
  const tr = list.map(r => { const a = r.a, L = r.L; if (!a.last) return `<tr data-i="${esc(r.name)}"><td class="l"><div class="nm-wrap"><div><div class="iname">${esc(r.name)}</div><div class="itype">${esc(r.it.type || '')}</div></div>${rmBtn(r.it)}</div></td><td colspan="15" class="muted" style="text-align:left">ещё нет данных — первый замер появится после обработки запроса или ближайшего сбора</td></tr>`;
    return `<tr data-i="${esc(r.name)}"><td class="l"><div class="nm-wrap"><div><div class="iname">${esc(r.name)}</div><div class="itype">${esc(r.it.type || '')}</div></div>${rmBtn(r.it)}</div></td>
    <td><b>${money(L.min, L.cpd)}</b></td><td>${money(L.avg, L.cpd)}</td><td>${money(L.med, L.cpd)}</td><td>${fnum(r.chaos, 0)} ex</td><td title="${esc(RUB_TITLE)}">${rub(r.rub)}</td>
    <td>${fnum(L.vol, 0)}${a.vch['24h'] != null ? `<div class="${dirCls(a.vch['24h'], 2)}" style="font-size:11px">${pctTxt(a.vch['24h'])} 24ч</div>` : ''}</td>
    <td>${chip(r.ch3)}</td><td>${chip(r.ch24)}</td><td>${chip(r.ch7)}</td><td>${chip(r.ch30)}</td>
    <td>${sparkSvg(lastN(r.it.rs, 7 * D).map(p => conv(p.min, p.cpd)))}</td><td>${rangeCell(a)}</td><td>${volatTxt(a.vol)}</td><td>${badgeHtml({ ...a.badge, sub: '' })}</td><td>${tradeBtn(r.it, true, true)}</td></tr>`; }).join('');
  const cards = list.map(r => { const a = r.a, L = r.L; if (!a.last) return ''; return `<div class="card" data-i="${esc(r.name)}">
    <div class="row"><div><div class="iname">${esc(r.name)}</div><div class="itype">${esc(r.it.type || '')} · ${fnum(L.vol, 0)} лотов</div></div><div style="text-align:right"><div class="price">${money(L.min, L.cpd)}</div><div class="muted" style="font-size:12px">${r.rub != null ? '≈ ' + rub(r.rub) + ' · ' : ''}ср.10 ${money(L.avg, L.cpd)}</div></div></div>
    <div class="row" style="margin-top:6px">${sparkSvg(lastN(r.it.rs, 7 * D).map(p => conv(p.min, p.cpd)), 150, 34)}<div style="text-align:right">${badgeHtml(a.badge)}</div></div>
    <div class="mini"><div><span>3ч</span>${chip(r.ch3)}</div><div><span>24ч</span>${chip(r.ch24)}</div><div><span>7д</span>${chip(r.ch7)}</div><div><span>30д</span>${chip(r.ch30)}</div></div>
    <div class="row" style="margin-top:8px"><span class="muted" style="font-size:12px">${a.hl7 ? `7д: ${money(a.hl7.lo, L.cpd)} – ${money(a.hl7.hi, L.cpd)}` : ''}</span><span class="acts">${tradeBtn(r.it, true)}${rmBtn(r.it)}</span></div></div>`; }).join('');
  const top = S.items.flatMap(i => (i.a.signals || []).filter(s => s.conf != null && s.conf >= .45 && s.cls !== 'na').map(s => ({ ...s, item: i.name }))).sort((a, b) => b.conf - a.conf).slice(0, 6);
  root.innerHTML = `
  <div class="kpis">
    <div class="kpi"><div class="l">Курс ex / div</div><div class="v">${fnum(lastRate(), 1)}</div><div class="s">${rch != null ? chip(rch) + ' за 24ч' : 'Δ24ч — мало данных'}</div></div>
    ${(() => { const bd = bestDivRub(); return bd ? `<div class="kpi"><div class="l">1000 div ≈ (самый дешёвый онлайн)</div><div class="v">${rub(bd.v * 1000, 0)}</div><div class="s">${SITE_NAME[bd.site]} · <a href="#/rmt">курс к рублю →</a></div></div>` : ''; })()}
    <div class="kpi"><div class="l">Предметов в трекинге</div><div class="v">${S.items.length}</div><div class="s">${fnum(totalVol, 0)} лотов на рынке всего</div></div>
    <div class="kpi"><div class="l">История</div><div class="v">${dur(span)}</div><div class="s">${firstT ? 'с ' + fmtDT(firstT) : '—'} · ${(n => n + ' ' + plural(n, 'замер', 'замера', 'замеров'))(Math.max(0, ...S.items.map(i => i.rs.length)))}</div></div>
    <div class="kpi"><div class="l">Самый активный рост 24ч</div><div class="v">${(() => { const b = rows.filter(r => r.ch24 != null).sort((a, b) => b.ch24 - a.ch24)[0]; return b ? `<span class="${dirCls(b.ch24)}">${pctTxt(b.ch24)}</span>` : '<span class="na">—</span>'; })()}</div><div class="s">${(() => { const b = rows.filter(r => r.ch24 != null).sort((a, b) => b.ch24 - a.ch24)[0]; return b ? esc(b.name) : 'нужно ≥ 24 ч истории'; })()}</div></div>
  </div>
  ${dataProgress(span)}
  <div class="panel" style="margin-top:14px">
    <h2>Цены сейчас <span class="hint">клик по строке — подробный график · цены в ${S.cur === 'div' ? 'Divine' : 'Exalted'} · Δ — изменение мин. цены</span><span style="flex:1"></span><input class="search" id="flt" placeholder="🔍 Поиск предмета" value="${esc(S.filter)}"></h2>
    <div class="tbl-wrap tbl-overview"><table class="t"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>
    <div class="cards">${cards}</div>
  </div>
  ${pickerHtml()}
  <div class="grid g2" style="margin-top:14px">
    <div class="panel"><h2>Главное сейчас <span class="hint">самые уверенные сигналы · <a href="#/signals">все сигналы →</a></span></h2>
      <div class="sig-list">${top.length ? top.map(s => sigHtml(s, true)).join('') : ph('Пока тихо', 'Сильных сигналов нет — или данных ещё мало.')}</div></div>
    <div class="panel"><h2>Лидеры за 24ч <span class="hint"><a href="#/movers">подробнее →</a></span></h2>${moversMini('24h')}</div>
  </div>`;
  $$('th[data-k]', root).forEach(h => h.onclick = () => { const k2 = h.dataset.k; S.sort = { k: k2, dir: S.sort.k === k2 ? -S.sort.dir : (k2 === 'name' ? 1 : -1) }; render(); });
  $$('[data-i]', root).forEach(r => r.onclick = () => { location.hash = '#/item/' + encodeURIComponent(r.dataset.i); });
  bindRemove(root); renderPicker(); loadCatalog();
  const flt = $('#flt', root); flt.oninput = () => { S.filter = flt.value; const pos = flt.selectionStart; render(); const n = $('#flt'); n.focus(); n.setSelectionRange(pos, pos); };
}
function dataProgress(span) {
  if (span >= 30 * D) return '';
  const it = [['Δ 24ч и динамика лотов', D], ['Тренд (скользящие средние)', 36 * H], ['Позиция в диапазоне', 3 * D], ['Лучшее время суток', 7 * D], ['Лучший день недели', 14 * D], ['Δ 30д', 30 * D]];
  return `<div class="panel"><h2>Накопление истории <span class="hint">сбор раз в 3 часа · часть аналитики включится, когда наберётся данных</span></h2><div class="progress">${it.map(([l, need]) => { const p = Math.min(1, span / need); return `<div class="prog ${p >= 1 ? 'ok' : ''}"><div style="display:flex;justify-content:space-between"><span>${l}</span><span class="muted">${p >= 1 ? '✓ готово' : 'ещё ' + dur(need - span)}</span></div><div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div></div>`; }).join('')}</div></div>`;
}
function sigHtml(s, withItem) {
  return `<div class="sig ${s.cls}"><div class="ic">${s.ic}</div><div><div class="tt">${withItem ? `<a href="#/item/${encodeURIComponent(s.item)}">${esc(s.item)}</a>: ` : ''}${s.tt}</div><div class="tx">${s.tx}</div></div>
  <div class="conf">${s.conf == null ? 'мало данных' : `уверенность ${Math.round(s.conf * 100)}%<div class="bar"><i style="width:${Math.round(s.conf * 100)}%"></i></div>`}</div></div>`;
}

function viewSignals(root) {
  const cards = S.items.filter(i => i.a.last).map(i => { const L = i.a.last; return `<div class="panel sig-card"><div class="hd"><div><a class="iname" href="#/item/${encodeURIComponent(i.name)}" style="font-size:16px">${esc(i.name)}</a> <span class="muted">${money(L.min, L.cpd)} · ${fnum(L.vol, 0)} лотов</span></div><div>${badgeHtml(i.a.badge)} ${tradeBtn(i, true)}</div></div>
    <div class="sig-list">${i.a.signals.map(s => sigHtml(s)).join('')}</div></div>`; }).join('');
  root.innerHTML = `<div class="sect-title">Сигналы и советы</div>
  <div class="disclaimer">⚠️ <b>Это не финансовый совет.</b> Ниже — простые правила поверх собранных цен: скользящие средние, позиция в диапазоне, динамика числа лотов, структура «пола». Рынок PoE любит сюрпризы (патчи, стримеры, прайс-фиксеры), так что думай своей головой 🙂 Уверенность — грубая оценка того, насколько хватает данных и насколько сигнал выражен. Где данных мало — так и пишем, без фантазий.</div>
  <div style="margin-top:14px">${dataProgress(Math.max(0, ...S.items.map(i => i.a.span || 0)))}</div>
  <div class="grid g2" style="margin-top:14px">${cards || ph('Нет данных', '')}</div>
  <div class="panel" style="margin-top:14px"><h3>Как читать</h3><div class="tx2" style="font-size:13px;line-height:1.6">
  <b>Тренд</b> — короткая скользящая средняя мин. цены выше длинной → рост, ниже → падение; пересечение («крест») — смена тренда.
  <b>Импульс</b> — наклон линии регрессии за 7 дней (%/сутки) и её R² (насколько движение похоже на прямую, а не на шум).
  <b>Позиция в диапазоне</b> — где текущая цена между минимумом и максимумом за 7 дней: у дна покупать выгоднее, у пика — продавать.
  <b>Предложение</b> — число лотов: если растёт, а цена нет — давление вниз; если лоты исчезают — часто цена следом растёт.
  <b>Пол</b> — по текущим 10 лотам: одинокий дешёвый лот, плотность цен, один продавец со «стеной».
  <b>Лучшее время</b> — средние отклонения цены от суточной средней по часам/дням недели; показываем только если разница больше шума.</div></div>`;
}

function viewItem(root, name) {
  const it = S.items.find(i => i.name === name) || S.items.find(i => i.a.last) || S.items[0];
  if (!it) { root.innerHTML = ph('Нет предметов', ''); return; }
  S.item = it.name; const a = it.a, L = a.last;
  const pills = `<div class="pills" style="margin-bottom:6px">${S.items.map(i => `<button class="pill ${i === it ? 'on' : ''}" data-n="${esc(i.name)}">${esc(i.name)}</button>`).join('')}</div>`;
  if (!L) { root.innerHTML = pills + ph(esc(it.name), 'Данных по предмету ещё нет'); bindPills(root); return; }
  const pts = inRange(it.pts);
  const tg = (k, l) => `<button data-s="${k}" class="${S.show[k] ? 'on' : ''}">${l}</button>`;
  const f = a.floor;
  root.innerHTML = `${pills}
  <div class="ihead"><div><h1>${esc(it.name)}</h1><div class="muted">${esc(it.type || '')} · ${esc(S.data.league)} · данные на ${fmtDT(L.t)} МСК</div>
     <div class="chips">${['3h', '24h', '7d', '30d'].map(k => `<span class="muted" style="font-size:12px;align-self:center">${{ '3h': '3ч', '24h': '24ч', '7d': '7д', '30d': '30д' }[k]}</span>${chip(a.ch[k])}`).join(' ')}</div></div>
    <div style="text-align:right"><div class="big">${money(L.min, L.cpd)}</div><div class="muted">${S.cur === 'div' ? fnum(L.min * L.cpd, 0) + ' ex' : fnum(L.min) + ' div'} · ср.10 ${money(L.avg, L.cpd)} · медиана ${money(L.med, L.cpd)}</div>
     <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;align-items:center">${badgeHtml(a.badge)} ${tradeBtn(it)}</div></div></div>
  <div class="kpis">
    <div class="kpi"><div class="l">Лотов на рынке</div><div class="v">${fnum(L.vol, 0)}</div><div class="s">${a.vch['24h'] != null ? chip(a.vch['24h']) + ' за 24ч' : 'Δ24ч — мало данных'}</div></div>
    <div class="kpi"><div class="l">Мин / макс 7д</div><div class="v" style="font-size:17px">${a.hl7 ? money(a.hl7.lo, L.cpd) + ' – ' + money(a.hl7.hi, L.cpd) : '—'}</div><div class="s">${a.span >= 3 * D && a.pos != null ? 'позиция ' + Math.round(a.pos * 100) + '%' : 'за ' + dur(a.span) + ' истории'}</div></div>
    <div class="kpi"><div class="l">Волатильность</div><div class="v" style="font-size:17px">${volatTxt(a.vol)}</div><div class="s">σ изменений за сутки</div></div>
    <div class="kpi"><div class="l">Спред мин → ср.10</div><div class="v">${f ? pctTxt(f.spread) : '—'}</div><div class="s">${f && f.gap != null ? '1-й → 2-й лот: ' + pctTxt(f.gap) : ''}</div></div>
    <div class="kpi"><div class="l">Свежие лоты (24ч)</div><div class="v">${f ? f.fresh + ' / ' + f.n : '—'}</div><div class="s">${f && f.medAge != null ? 'медианный возраст ' + dur(f.medAge) : ''}</div></div>
  </div>
  <div class="toolbar">${rangeBar()}<span style="flex:1"></span><div class="seg" id="ser">${tg('min', 'Мин.')}${tg('avg', 'Ср. топ-10')}${tg('med', 'Медиана')}${tg('ma1', 'MA 24ч')}${tg('ma2', 'MA 7д')}</div></div>
  <div class="grid g-side">
    <div class="grid">
      <div class="panel"><h3>Цена <span class="hint">колесо/щипок — зум, перетаскивание — сдвиг · ${pts.length} ${plural(pts.length, 'замер', 'замера', 'замеров')} в периоде</span></h3>${pts.length ? '<div class="chart" id="cPrice"></div>' : ph('Нет данных в выбранном периоде', 'Выбери другой период')}</div>
      <div class="panel"><h3>Предложение <span class="hint">всего лотов с моментальным выкупом</span></h3>${pts.length ? '<div class="chart sm" id="cVol"></div>' : ph('Нет данных', '')}</div>
    </div>
    <div class="panel"><h3>Сигналы по предмету</h3><div class="sig-list">${a.signals.map(s => sigHtml(s)).join('')}</div><div class="muted" style="font-size:11.5px;margin-top:10px">Не финансовый совет 🙂</div></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="panel"><h3>Дневные свечи мин. цены <span class="hint">открытие/закрытие/мин/макс за сутки МСК</span></h3><div id="cCandle"></div></div>
    <div class="panel"><h3>Цена по часу суток <span class="hint">отклонение от суточной средней, % · вся история</span></h3><div id="cHour"></div></div>
  </div>
  <div class="panel" style="margin-top:14px"><h3>Тепловая карта: день недели × час <span class="hint">вся история · зелёный — дешевле обычного (покупать), красный — дороже (продавать)</span></h3><div id="cHeat"></div></div>
  <div class="panel" style="margin-top:14px"><h3>Топ-10 самых дешёвых лотов сейчас <span class="hint">проверено ${fmtDT(it.lt)} МСК · ${ago(it.lt)}</span><span style="flex:1"></span>${tradeBtn(it, true)}</h3>${listingsTable(it)}</div>`;
  bindPills(root);
  bindRange(root, render);
  $$('#ser button', root).forEach(b => b.onclick = () => { S.show[b.dataset.s] = !S.show[b.dataset.s]; LS('show', JSON.stringify(S.show)); render(); });
  if (pts.length) drawItemCharts(it, pts);
  drawSeason(it, it.pts);
  drawCandles(it, pts);
}
function bindPills(root) { $$('.pill[data-n]', root).forEach(b => b.onclick = () => { location.hash = '#/item/' + encodeURIComponent(b.dataset.n); }); }
function listingsTable(it) {
  const l = it.l || []; if (!l.length) return ph('Нет лотов', '');
  const min = l[0][2]; const ref = it.lt || now();
  return `<div class="tbl-wrap"><table class="t"><thead><tr><th class="nos">#</th><th class="nos">Цена</th><th class="nos">≈ div</th><th class="nos">≈ ex</th><th class="nos">к мин.</th><th class="nos" style="text-align:left">Продавец</th><th class="nos">Выставлен (МСК)</th><th class="nos">Висит</th><th class="nos"></th></tr></thead><tbody>
  ${l.map((x, i) => { const age = x[3] ? ref - x[3] : null; const cpd = it.a.last.cpd; return `<tr style="cursor:default"><td class="l">${i + 1}</td><td><b>${fnum(x[0])} ${esc(curName(x[1]))}</b></td><td>${fnum(x[2])}</td><td>${fnum(x[2] * cpd, 0)}</td>
  <td class="${i && x[2] > min * 1.0001 ? 'muted' : ''}">${i ? pctTxt((x[2] / min - 1) * 100) : '—'}</td><td class="l">${esc(x[4])}</td><td>${fmtDT(x[3])}</td>
  <td class="${age != null && age < D ? 'up' : age != null && age > 7 * D ? 'muted' : ''}">${age != null ? dur(age) : '—'}</td><td>${it.link ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">трейд ↗</a>` : ''}</td></tr>`; }).join('')}
  </tbody></table></div><div class="muted" style="font-size:12px;margin-top:8px">Конкретный лот — в поиске на трейде (сортировка по цене); зелёным — выставлены за последние 24 ч.</div>`;
}
function drawItemCharts(it, pts) {
  const cv = (p, k) => conv(p[k], p.cpd), unit = curLbl();
  const full = it.pts; const ma1 = maSeries(full, D), ma2 = maSeries(full, 7 * D); const idx = new Map(full.map((p, i) => [p.t, i]));
  const sym = pts.length < 60;
  const line = (name, k, color, w, extra) => ({ name, type: 'line', data: pts.map(p => [tms(p.t), cv(p, k)]), showSymbol: sym, symbolSize: 5, smooth: false, lineStyle: { width: w, color }, itemStyle: { color }, emphasis: { focus: 'series' }, ...extra });
  const series = [];
  if (S.show.min) series.push(line('Мин.', 'min', GOLD, 2.2, { areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(212,169,74,.25)' }, { offset: 1, color: 'rgba(212,169,74,0)' }]) } }));
  if (S.show.avg) series.push(line('Ср. топ-10', 'avg', '#5aa7e6', 1.6));
  if (S.show.med) series.push(line('Медиана', 'med', '#c17be6', 1.4));
  const maLine = (name, arr, color) => ({ name, type: 'line', data: pts.map(p => { const v = arr[idx.get(p.t)]; return [tms(p.t), v == null ? null : conv(v, p.cpd)]; }), showSymbol: false, connectNulls: false, lineStyle: { width: 1.4, type: 'dashed', color }, itemStyle: { color } });
  if (S.show.ma1) series.push(maLine('MA 24ч', ma1, '#8bd17c'));
  if (S.show.ma2) series.push(maLine('MA 7д', ma2, '#e76f51'));
  const tip = ps => `<b>${tipTime(ps[0].value[0])}</b><br>` + ps.map(p => `${p.marker}${p.seriesName}: <b>${p.value[1] == null ? '—' : fnum(p.value[1], S.cur === 'div' ? null : 0) + ' ' + unit}</b>`).join('<br>');
  const c1 = mkChart($('#cPrice'), baseOpt({ tooltip: { ...baseOpt().tooltip, formatter: tip }, xAxis: timeAxis(), yAxis: valAxis(unit, v => fnum(v, S.cur === 'div' ? null : 0)), dataZoom: zoom(), series,
    legend: { ...baseOpt().legend, left: 0, type: 'scroll', right: innerWidth < 600 ? 0 : 110 },
    toolbox: { show: innerWidth >= 600, right: 6, top: -4, iconStyle: { borderColor: '#8b909b' }, feature: { dataZoom: { yAxisIndex: 'none', title: { zoom: 'Зум областью', back: 'Назад' } }, restore: { title: 'Сброс' }, saveAsImage: { title: 'PNG', backgroundColor: '#0b0d10', name: it.name } } } }));
  const c2 = mkChart($('#cVol'), baseOpt({ grid: { left: 8, right: 14, top: 24, bottom: 28, containLabel: true }, legend: { show: false }, xAxis: timeAxis(), yAxis: { ...valAxis('лотов', v => fnum(v, 0)), scale: pts.length > 2 }, dataZoom: [{ type: 'inside', filterMode: 'none' }],
    tooltip: { ...baseOpt().tooltip, formatter: ps => `<b>${tipTime(ps[0].value[0])}</b><br>${ps[0].marker}Лотов: <b>${fnum(ps[0].value[1], 0)}</b>` },
    series: [{ name: 'Лотов', type: pts.length > 2 ? 'line' : 'bar', step: 'end', barMaxWidth: 18, data: pts.map(p => [tms(p.t), p.vol]), showSymbol: false, lineStyle: { color: '#5aa7e6', width: 1.6 }, itemStyle: { color: '#5aa7e6' }, areaStyle: { color: 'rgba(90,167,230,.15)' } }] }));
  echarts.connect([c1, c2]);
}
function drawSeason(it, pts) {
  const rs = resample(pts); const se = seasonality(rs); const span = spanOf(rs);
  const hEl = $('#cHour'), mEl = $('#cHeat');
  if (!se.ok || span < D) {
    hEl.innerHTML = ph('Мало данных', `Профиль по часам появится после суток истории (надёжным — после 7 дней). Сейчас ${dur(span)}.`);
    mEl.innerHTML = ph('Мало данных', `Тепловая карта начнёт заполняться через сутки; осмысленной станет через 1–2 недели. Сейчас ${dur(span)}.`);
    return;
  }
  const note = span < 7 * D ? `<div class="muted" style="font-size:12px;margin-bottom:6px">⚠️ Истории ${dur(span)} — профиль предварительный, нужно ≥ 7 дней.</div>` : '';
  const hours = [...new Set(se.devs.map(d => d.h))].sort((a, b) => a - b);
  const byH = hours.map(h => { const v = se.devs.filter(d => d.h === h); return { h, m: mean(v.map(d => d.dev)), n: v.length, p: mean(v.map(d => d.v)) }; });
  hEl.innerHTML = note + '<div class="chart md"></div>';
  mkChart($('.chart', hEl), baseOpt({ legend: { show: false }, grid: { left: 8, right: 14, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(16,19,24,.96)', borderColor: '#3a3220', textStyle: { color: '#e7e3d8', fontSize: 12 }, formatter: ps => { const b = byH[ps[0].dataIndex]; return `<b>${pad(b.h)}:00–${pad(b.h)}:59 МСК</b><br>Отклонение: <b>${pctTxt(b.m, 2)}</b><br>Средняя мин. цена: ${money(b.p)}<br>Замеров: ${b.n}`; } },
    xAxis: { type: 'category', data: byH.map(b => pad(b.h) + ':44'), ...AX, splitLine: { show: false } }, yAxis: valAxis('', v => nf(1).format(v) + '%'),
    series: [{ type: 'bar', barMaxWidth: 34, data: byH.map(b => ({ value: +b.m.toFixed(3), itemStyle: { color: b.m < 0 ? UP : DOWN, borderRadius: b.m < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] } })) }] }));
  const cells = []; const vals = [];
  for (let w = 0; w < 7; w++) hours.forEach((h, hi) => { const v = se.devs.filter(d => d.h === h && d.wd === w); if (v.length) { const m = mean(v.map(d => d.dev)); vals.push(Math.abs(m)); cells.push([hi, w, +m.toFixed(3), v.length, mean(v.map(d => d.v))]); } });
  const mx = Math.max(.5, ...vals);
  mEl.innerHTML = (span < 14 * D ? `<div class="muted" style="font-size:12px;margin-bottom:6px">⚠️ Истории ${dur(span)} — для надёжной карты нужно 2+ недели, пустые клетки — ещё нет замеров.</div>` : '') + '<div class="chart md"></div>';
  mkChart($('.chart', mEl), baseOpt({ legend: { show: false }, grid: { left: 8, right: 14, top: 10, bottom: 50, containLabel: true },
    tooltip: { trigger: 'item', backgroundColor: 'rgba(16,19,24,.96)', borderColor: '#3a3220', textStyle: { color: '#e7e3d8', fontSize: 12 }, formatter: p => `<b>${WD[p.value[1]]}, ${pad(hours[p.value[0]])}:44 МСК</b><br>Отклонение: <b>${pctTxt(p.value[2], 2)}</b><br>Средняя мин. цена: ${money(p.value[4])}<br>Замеров: ${p.value[3]}` },
    xAxis: { type: 'category', data: hours.map(h => pad(h) + ':44'), ...AX, splitArea: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', data: WD, inverse: true, ...AX, splitLine: { show: false } },
    visualMap: { min: -mx, max: mx, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 10, dimension: 2, textStyle: { color: '#8b909b' }, formatter: v => pctTxt(v), inRange: { color: ['#1f9d55', '#1c3a2a', '#262a31', '#4a2222', '#d9443d'] } },
    series: [{ type: 'heatmap', data: cells, label: { show: true, color: '#e7e3d8', fontSize: 10, formatter: p => pctTxt(p.value[2]) }, itemStyle: { borderColor: '#0b0d10', borderWidth: 2, borderRadius: 4 } }] }));
}
function drawCandles(it, pts) {
  const el = $('#cCandle'); const days = new Map();
  pts.forEach(p => { const k = fmtD(p.t); if (!days.has(k)) days.set(k, []); days.get(k).push(p); });
  const arr = [...days.entries()].filter(([, v]) => v.length >= 2);
  if (arr.length < 3) { el.innerHTML = ph('Мало данных', `Свечи появятся, когда будет ≥ 3 дней с замерами (сейчас ${arr.length}).`); return; }
  el.innerHTML = '<div class="chart md"></div>';
  const ohlc = arr.map(([k, v]) => { const m = v.map(p => conv(p.min, p.cpd)); return [k.slice(0, 5), m[0], m[m.length - 1], Math.min(...m), Math.max(...m)]; });
  mkChart($('.chart', el), baseOpt({ legend: { show: false }, grid: { left: 8, right: 14, top: 16, bottom: 46, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, backgroundColor: 'rgba(16,19,24,.96)', borderColor: '#3a3220', textStyle: { color: '#e7e3d8', fontSize: 12 }, formatter: ps => { const d = ohlc[ps[0].dataIndex]; const f2 = v => fnum(v, S.cur === 'div' ? null : 0) + ' ' + curLbl(); return `<b>${arr[ps[0].dataIndex][0]}</b><br>Откр.: ${f2(d[1])}<br>Закр.: ${f2(d[2])}<br>Мин.: ${f2(d[3])}<br>Макс.: ${f2(d[4])}<br>Изм.: ${pctTxt((d[2] / d[1] - 1) * 100)}`; } },
    xAxis: { type: 'category', data: ohlc.map(d => d[0]), ...AX, splitLine: { show: false } }, yAxis: valAxis(curLbl(), v => fnum(v, S.cur === 'div' ? null : 0)),
    dataZoom: zoom(6).map((z, i) => i ? { ...z, labelFormatter: null } : z),
    series: [{ type: 'candlestick', data: ohlc.map(d => [d[1], d[2], d[3], d[4]]), itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN } }] }));
}

function viewCompare(root) {
  if (!S.cmpSel) S.cmpSel = S.items.filter(i => i.a.last).map(i => i.name);
  const colorOf = n => PALETTE[S.items.findIndex(i => i.name === n) % PALETTE.length];
  const sel = S.items.filter(i => S.cmpSel.includes(i.name));
  const k = S.cmpMetric;
  const rows = sel.map(i => { const p = inRange(i.pts); if (p.length < 1) return { i, p }; const b = p[0][k], e = p[p.length - 1][k];
    let peak = -Infinity, dd = 0; p.forEach(x => { peak = Math.max(peak, x[k]); dd = Math.min(dd, (x[k] / peak - 1) * 100); });
    return { i, p, b, e, ch: (e / b - 1) * 100, dd, hi: Math.max(...p.map(x => x[k])), lo: Math.min(...p.map(x => x[k])) }; });
  root.innerHTML = `<div class="sect-title">Сравнение предметов <span class="hint muted" style="font-family:system-ui;font-size:13px;letter-spacing:0">изменение в % от начала выбранного периода</span></div>
  <div class="toolbar">${rangeBar()}<span style="flex:1"></span><select class="sel" id="cm"><option value="min">Мин. цена</option><option value="avg">Средняя топ-10</option><option value="med">Медиана</option><option value="vol">Число лотов</option></select></div>
  <div class="pills" style="margin-bottom:12px">${S.items.map(i => `<button class="pill ${S.cmpSel.includes(i.name) ? 'on' : ''}" data-n="${esc(i.name)}"><span class="sw" style="background:${colorOf(i.name)}"></span>${esc(i.name)}</button>`).join('')}
   <button class="pill" data-all="1">все</button><button class="pill" data-none="1">никого</button></div>
  <div class="panel">${rows.some(r => r.p.length > 1) ? '<div class="chart" id="cCmp" style="height:420px"></div>' : ph('Мало данных', 'Нужно хотя бы 2 замера в выбранном периоде')}</div>
  <div class="panel" style="margin-top:14px"><div class="tbl-wrap"><table class="t"><thead><tr><th class="nos">Предмет</th><th class="nos">Начало</th><th class="nos">Конец</th><th class="nos">Изменение</th><th class="nos">Мин – макс</th><th class="nos">Макс. просадка</th><th class="nos">Замеров</th></tr></thead><tbody>
  ${rows.sort((a, b) => (b.ch ?? -1e9) - (a.ch ?? -1e9)).map(r => { const f = v => k === 'vol' ? fnum(v, 0) : money(v, r.p.length ? r.p[r.p.length - 1].cpd : null); return `<tr data-i="${esc(r.i.name)}"><td class="l"><span class="sw" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${colorOf(r.i.name)};margin-right:6px"></span><span class="iname">${esc(r.i.name)}</span></td>
   <td>${r.p.length ? f(r.b) : '—'}</td><td>${r.p.length ? f(r.e) : '—'}</td><td>${r.p.length > 1 ? chip(r.ch) : chip(null)}</td><td>${r.p.length ? f(r.lo) + ' – ' + f(r.hi) : '—'}</td><td class="${r.dd < -0.5 ? 'down' : ''}">${r.p.length > 1 ? pctTxt(r.dd) : '—'}</td><td>${r.p.length}</td></tr>`; }).join('')}
  </tbody></table></div></div>`;
  $('#cm', root).value = k; $('#cm', root).onchange = e => { S.cmpMetric = e.target.value; render(); };
  $$('.pill[data-n]', root).forEach(b => b.onclick = () => { const n = b.dataset.n; S.cmpSel = S.cmpSel.includes(n) ? S.cmpSel.filter(x => x !== n) : [...S.cmpSel, n]; render(); });
  $('[data-all]', root).onclick = () => { S.cmpSel = S.items.map(i => i.name); render(); };
  $('[data-none]', root).onclick = () => { S.cmpSel = []; render(); };
  $$('tr[data-i]', root).forEach(r => r.onclick = () => { location.hash = '#/item/' + encodeURIComponent(r.dataset.i); });
  bindRange(root, render);
  if ($('#cCmp')) {
    const series = rows.filter(r => r.p.length > 1).map(r => ({ name: r.i.name, type: 'line', showSymbol: r.p.length < 40, symbolSize: 4, lineStyle: { width: 2, color: colorOf(r.i.name) }, itemStyle: { color: colorOf(r.i.name) }, emphasis: { focus: 'series' },
      data: r.p.map(x => [tms(x.t), +((x[k] / r.b - 1) * 100).toFixed(3)]), markLine: undefined }));
    if (series.length) series[0].markLine = { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: '#5a5f69', type: 'dashed' }, label: { show: false } };
    mkChart($('#cCmp'), baseOpt({ xAxis: timeAxis(), yAxis: valAxis('%', v => pctTxt(v, 0)), dataZoom: zoom(), series,
      tooltip: { ...baseOpt().tooltip, formatter: ps => `<b>${tipTime(ps[0].value[0])}</b><br>` + ps.slice().sort((a, b) => b.value[1] - a.value[1]).map(p => `${p.marker}${esc(p.seriesName)}: <b>${pctTxt(p.value[1], 2)}</b>`).join('<br>') } }));
  }
}

function movers(period) {
  let sec = { '3h': 3 * H, '24h': D, '7d': 7 * D, '30d': 30 * D }[period];
  return S.items.filter(i => i.a.last).map(i => {
    if (period === 'range') { const p = inRange(i.pts); if (p.length < 2) return { i, ch: null }; return { i, ch: (p[p.length - 1].min / p[0].min - 1) * 100, vch: p[0].vol ? (p[p.length - 1].vol / p[0].vol - 1) * 100 : null }; }
    return { i, ch: change(i.pts, sec), vch: change(i.pts, sec, 'vol') };
  });
}
function moverList(list, max) {
  return list.map(m => { const w = Math.min(100, Math.abs(m.ch) / max * 100); return `<div class="mv" data-i="${esc(m.i.name)}"><div><div class="iname">${esc(m.i.name)} <span class="muted" style="font-weight:400;font-size:12px">${money(m.i.a.last.min, m.i.a.last.cpd)}${m.vch != null ? ` · лоты ${pctTxt(m.vch)}` : ''}</span></div><div class="b" style="width:${Math.max(2, w)}%;background:${m.ch >= 0 ? UP : DOWN}"></div></div><div class="p ${dirCls(m.ch, 0)}">${pctTxt(m.ch)}</div></div>`; }).join('');
}
function moversMini(period) {
  const ms = movers(period).filter(m => m.ch != null);
  if (!ms.length) return ph('Мало данных', `Для изменения за ${{ '3h': '3 ч', '24h': '24 ч', '7d': '7 дней', '30d': '30 дней', range: 'период' }[period]} нужна история такой длины.`);
  const max = Math.max(...ms.map(m => Math.abs(m.ch)), .1); ms.sort((a, b) => b.ch - a.ch);
  return moverList(ms, max);
}
function viewMovers(root) {
  const P = [['3h', '3ч'], ['24h', '24ч'], ['7d', '7д'], ['30d', '30д'], ['range', 'Выбранный период']];
  const ms = movers(S.mvPeriod).filter(m => m.ch != null); const max = Math.max(...ms.map(m => Math.abs(m.ch)), .1);
  const g = ms.filter(m => m.ch > 0).sort((a, b) => b.ch - a.ch), l = ms.filter(m => m.ch < 0).sort((a, b) => a.ch - b.ch), z = ms.filter(m => m.ch === 0);
  root.innerHTML = `<div class="sect-title">Лидеры роста и падения</div>
  <div class="toolbar"><div class="seg" id="mvp">${P.map(([k, lb]) => `<button data-p="${k}" class="${S.mvPeriod === k ? 'on' : ''}">${lb}</button>`).join('')}</div>${S.mvPeriod === 'range' ? rangeBar() : ''}</div>
  ${!ms.length ? ph('Мало данных', 'За этот период ещё нет сравнимых замеров — выбери период короче или подожди накопления истории.') : `
  <div class="grid g2"><div class="panel"><h3 class="up">▲ Растут <span class="hint">${g.length}</span></h3>${g.length ? moverList(g, max) : ph('Никто не растёт', '')}</div>
  <div class="panel"><h3 class="down">▼ Падают <span class="hint">${l.length}</span></h3>${l.length ? moverList(l, max) : ph('Никто не падает', '')}</div></div>
  ${z.length ? `<div class="panel" style="margin-top:14px"><h3>Без изменений <span class="hint">${z.length}</span></h3>${moverList(z, max)}</div>` : ''}`}
  <div class="muted" style="font-size:12px;margin-top:10px">Изменение мин. цены (в div) относительно замера ближайшего к началу периода; «лоты» — изменение числа лотов на рынке.</div>`;
  $$('#mvp button', root).forEach(b => b.onclick = () => { S.mvPeriod = b.dataset.p; render(); });
  $$('[data-i]', root).forEach(r => r.onclick = () => { location.hash = '#/item/' + encodeURIComponent(r.dataset.i); });
  if (S.mvPeriod === 'range') bindRange(root, render);
}

/* ---------- рубли (RMT): FunPay / G2G, только онлайн-продавцы ---------- */
const SITE_NAME = { funpay: 'FunPay', g2g: 'G2G' };
const RITEM = { divine: 'Divine Orb', mirror: 'Mirror of Kalandra' };
const rmt = () => S.data && S.data.rmt;
function bestDivRub() {   // самый дешёвый онлайн-divine (мин. из топ-10 онлайн) среди площадок
  const r = rmt(); if (!r || !r.now) return null; let best = null;
  for (const s of ['funpay', 'g2g']) { const e = r.now[s + '/divine']; if (e && e.min != null && (!best || e.min < best.v)) best = { v: e.min, site: s }; }
  return best;
}
function rub(v, dec) { if (v == null || !isFinite(v)) return '—'; if (dec == null) dec = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : 3; return nf(dec).format(v) + ' ₽'; }
const RUB_TITLE = 'Мин. цена × самый дешёвый Divine Orb у онлайн-продавцов (FunPay/G2G, мин. из 10 самых дешёвых онлайн-лотов) — сколько стоило бы купить столько divine за рубли';

/* ---------- каталог и запросы на добавление/удаление (GitHub issues) ---------- */
const repoName = () => (S.data && S.data.repo) || 'Nmy845/poe-prices';
function issueUrl(op, name, type) {
  const title = `${op}: ${name} | ${type}`;
  const body = op === 'add'
    ? `Запрос с сайта трекера: **добавить** «${name}» (${type}) в отслеживание.\n\nНичего менять не нужно — просто нажмите «Submit new issue». Сервер проверяет запросы каждые 5 минут: добавит предмет, сделает первый замер, обновит сайт, ответит комментарием и закроет issue.`
    : `Запрос с сайта трекера: **убрать** «${name}» (${type}) из отслеживания.\n\nПросто нажмите «Submit new issue» — сервер обработает запрос в течение ~5 минут. История замеров сохранится.`;
  return `https://github.com/${repoName()}/issues/new?` + new URLSearchParams({ title, labels: 'track-request', body }).toString();
}
function loadCatalog() {
  if (S.cat || S.catLoading) return S.catLoading;
  S.catLoading = fetch('data/catalog.json?t=' + Math.floor(Date.now() / 3.6e6), { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(c => { c.items.forEach(x => { x._s = (x.n + ' ' + x.t + ' ' + (x.c || '')).toLowerCase(); x._n = x.n.toLowerCase(); }); S.cat = c; renderPicker(); })
    .catch(e => { S.catErr = e.message; renderPicker(); });
  return S.catLoading;
}
const tracked = (n, t) => S.items.find(i => (i.iname || i.name).toLowerCase() === n.toLowerCase() && (i.type || '').toLowerCase() === t.toLowerCase());
function pickerMatches(q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean); if (!toks.length || !S.cat) return [];
  const res = [];
  for (const x of S.cat.items) {
    if (!toks.every(t => x._s.includes(t))) continue;
    const q0 = toks.join(' '), nw = x._n.split(/[\s'-]+/), ow = x._s.split(/[\s'-]+/);
    const sc = x._n.startsWith(q0) ? 0 : toks.every(t => nw.some(w => w.startsWith(t))) ? 1 : toks.every(t => ow.some(w => w.startsWith(t))) ? 2 : x._n.includes(q0) ? 3 : 4;
    res.push([sc, -(x.l || 0), x]);
  }
  res.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return res.slice(0, 40).map(r => r[2]);
}
function catPrice(x) {
  if (x.p == null) return '<span class="muted">нет цены ninja</span>';
  const bd = bestDivRub();
  return `<b>${money(x.p)}</b>${bd ? ` <span class="muted">≈ ${rub(x.p * bd.v)}</span>` : ''}`;
}
const iconImg = (x, cls) => x.i ? `<img class="${cls}" src="${esc(x.i)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="${cls} noimg">◆</span>`;
function pickerHtml() {
  const n = S.cat ? S.cat.n : (S.data.catalog && S.data.catalog.n);
  return `<div class="panel picker" id="picker" style="margin-top:14px">
    <h2>➕ Добавить предмет в отслеживание <span class="hint">${n ? n + ' уникальных предметов PoE 2' : 'каталог уникальных предметов PoE 2'} · иконки, базы и цены — poe.ninja (${esc(S.data.league)}) + trade2</span></h2>
    <div class="pk-row">
      <div class="pk-box"><input class="search pk-in" id="pkIn" placeholder="🔍 Название или базовый тип (по-английски), напр. «ventor», «heavy belt»…" autocomplete="off" spellcheck="false" value="${esc(S.pk.q)}">
        <div class="pk-list" id="pkList" hidden></div></div>
      <div class="pk-sel" id="pkSel"></div>
      <button class="btn pk-add" id="pkAdd" disabled>＋ Добавить в отслеживание</button>
    </div>
    <div class="pk-help">ℹ️ Сайт статический, поэтому кнопка открывает GitHub с <b>уже заполненным запросом</b> (issue в <a href="https://github.com/${esc(repoName())}/issues?q=label%3Atrack-request" target="_blank" rel="noopener">${esc(repoName())}</a>).
      Там <b>ничего менять не нужно — просто нажмите зелёную кнопку «Submit new issue»</b> (вы должны быть залогинены в GitHub как владелец репозитория).
      Сервер проверяет запросы каждые 5 минут: сверяет предмет с каталогом, делает первый замер цены на трейде и обновляет сайт — ответ придёт комментарием в issue, а предмет появится в таблице примерно через 5–10 минут.
      Убрать предмет — кнопка <b>✕</b> в строке таблицы (тоже через issue).</div>
    <div id="pkQueue" class="pk-queue"></div></div>`;
}
function renderPicker() {
  const box = $('#picker'); if (!box) return;
  const inp = $('#pkIn', box), list = $('#pkList', box), sel = $('#pkSel', box), add = $('#pkAdd', box);
  const x = S.pk.sel;
  if (x) {
    const tr = tracked(x.n, x.t);
    sel.innerHTML = `${iconImg(x, 'pk-ic lg')}<div><div class="iname">${esc(x.n)}</div><div class="itype">${esc(x.t)} · ${esc(x.c || '')}</div><div class="pk-pr">${catPrice(x)}${x.l ? ` <span class="muted">· ${fnum(x.l, 0)} лотов на ninja</span>` : ''}</div>${tr ? '<div class="pk-tr">✓ уже в отслеживании</div>' : ''}</div>`;
    add.disabled = !!tr; add.title = tr ? 'Уже отслеживается' : `Откроет GitHub: «add: ${x.n} | ${x.t}»`;
  } else { sel.innerHTML = `<span class="muted">${S.catErr ? 'каталог не загрузился: ' + esc(S.catErr) : S.cat ? 'выберите предмет из списка' : 'загрузка каталога…'}</span>`; add.disabled = true; }
  const showList = () => {
    const m = pickerMatches(inp.value); S.pk.hits = m; S.pk.hi = Math.min(S.pk.hi || 0, Math.max(0, m.length - 1));
    if (!inp.value.trim() || document.activeElement !== inp) { list.hidden = true; return; }
    list.hidden = false;
    list.innerHTML = m.length ? m.map((y, k) => { const tr = tracked(y.n, y.t); return `<div class="pk-opt ${k === S.pk.hi ? 'hi' : ''}" data-k="${k}">${iconImg(y, 'pk-ic')}<div class="pk-t"><div class="iname">${esc(y.n)}${tr ? ' <span class="pk-tag">в трекинге</span>' : ''}</div><div class="itype">${esc(y.t)} · ${esc(y.c || '')}</div></div><div class="pk-p">${catPrice(y)}</div></div>`; }).join('')
      : `<div class="pk-none">${S.cat ? 'ничего не найдено' : 'загрузка каталога…'}</div>`;
    $$('.pk-opt', list).forEach(o => o.onmousedown = e => { e.preventDefault(); choose(m[+o.dataset.k]); });
    const h = $('.pk-opt.hi', list); if (h) h.scrollIntoView({ block: 'nearest' });
  };
  const choose = y => { if (!y) return; S.pk.sel = y; S.pk.q = y.n; inp.value = y.n; list.hidden = true; renderPicker(); };
  inp.oninput = () => { S.pk.q = inp.value; S.pk.hi = 0; showList(); };
  inp.onfocus = showList; inp.onblur = () => setTimeout(() => { list.hidden = true; }, 120);
  inp.onkeydown = e => {
    const m = S.pk.hits || [];
    if (e.key === 'ArrowDown') { S.pk.hi = Math.min(m.length - 1, (S.pk.hi || 0) + 1); showList(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { S.pk.hi = Math.max(0, (S.pk.hi || 0) - 1); showList(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (!list.hidden && m.length) choose(m[S.pk.hi || 0]); else if (!add.disabled) add.click(); e.preventDefault(); }
    else if (e.key === 'Escape') { list.hidden = true; }
  };
  add.onclick = () => { const y = S.pk.sel; if (!y || tracked(y.n, y.t)) return; window.open(issueUrl('add', y.n, y.t), '_blank', 'noopener'); };
  renderQueue();
}
function renderQueue(force) {
  const el = $('#pkQueue'); if (!el) return;
  const draw = () => { const q = S.queue || []; el.innerHTML = q.length ? `<b>В очереди на обработку:</b> ${q.map(i => `<a href="${esc(i.html_url)}" target="_blank" rel="noopener">#${i.number} ${esc(i.title)}</a> <span class="muted">(${ago(Date.parse(i.created_at) / 1000)})</span>`).join(' · ')}` : ''; };
  draw();
  if (!force && S.queueT && Date.now() - S.queueT < 60000) return;
  S.queueT = Date.now();
  fetch(`https://api.github.com/repos/${repoName()}/issues?labels=track-request&state=open&per_page=20`, { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => r.ok ? r.json() : []).then(a => { S.queue = Array.isArray(a) ? a.filter(i => !i.pull_request) : []; draw(); }).catch(() => {});
}
function bindRemove(root) {
  $$('[data-rm]', root).forEach(b => b.onclick = e => {
    e.stopPropagation(); const it = S.items.find(i => i.name === b.dataset.rm); if (!it) return;
    const nm = it.iname || it.name;
    if (confirm(`Убрать «${it.name}» из отслеживания?\n\nОткроется GitHub с готовым запросом — нажмите «Submit new issue». История сохранится.`)) window.open(issueUrl('remove', nm, it.type || ''), '_blank', 'noopener');
  });
}
const rmBtn = it => `<button class="btn ghost sm rm" data-rm="${esc(it.name)}" title="Убрать из отслеживания (откроет GitHub-запрос)">✕</button>`;

/* ---------- вкладка «Курс к рублю» ---------- */
function feeVal(site, key) { const f = rmt() && rmt().fees && rmt().fees[site] && rmt().fees[site][key]; return f ? f.value : null; }
function calcDefaults() {
  const r = rmt() || {};
  return { n: Math.max(1000, Math.round((r.mirror_div || 5000) * 2 / 1000) * 1000), basis: 'min', wd: true,
    fp_fee: feeVal('funpay', 'section_fee_pct') ?? 9, fp_wp: feeVal('funpay', 'withdraw_pct') ?? 3, fp_wf: feeVal('funpay', 'withdraw_fixed_rub') ?? 30,
    g_fee: feeVal('g2g', 'seller_commission_pct') ?? 9.99, g_wp: feeVal('g2g', 'withdraw_pct') ?? 4.99, g_wf: feeVal('g2g', 'withdraw_fixed_usd') ?? 0.99, g_loss: feeVal('g2g', 'usdt_rub_loss_pct') ?? 2 };
}
function routes(c) {
  const r = rmt(); if (!r || !r.now) return [];
  const md = r.mirror_div, fx = r.usd_rub, pf = (r.pay && r.pay.min_factor) || 1;
  const out = [];
  for (const [site, item] of [['funpay', 'divine'], ['g2g', 'divine'], ['funpay', 'mirror'], ['g2g', 'mirror']]) {
    const e = r.now[site + '/' + item]; const p = e && (c.basis === 'median' ? e.median : e.min);
    const row = { site, item, key: site + '/' + item, p, e };
    if (p == null || (item === 'mirror' && !md)) { row.na = e && e.error ? e.error : 'нет онлайн-лотов'; out.push(row); continue; }
    const units = item === 'divine' ? c.n : c.n / md;
    const gross = units * p;   // столько платят покупатели по витрине
    let net, fee, wd = 0;
    if (site === 'funpay') {
      const seller = gross / pf / (1 + c.fp_fee / 100); fee = gross - seller; net = seller;
      if (c.wd) { wd = net * c.fp_wp / 100 + c.fp_wf; net -= wd; }
    } else {
      const seller = gross * (1 - c.g_fee / 100); fee = gross - seller; net = seller;
      if (c.wd) { wd = net * c.g_wp / 100 + c.g_wf * fx; net -= wd; const loss = net * c.g_loss / 100; wd += loss; net -= loss; }
    }
    Object.assign(row, { units, gross, fee, wd, net: Math.max(0, net), per: Math.max(0, net) / c.n });
    out.push(row);
  }
  const ok = out.filter(x => x.net != null); const best = ok.sort((a, b) => b.net - a.net)[0];
  if (best) out.forEach(x => { x.best = x === best; x.vsBest = x.net != null ? (x.net / best.net - 1) * 100 : null; });
  return out;
}
function viewRmt(root) {
  const r = rmt();
  if (!r || !r.now || !Object.keys(r.now).length) { root.innerHTML = `<div class="sect-title">Курс к рублю</div>` + ph('Данных пока нет', 'Цены FunPay/G2G собираются вместе с плановым сбором раз в 3 часа.'); return; }
  if (!S.calc) S.calc = calcDefaults();
  const c = S.calc, md = r.mirror_div;
  const card = (site, item) => {
    const e = r.now[site + '/' + item] || {};
    if (e.error || e.min == null) return `<div class="kpi rm-card"><div class="l">${RITEM[item]} · ${SITE_NAME[site]}</div><div class="v na">—</div><div class="s">${esc(e.error || 'нет онлайн-лотов')}</div></div>`;
    const perDiv = item === 'mirror' && md ? `<div class="s">= <b>${rub(e.min / md, 3)}</b> за 1 div-экв. (1 mirror ≈ ${fnum(md, 0)} div)</div>` : `<div class="s">1000 div = <b>${rub(e.min * 1000, 0)}</b> · медиана ${rub(e.median * 1000, 0)}</div>`;
    const srcUrl = site === 'g2g' ? (e.top && e.top[0] && e.top[0][3]) : e.src;
    return `<div class="kpi rm-card ${item}"><div class="l">${item === 'mirror' ? '🪞' : '✨'} ${RITEM[item]} · <b>${SITE_NAME[site]}</b></div>
      <div class="v">${rub(e.min)} <small class="muted">мин.</small></div>
      <div class="s">медиана топ-${e.n}: <b>${rub(e.median)}</b></div>${perDiv}
      <div class="s muted">онлайн-лотов: <b class="tx2">${e.online}</b> из ${e.total}${srcUrl ? ` · <a href="${esc(e.src || srcUrl)}" target="_blank" rel="noopener">площадка ↗</a>` : ''}</div></div>`;
  };
  const rs = routes(c);
  const fees = r.fees || {};
  const feeRow = (site, k) => { const f = (fees[site] || {})[k]; if (!f) return ''; const v = k === 'payment_markup' ? (r.pay ? `×${fnum(r.pay.min_factor, 4)} (${esc(r.pay.min_method)})` : '—') : (k.endsWith('_rub') ? f.value + ' ₽' : k.endsWith('_usd') ? '$' + f.value : f.value + '%');
    return `<tr><td class="l">${SITE_NAME[site]}</td><td class="l">${esc(f.label)}</td><td><b>${v}</b></td><td class="l">${f.verified ? '<span class="chip up">✓ проверено</span>' : '<span class="chip warnc">допущение</span>'}</td><td class="l wrap">${esc(f.note || '')}${f.source ? ` <a href="${esc(f.source)}" target="_blank" rel="noopener">источник ↗</a>` : ''}</td></tr>`; };
  const inp = (k, lbl, step, suf, unver) => `<label class="cf"><span>${lbl}${unver ? ' <i class="as" title="допущение — не подтверждено площадкой">допущ.</i>' : ''}</span><span class="cf-in"><input type="number" step="${step}" min="0" data-c="${k}" value="${c[k]}">${suf ? `<em>${suf}</em>` : ''}</span></label>`;
  const unv = (s, k) => { const f = (fees[s] || {})[k]; return f && !f.verified; };
  const rowsHtml = rs.map(x => x.net == null ? `<tr><td class="l">${x.item === 'mirror' ? '🪞 Mirror' : '✨ Divine'} → ${SITE_NAME[x.site]}</td><td colspan="6" class="muted" style="text-align:left">${esc(x.na)}</td></tr>`
    : `<tr class="${x.best ? 'best' : ''}"><td class="l">${x.best ? '🏆 ' : ''}${x.item === 'mirror' ? '🪞 Mirror' : '✨ Divine'} → <b>${SITE_NAME[x.site]}</b>${x.item === 'mirror' ? `<div class="itype">${fnum(x.units, 2)} mirror${x.units < 1 ? ' — меньше 1 зеркала!' : ` (целых: ${Math.floor(x.units)})`}</div>` : ''}</td>
      <td>${rub(x.p)}</td><td>${rub(x.gross, 0)}</td><td class="down">−${rub(x.fee, 0)}</td><td class="down">${c.wd ? '−' + rub(x.wd, 0) : '—'}</td><td><b>${rub(x.net, 0)}</b></td><td><b class="gold">${rub(x.per, 4)}</b>${x.best ? '' : ` <span class="muted">${pctTxt(x.vsBest)}</span>`}</td></tr>`).join('');
  const best = rs.find(x => x.best);
  root.innerHTML = `<div class="sect-title">Курс к рублю <span class="hint">${esc(r.league || S.data.league)} · только продавцы онлайн · мин. и медиана 10 самых дешёвых онлайн-лотов</span></div>
  <div class="disclaimer">Обновлено ${fmtDT(r.t)} МСК · USD/RUB по ЦБ: <b>${fnum(r.usd_rub, 2)}</b> · 1 Mirror of Kalandra = <b>${fnum(md, 0)} div</b> (poe.ninja PoE 2) · FunPay: цены в ₽ на витрине (с самым дешёвым способом оплаты), лига «0.5.5 Event League»; G2G: цены в $ → ₽ по ЦБ.${(r.errors || []).length ? `<br><span class="down">Ошибки последнего сбора: ${esc(r.errors.join('; '))}</span>` : ''}</div>
  <div class="kpis rm-cards" style="margin-top:14px">${card('funpay', 'divine')}${card('g2g', 'divine')}${card('funpay', 'mirror')}${card('g2g', 'mirror')}</div>
  <div class="grid g2">
    <div class="panel"><h2>Divine Orb, ₽ за 1 шт. <span class="hint">сплошная — мин., пунктир — медиана топ-10 онлайн</span></h2><div class="chart" id="rmDiv" style="height:280px"></div></div>
    <div class="panel"><h2>Mirror of Kalandra, ₽ за 1 шт. <span class="hint">сплошная — мин., пунктир — медиана</span></h2><div class="chart" id="rmMir" style="height:280px"></div></div>
  </div>
  <div class="panel" style="margin-top:14px" id="calc"><h2>💱 Что выгоднее продать <span class="hint">N divine — продать как divine или купить на них зеркала и продать зеркала · чистыми, после комиссий продавца</span></h2>
    <div class="calc-in">
      <label class="cf big"><span>Сколько divine продаём</span><span class="cf-in"><input type="number" step="100" min="1" data-c="n" value="${c.n}"><em>div</em></span></label>
      <label class="cf"><span>Цена продажи</span><select data-c="basis"><option value="min" ${c.basis === 'min' ? 'selected' : ''}>как самый дешёвый онлайн-лот</option><option value="median" ${c.basis === 'median' ? 'selected' : ''}>медиана топ-10 онлайн</option></select></label>
      <label class="cf"><span>Учитывать вывод денег</span><span class="cf-in"><input type="checkbox" data-c="wd" ${c.wd ? 'checked' : ''}></span></label>
      ${inp('fp_fee', 'FunPay: комиссия раздела', 0.5, '%', unv('funpay', 'section_fee_pct'))}${inp('fp_wp', 'FunPay: вывод на карту', 0.5, '%', unv('funpay', 'withdraw_pct'))}${inp('fp_wf', 'FunPay: вывод фикс.', 1, '₽', unv('funpay', 'withdraw_fixed_rub'))}
      <label class="cf"><span>G2G: ранг продавца</span><select data-c="g_fee">${Object.entries(((fees.g2g || {}).seller_commission_pct || {}).ranks || { Normal: 9.99 }).map(([k, v]) => `<option value="${v}" ${+c.g_fee === v ? 'selected' : ''}>${k} — ${v}%</option>`).join('')}</select></label>
      ${inp('g_wp', 'G2G: вывод USDT', 0.5, '%', unv('g2g', 'withdraw_pct'))}${inp('g_wf', 'G2G: вывод фикс.', 0.01, '$', unv('g2g', 'withdraw_fixed_usd'))}${inp('g_loss', 'USDT → ₽ потери', 0.5, '%', unv('g2g', 'usdt_rub_loss_pct'))}
      <button class="btn ghost sm" id="calcReset" title="Вернуть значения из конфига">сбросить</button>
    </div>
    <div class="tbl-wrap" style="margin-top:12px"><table class="t calc-t"><thead><tr><th class="nos">Маршрут</th><th class="nos">Цена витрины</th><th class="nos">Платит покупатель</th><th class="nos">Комиссия площадки</th><th class="nos">Вывод</th><th class="nos">Вам на руки</th><th class="nos">₽ за 1 div-экв.</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    ${best ? `<div class="best-box">🏆 Выгоднее всего: <b>${best.item === 'mirror' ? 'купить зеркала и продать на' : 'продать divine на'} ${SITE_NAME[best.site]}</b> — ≈ <b>${rub(best.net, 0)}</b> за ${fnum(c.n, 0)} div (${rub(best.per, 4)} за 1 div-экв.).${best.item === 'mirror' && best.units < 1 ? ' <span class="down">Но этого не хватает даже на одно зеркало.</span>' : ''}</div>` : ''}
    <div class="muted calc-note">FunPay: цена витрины включает наценку платёжной системы (берём самый дешёвый способ, ${r.pay ? `${esc(r.pay.min_method)} ×${fnum(r.pay.min_factor, 4)}` : '—'}) и комиссию раздела поверх цены продавца → продавцу = витрина ÷ множитель ÷ (1 + комиссия).
      G2G: цена витрины = цена продавца, комиссия удерживается с продавца; вывод в рубли на карту РФ G2G не поддерживает — считаем через USDT TRC-20 и продажу USDT за ₽.
      Маршрут «Mirror»: N div → N / ${fnum(md, 0)} зеркал (курс poe.ninja, без учёта комиссии внутриигровой биржи), зеркала продаются поштучно. Чтобы реально продать, придётся встать не дороже самого дешёвого онлайн-лота.</div>
  </div>
  <div class="panel" style="margin-top:14px"><h2>Комиссии продавца и источники <span class="hint">«допущение» — площадка не публикует цифру, значение можно поправить в калькуляторе · проверено ${esc((fees.checked_at) || '')}</span></h2>
    <div class="tbl-wrap"><table class="t fees-t"><thead><tr><th class="nos">Площадка</th><th class="nos">Комиссия</th><th class="nos">Значение</th><th class="nos">Статус</th><th class="nos">Пояснение / источник</th></tr></thead><tbody>
    ${feeRow('funpay', 'section_fee_pct')}${feeRow('funpay', 'payment_markup')}${feeRow('funpay', 'withdraw_pct')}${feeRow('funpay', 'withdraw_fixed_rub')}${feeRow('g2g', 'seller_commission_pct')}${feeRow('g2g', 'withdraw_pct')}${feeRow('g2g', 'withdraw_fixed_usd')}${feeRow('g2g', 'usdt_rub_loss_pct')}</tbody></table></div></div>
  <div class="panel" style="margin-top:14px"><h2>Самые дешёвые онлайн-лоты сейчас</h2><div class="grid g2">${['funpay/divine', 'g2g/divine', 'funpay/mirror', 'g2g/mirror'].map(k => { const e = r.now[k] || {}; const [s, it] = k.split('/');
      return `<div><h3>${RITEM[it]} · ${SITE_NAME[s]}</h3>${e.top && e.top.length ? `<table class="t"><tbody>${e.top.map((o, i) => `<tr><td class="l">${i + 1}. ${o[3] ? `<a href="${esc(o[3])}" target="_blank" rel="noopener">${esc(o[1])}</a>` : esc(o[1])}</td><td>${rub(o[0], it === 'mirror' ? 0 : 3)}</td><td class="muted">${fnum(o[2], 0)} шт.</td></tr>`).join('')}</tbody></table>` : `<div class="muted">${esc(e.error || 'нет онлайн-лотов')}</div>`}</div>`; }).join('')}</div></div>`;
  $$('[data-c]', root).forEach(el => el.onchange = () => { const k = el.dataset.c; S.calc[k] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' && k === 'basis' ? el.value : +el.value; render(); });
  $('#calcReset', root).onclick = () => { S.calc = calcDefaults(); render(); };
  drawRmtCharts();
}
function drawRmtCharts() {
  const r = rmt(); const H2 = r.hist || {};
  const col = { funpay: '#e9c46a', g2g: '#5aa7e6' };
  const mk = (item, el) => {
    const series = [];
    for (const s of ['funpay', 'g2g']) {
      const h = H2[s + '/' + item] || [];
      series.push({ name: `${SITE_NAME[s]} мин.`, type: 'line', showSymbol: h.length < 30, symbolSize: 5, data: h.map(p => [tms(p[0]), p[1]]), lineStyle: { width: 2, color: col[s] }, itemStyle: { color: col[s] } });
      series.push({ name: `${SITE_NAME[s]} медиана`, type: 'line', showSymbol: false, data: h.map(p => [tms(p[0]), p[2]]), lineStyle: { width: 1.4, type: 'dashed', color: col[s] }, itemStyle: { color: col[s] } });
    }
    if (!series.some(s => s.data.length)) { $(el).innerHTML = ph('Нет истории', ''); return; }
    const o = baseOpt({ grid: { left: 8, right: 14, top: 34, bottom: 24, containLabel: true }, xAxis: timeAxis(), yAxis: valAxis('₽', v => fnum(v, item === 'mirror' ? 0 : 2)), series });
    o.tooltip.valueFormatter = v => rub(v, item === 'mirror' ? 0 : 3);
    mkChart($(el), o);
  };
  mk('divine', '#rmDiv'); mk('mirror', '#rmMir');
}

/* ---------- роутер ---------- */
function route() { const h = location.hash.replace(/^#\/?/, '').split('/'); return { v: h[0] || 'overview', arg: h[1] ? decodeURIComponent(h.slice(1).join('/')) : null }; }
function render() {
  if (!S.data) return;
  const r = route(), root = $('#view'); const y = window.scrollY;
  disposeCharts();
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.v === r.v));
  $$('#curSeg button').forEach(b => b.classList.toggle('on', b.dataset.cur === S.cur));
  try {
    if (r.v === 'signals') viewSignals(root);
    else if (r.v === 'item') viewItem(root, r.arg || S.item);
    else if (r.v === 'compare') viewCompare(root);
    else if (r.v === 'movers') viewMovers(root);
    else if (r.v === 'rmt') viewRmt(root);
    else viewOverview(root);
  } catch (e) { console.error(e); root.innerHTML = ph('Ошибка отображения', esc(e.message)); }
  if (S._lastView === r.v + r.arg) window.scrollTo(0, y); else window.scrollTo(0, 0);
  S._lastView = r.v + r.arg;
  renderStatus();
}
function load(silent) {
  return fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(d => {
    if (silent && S.data && d.last_run === S.data.last_run) return;
    S.data = d; S.items = d.items.map((it, i) => { const x = prep(it); x.idx = i; x.a = analyze(x); return x; });
    $('#sub').textContent = `PoE 2 · ${d.league} · без коррапта · моментальный выкуп`;
    $('#demoBanner').hidden = !d.demo;
    render();
  }).catch(e => { if (!silent) $('#view').innerHTML = ph('Не удалось загрузить данные', esc(e.message) + ' — файл ' + DATA_URL); });
}
$$('#curSeg button').forEach(b => b.onclick = () => { S.cur = b.dataset.cur; LS('cur', S.cur); render(); });
window.addEventListener('hashchange', render);
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => S.charts.forEach(c => c.resize()), 120); });
setInterval(renderStatus, 30000);
setInterval(() => load(true), 10 * 60 * 1000);
load();
window.__S = S;
})();
