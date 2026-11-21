const API = "REPLACE_ME";
const $ = s => document.querySelector(s);
const set = (s, v) => { $(s).textContent = v; };
let t = null;

async function q() {
  const frm = $("#f").value, to = $("#t").value, amount = $("#a").value.trim();
  if (!amount || +amount <= 0 || frm === to) return set("#m", "أدخل مبلغاً صالحاً");
  set("#m", "…");
  try {
    const r = await fetch(API + "/quote", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ frm, to, amount, type: $("#type").value }) });
    const d = await r.json();
    if (d.e) return set("#m", d.e);
    if (d.errors && d.errors.length) return set("#m", d.errors.join(" · "));
    set("#m", "تستلم " + d.to.amount + " " + to + " — السعر " + d.to.rate);
    $("#go").disabled = false;
  } catch { set("#m", "تعذّر جلب السعر"); }
}
$("#a").addEventListener("input", () => { $("#go").disabled = true; clearTimeout(t); t = setTimeout(q, 500); });
["#f", "#t", "#type"].forEach(s => $(s).addEventListener("change", q));
$("#flip").onclick = () => { const v = $("#f").value; $("#f").value = $("#t").value; $("#t").value = v; q(); };

$("#go").onclick = async () => {
  const payout = $("#addr").value.trim(), refund = $("#refund").value.trim();
  if (!payout) return set("#m", "أدخل عنوان الاستلام");
  if (!refund) return set("#m", "أدخل عنوان الاسترداد — إجباري");
  $("#go").disabled = true;
  try {
    const r = await fetch(API + "/order", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ frm: $("#f").value, to: $("#t").value,
        amount: $("#a").value, type: $("#type").value, payout }) });
    const o = await r.json();
    if (o.e) { $("#go").disabled = false; return set("#m", o.e); }
    o.refund = refund;
    localStorage.setItem("last", JSON.stringify(o));
    show(o);
  } catch { $("#go").disabled = false; set("#m", "فشل إنشاء الطلب"); }
};
function show(o) {
  $("#swap").hidden = true; $("#view").hidden = false; $("#em").hidden = true;
  set("#dep", o.deposit);
  $("#qr").src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(o.deposit);
  set("#sum", "أرسل " + o.amount + " " + o.frm.toUpperCase() + " بالضبط، ثم تستلم " + o.to_amount);
  let left = o.left || 600;
  clearInterval(window.cd);
  window.cd = setInterval(() => {
    left--; set("#clock", Math.max(left, 0) + " ثانية");
    if (left <= 0) clearInterval(window.cd);
  }, 1000);
  poll(o);
}

async function poll(o) {
  try {
    const r = await fetch(API + "/status", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: o.id, token: o.token }) });
    const d = await r.json();
    set("#st", d.status || d.e || "?");
    if (d.status === "EMERGENCY") return $("#em").hidden = false;
    if (!["DONE", "EXPIRED"].includes(d.status)) setTimeout(() => poll(o), 15000);
  } catch { setTimeout(() => poll(o), 20000); }
}
$("#keep").onclick = async () => {
  const o = JSON.parse(localStorage.getItem("last"));
  await fetch(API + "/emergency", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: o.id, token: o.token, choice: "EXCHANGE" }) });
  $("#em").hidden = true; poll(o);
};

$("#back").onclick = async () => {
  const o = JSON.parse(localStorage.getItem("last"));
  await fetch(API + "/emergency", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: o.id, token: o.token, choice: "REFUND", address: o.refund }) });
  $("#em").hidden = true; poll(o);
};

$("#new").onclick = () => { $("#view").hidden = true; $("#swap").hidden = false; $("#a").value = ""; $("#m").textContent = "أدخل مبلغاً لعرض السعر"; $("#go").disabled = true; };

const last = localStorage.getItem("last");
if (last) { try { show(JSON.parse(last)); } catch (e) {} }
