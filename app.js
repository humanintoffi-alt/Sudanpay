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
    $("#out").value = d.to.amount;
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
    location.href = "order.html?id=" + o.id;
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
    body: JSON.stringify({ id: o.id, token: o.token, choice: "REFUND", address: o.refund || prompt("refund address") }) });
  $("#em").hidden = true; poll(o);
};

$("#new").onclick = () => { $("#view").hidden = true; $("#swap").hidden = false; $("#a").value = ""; $("#m").textContent = "أدخل مبلغاً لعرض السعر"; $("#go").disabled = true; };



const ICON = { BTC:["btc","₿"], USDTTRC:["usdt","₮"], ETH:["eth","Ξ"], XMR:["xmr","ɱ"], TRX:["trx","⟁"] };
function paint(sel, ic) {
  const v = $(sel).value, [c, g] = ICON[v] || ["btc", "?"];
  $(ic).className = "ico " + c; $(ic).textContent = g;
}
paint("#f", "#fi"); paint("#t", "#ti");
$("#f").addEventListener("change", () => paint("#f", "#fi"));
$("#t").addEventListener("change", () => paint("#t", "#ti"));
document.querySelectorAll(".seg button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".seg button").forEach(x => x.classList.remove("on"));
  b.classList.add("on"); $("#type").value = b.dataset.v; q();
});
addEventListener("pointermove", e => {
  const x = (e.clientX / innerWidth - .5) * 2;
  document.querySelectorAll("[data-d]").forEach(n => n.style.transform = "translateX(" + (-x * 46 * +n.dataset.d) + "px)");
}, { passive: true });

const MAPX = { BTC:["btc","₿"], ETH:["eth","Ξ"], USDT:["usdt","₮"], USDC:["usdc","$"],
  XMR:["xmr","ɱ"], TRX:["trx","⟁"], SOL:["sol","◎"], LTC:["ltc","Ł"], DOGE:["doge","Ð"] };
$("#t").innerHTML = $("#f").innerHTML;
$("#t").value = "BTC";
for (const sel of ["#f", "#t"]) for (const o of $(sel).options) {
  const p = Object.keys(MAPX).find(k => o.value.startsWith(k));
  if (p) ICON[o.value] = MAPX[p];
}
paint("#f", "#fi"); paint("#t", "#ti");
$("#a").addEventListener("input", () => $("#out").value = "");

const NAMES = {BTC:"Bitcoin",ETH:"Ethereum",USDT:"Tether",USDC:"USD Coin",XMR:"Monero",
TRX:"Tron",BNB:"BNB",SOL:"Solana",LTC:"Litecoin",DOGE:"Dogecoin",BCH:"Bitcoin Cash",
DASH:"Dash",ZEC:"Zcash",XRP:"Ripple",ADA:"Cardano",XLM:"Stellar",SUI:"Sui",APT:"Aptos",
ATOM:"Cosmos",ETC:"Ethereum Classic",VET:"VeChain",XTZ:"Tezos",S:"Sonic",ARB:"Arbitrum",
POL:"Polygon",AVAX:"Avalanche",GRAM:"Gram",KCS:"KuCoin Token",DOT:"Polkadot",
WETH:"Wrapped ETH",WBNB:"Wrapped BNB",WSOL:"Wrapped SOL",TUSD:"TrueUSD",USDS:"USD Sky",
PAXG:"PAX Gold",XAUT:"Tether Gold",PEPE:"Pepe",LINK:"Chainlink",SHIB:"SHIB",
AAVE:"Aave",CAKE:"PancakeSwap",TWT:"Trust Wallet",BTT:"BitTorrent"};
const nm = v => { const k = Object.keys(NAMES).find(x => v.startsWith(x)); return k ? NAMES[k] : v; };
const bd = v => { for (const [k, l] of [["C-CHAIN","AVAX"],["OPTIMISM","OP"],["ARBITRUM","ARB"],
["POLYGON","POL"],["BASE","BASE"],["TRX","TRX"],["ETH","ETH"],["BSC","BSC"],["SOL","SOL"],
["TON","TON"],["LN","LN"]]) if (v.endsWith(k)) return l; return ""; };
const POP = ["BTC","BNBBSC","ETH","USDTETH","USDTTRX","XMR"];
let target = "#f";

const NETN = v => { for (const [k, l] of [["C-CHAIN","C-Chain"],["OPTIMISM","Optimism"],
["ARBITRUM","Arbitrum"],["POLYGON","Polygon"],["BASE","Base"],["TRX","TRC20"],["ETH","ERC20"],
["BSC","BEP20"],["SOL","Solana"],["TON","TON"],["LN","Lightning"]]) if (v.endsWith(k)) return l; return ""; };
const tick = v => { const s = v.replace(/(C-CHAIN|OPTIMISM|ARBITRUM|POLYGON|BASE|TRX|ETH|BSC|SOL|TON|LN)$/, ""); return s || v; };
function row(v) {
  const d = document.createElement("div"); d.className = "item";
  const [c, g] = ICON[v] || ["btc", "?"];
  const n = NETN(v), bg = bd(v);
  d.innerHTML = '<span class="ico ' + c + '">' + g + '</span><span class="nm">' + nm(v) +
    (n ? ' <small>(' + n + ')</small>' : '') + '</span><span class="rt"><b>' + tick(v) + '</b>' +
    (bg ? '<em class="bdg">' + bg + '</em>' : '') + '</span>';
  d.onclick = () => { $(target).value = v; $(target).dispatchEvent(new Event("change")); closeSheet(); };
  return d;
}
function buildList(f) {
  const L = $("#list"); L.innerHTML = ""; f = (f || "").trim().toLowerCase();
  if (!f) {
    const h = document.createElement("div"); h.className = "grp"; h.textContent = "شائعة"; L.append(h);
    POP.forEach(v => L.append(row(v)));
    const h2 = document.createElement("div"); h2.className = "grp"; h2.textContent = "كل العملات"; L.append(h2);
  }
  for (const g of $("#f").querySelectorAll("optgroup")) for (const o of g.children) {
    const v = o.value;
    if (f && !(v.toLowerCase().includes(f) || nm(v).toLowerCase().includes(f) || g.label.toLowerCase().includes(f))) continue;
    if (!f && POP.includes(v)) continue;
    L.append(row(v));
  }
}
function openSheet(t) { target = t; buildList(""); $("#q").value = ""; $("#sheet").classList.remove("hid"); setTimeout(() => $("#q").focus(), 60); }
function closeSheet() { $("#sheet").classList.add("hid"); }
$("#fp").onclick = () => openSheet("#f");
$("#tp").onclick = () => openSheet("#t");
$("#x").onclick = closeSheet;
$("#q").oninput = e => buildList(e.target.value);
$("#f").addEventListener("change", () => { $("#fn").textContent = $("#f").value; });
$("#t").addEventListener("change", () => { $("#tn").textContent = $("#t").value; });
$("#fn").textContent = $("#f").value; $("#tn").textContent = $("#t").value;

addEventListener("error", e => {
  const b = document.createElement("div");
  b.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:99;background:#C1121F;color:#fff;font:11px monospace;padding:8px;white-space:pre-wrap";
  b.textContent = "ERR: " + e.message + " @" + e.lineno;
  document.body.append(b);
});
document.addEventListener("click", ev => {
  const t = ev.target.closest("#fp,#tp,#x");
  if (!t) return;
  if (t.id === "x") return closeSheet();
  openSheet(t.id === "fp" ? "#f" : "#t");
});
