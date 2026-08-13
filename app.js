/* Pure vanilla JS — GraphQL profile */
const SIGNIN = "https://learn.reboot01.com/api/auth/signin";
const GQL = "https://learn.reboot01.com/api/graphql-engine/v1/graphql";
const KEY = "reboot_jwt";
const SVGNS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);
const loginView = $("login-view");
const profileView = $("profile-view");

/* ---------------- auth ---------------- */
function getToken() { return localStorage.getItem(KEY); }
function setToken(t) { localStorage.setItem(KEY, t); }
function clearToken() { localStorage.removeItem(KEY); }

function parseJwt(token) {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch { return null; }
}

async function signin(identifier, password) {
  const res = await fetch(SIGNIN, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${identifier}:${password}`) },
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = "Invalid username/email or password.";
    try { const j = JSON.parse(body); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  const token = body.replace(/^"|"$/g, "").trim();
  if (!token || token.split(".").length !== 3) throw new Error("Unexpected response from the server.");
  return token;
}

async function gql(query, variables) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) { logout(); throw new Error("Session expired."); }
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

/* ---------------- queries ---------------- */
// normal query
const Q_USER = `{
  user { id login attrs
    auditRatio totalUp totalDown
  }
}`;

// query with arguments + nested query
const Q_DATA = `query Data($userId: Int!) {
  transaction(
    where: { userId: { _eq: $userId }, type: { _eq: "xp" }, eventId: { _is_null: false } }
    order_by: { createdAt: asc }
  ) { id amount createdAt path object { id name type } }

  progress(where: { userId: { _eq: $userId } }, order_by: { createdAt: desc }) {
    id grade createdAt path object { name type }
  }

  result(where: { userId: { _eq: $userId } }, order_by: { createdAt: desc }, limit: 15) {
    id grade createdAt path
    user { id login }
  }
}`;

/* ---------------- helpers ---------------- */
const fmtXP = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + " MB" : n >= 1e3 ? (n / 1e3).toFixed(1) + " kB" : n + " B";
const shortPath = (p) => (p || "").split("/").filter(Boolean).pop() || "—";
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

function el(name, attrs = {}, text) {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text !== undefined) n.textContent = text;
  return n;
}
function svgRoot(w, h) {
  const s = el("svg", { viewBox: `0 0 ${w} ${h}`, role: "img" });
  return s;
}

/* ---------------- charts ---------------- */
function lineChart(container, points) {
  container.innerHTML = "";
  const W = 620, H = 260, pad = { l: 52, r: 14, t: 14, b: 30 };
  const svg = svgRoot(W, H);
  if (!points.length) { container.append(svg); return; }

  const xs = points.map((p) => p.t), ys = points.map((p) => p.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys);
  const X = (t) => pad.l + ((t - x0) / ((x1 - x0) || 1)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - (v / (y1 || 1)) * (H - pad.t - pad.b);

  for (let i = 0; i <= 4; i++) {
    const v = (y1 / 4) * i, y = Y(v);
    svg.append(el("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: "gline" }));
    svg.append(el("text", { x: 6, y: y + 4, class: "glabel" }, fmtXP(Math.round(v))));
  }

  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const area = `${d} L${X(x1).toFixed(1)},${H - pad.b} L${X(x0).toFixed(1)},${H - pad.b} Z`;

  const grad = el("linearGradient", { id: "xpgrad", x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.append(el("stop", { offset: "0%", "stop-color": "#4ade80", "stop-opacity": ".45" }));
  grad.append(el("stop", { offset: "100%", "stop-color": "#4ade80", "stop-opacity": "0" }));
  const defs = el("defs"); defs.append(grad); svg.append(defs);

  svg.append(el("path", { d: area, fill: "url(#xpgrad)" }));
  const path = el("path", { d, fill: "none", stroke: "#4ade80", "stroke-width": 2.5, "stroke-linejoin": "round" });
  svg.append(path);

  points.filter((_, i) => i % Math.ceil(points.length / 40) === 0).forEach((p) => {
    const c = el("circle", { cx: X(p.t), cy: Y(p.v), r: 3, fill: "#0d1117", stroke: "#4ade80", "stroke-width": 2 });
    c.append(el("title", {}, `${fmtDate(p.t)} — ${fmtXP(p.v)} total (+${fmtXP(p.d)} ${p.name})`));
    svg.append(c);
  });

  svg.append(el("text", { x: pad.l, y: H - 8, class: "glabel" }, fmtDate(x0)));
  svg.append(el("text", { x: W - pad.r - 60, y: H - 8, class: "glabel" }, fmtDate(x1)));

  // animate the stroke
  const len = 2000;
  path.setAttribute("stroke-dasharray", len);
  path.setAttribute("stroke-dashoffset", len);
  const anim = el("animate", { attributeName: "stroke-dashoffset", from: len, to: 0, dur: "1.2s", fill: "freeze" });
  path.append(anim);

  container.append(svg);
}

function barChart(container, items) {
  container.innerHTML = "";
  const W = 620, rowH = 26, pad = { l: 150, r: 60, t: 8, b: 8 };
  const H = pad.t + pad.b + items.length * rowH || 60;
  const svg = svgRoot(W, H);
  const max = Math.max(...items.map((i) => i.value), 1);

  items.forEach((it, i) => {
    const y = pad.t + i * rowH;
    const w = ((W - pad.l - pad.r) * it.value) / max;
    svg.append(el("text", { x: pad.l - 10, y: y + 15, class: "glabel", "text-anchor": "end" }, it.label.slice(0, 22)));
    const r = el("rect", { x: pad.l, y: y + 4, width: 0, height: rowH - 10, rx: 5, class: "bar" });
    r.append(el("animate", { attributeName: "width", from: 0, to: w, dur: "0.8s", fill: "freeze" }));
    r.append(el("title", {}, `${it.label}: ${fmtXP(it.value)}`));
    svg.append(r);
    svg.append(el("text", { x: pad.l + w + 8, y: y + 15, class: "glabel" }, fmtXP(it.value)));
  });
  container.append(svg);
}

function donut(container, parts) {
  container.innerHTML = "";
  const W = 260, H = 220, cx = W / 2, cy = H / 2, R = 78, r = 50;
  const svg = svgRoot(W, H);
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) { svg.append(el("text", { x: cx, y: cy, class: "glabel", "text-anchor": "middle" }, "No data")); container.append(svg); return; }
  let a0 = -Math.PI / 2;
  parts.forEach((p) => {
    const a1 = a0 + (p.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x1, y1] = pt(a0, R), [x2, y2] = pt(a1, R), [x3, y3] = pt(a1, r), [x4, y4] = pt(a0, r);
    const d = `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large} 0 ${x4},${y4} Z`;
    const path = el("path", { d, fill: p.color, opacity: ".9" });
    path.append(el("title", {}, `${p.label}: ${p.display || p.value} (${Math.round((p.value / total) * 100)}%)`));
    svg.append(path);
    a0 = a1;
  });
  parts.forEach((p, i) => {
    svg.append(el("rect", { x: 14, y: H - 26 + i * 0, width: 0, height: 0 }));
  });
  svg.append(el("text", { x: cx, y: cy + 5, class: "glabel", "text-anchor": "middle", style: "font-size:16px;fill:#e6edf3" },
    `${Math.round((parts[0].value / total) * 100)}% ${parts[0].label}`));
  container.append(svg);
}

/* ---------------- render ---------------- */
async function loadProfile() {
  const claims = parseJwt(getToken());
  const userId = Number(claims?.["https://hasura.io/jwt/claims"]?.["x-hasura-user-id"] ?? claims?.sub);

  const { user } = await gql(Q_USER);
  const me = user[0];
  const data = await gql(Q_DATA, { userId: me?.id ?? userId });

  $("hello").textContent = `Welcome back, ${me.login}`;
  $("i-login").textContent = me.login;
  $("i-id").textContent = me.id;
  $("i-name").textContent = [me.attrs?.firstName, me.attrs?.lastName].filter(Boolean).join(" ") || "—";
  $("i-email").textContent = me.attrs?.email || "—";
  $("i-campus").textContent = me.attrs?.campus || "Reboot01";

  // XP
  const tx = data.transaction;
  const totalXP = tx.reduce((s, t) => s + t.amount, 0);
  $("i-xp").textContent = fmtXP(totalXP);
  $("i-xp-sub").textContent = `${tx.length} transactions`;

  let acc = 0;
  const points = tx.map((t) => {
    acc += t.amount;
    return { t: new Date(t.createdAt).getTime(), v: acc, d: t.amount, name: t.object?.name || shortPath(t.path) };
  });
  lineChart($("chart-xp"), points);

  const byProject = {};
  tx.forEach((t) => {
    const k = t.object?.name || shortPath(t.path);
    byProject[k] = (byProject[k] || 0) + t.amount;
  });
  const top = Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([label, value]) => ({ label, value }));
  barChart($("chart-projects"), top);

  // pass / fail
  const graded = data.progress.filter((p) => p.grade !== null);
  const pass = graded.filter((p) => p.grade >= 1).length;
  const fail = graded.length - pass;
  $("i-pass").textContent = pass;
  $("i-fail").textContent = fail;
  donut($("chart-ratio"), [
    { label: "PASS", value: pass, color: "#4ade80" },
    { label: "FAIL", value: fail, color: "#f87171" },
  ]);

  // audits
  const up = me.totalUp || 0, down = me.totalDown || 0;
  $("i-ratio").textContent = (me.auditRatio ?? (down ? up / down : 0)).toFixed(2);
  $("i-done").textContent = fmtXP(up);
  $("i-received").textContent = fmtXP(down);
  donut($("chart-audit"), [
    { label: "Done", value: up, color: "#38bdf8", display: fmtXP(up) },
    { label: "Received", value: down, color: "#a78bfa", display: fmtXP(down) },
  ]);

  // recent results (nested query)
  const list = $("recent");
  list.innerHTML = "";
  data.result.forEach((r) => {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = shortPath(r.path);
    const right = document.createElement("span");
    right.className = "tag " + (r.grade >= 1 ? "pass" : "fail");
    right.textContent = (r.grade >= 1 ? "PASS" : "FAIL") + " · " + fmtDate(r.createdAt);
    li.append(left, right);
    list.append(li);
  });
}

function showProfile() {
  loginView.hidden = true;
  profileView.hidden = false;
}
function showLogin() {
  profileView.hidden = true;
  loginView.hidden = false;
}
function logout() {
  clearToken();
  showLogin();
}

$("logout-btn").addEventListener("click", logout);

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("login-error");
  const btn = $("login-btn");
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const token = await signin($("identifier").value.trim(), $("password").value);
    setToken(token);
    showProfile();
    await loadProfile();
    $("login-form").reset();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    showLogin();
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

(async function init() {
  if (!getToken()) return showLogin();
  showProfile();
  try { await loadProfile(); }
  catch (e) {
    logout();
    $("login-error").textContent = e.message;
    $("login-error").hidden = false;
  }
})();
