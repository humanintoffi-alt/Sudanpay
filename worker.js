const SEC = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "geolocation=(), microphone=(), camera=()",
};

const CURR = /^[A-Za-z0-9][A-Za-z0-9 -]{1,23}$/;
const AMT = /^\d{1,18}(\.\d{1,12})?$/;
const ID = /^[A-Za-z0-9_-]{3,64}$/;
const TOK = /^[A-Za-z0-9_-]{6,128}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{3,190}$/;
const ADDR = /^[A-Za-z0-9:_\-.]{8,160}$/;
const hits = new Map();
const cache = new Map();

function limit(ip, key, max, win) {
  const k = ip + ":" + key, now = Date.now(), c = hits.get(k);
  if (!c || now - c.t > win) { hits.set(k, { n: 1, t: now }); return true; }
  c.n++; return c.n <= max;
}

async function sign(secret, body) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, enc.encode(body));
  return [...new Uint8Array(s)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function ff(env, method, data) {
  const body = JSON.stringify(data);
  const r = await fetch("https://ff.io/api/v2/" + method, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8",
      "x-api-key": env.FF_KEY, "x-api-sign": await sign(env.FF_SECRET, body) },
    body, signal: AbortSignal.timeout(9000),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(String(j.code));
  return j.data;
}

export default {
  async fetch(req, env) {
    const o = req.headers.get("origin") || "";
    const allow = (env.ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
    const ok = allow.length === 0 || allow.includes(o);
    const C = {
      "access-control-allow-origin": ok ? (o || "*") : "null",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-max-age": "86400", vary: "origin",
    };
    const J = (x, s) => new Response(JSON.stringify(x), { status: s,
      headers: { ...SEC, ...C, "content-type": "application/json", "cache-control": "no-store" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...SEC, ...C } });
    if (!ok) return J({ e: "origin" }, 403);
    if (req.method !== "POST") return J({ e: "method" }, 405);

    const ip = req.headers.get("cf-connecting-ip") || "0";
    if (!limit(ip, "all", 45, 60000)) return J({ e: "rate" }, 429);
    if (Number(req.headers.get("content-length") || 0) > 4096) return J({ e: "size" }, 413);

    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    let b;
    try { b = await req.json(); } catch { return J({ e: "json" }, 400); }
    if (!b || typeof b !== "object" || Array.isArray(b)) return J({ e: "json" }, 400);

    try {
      if (path === "/quote") {
        if (!CURR.test(b.frm) || !CURR.test(b.to)) return J({ e: "ccy" }, 400);
        if (!AMT.test(String(b.amount))) return J({ e: "amount" }, 400);
        if (b.frm.toUpperCase() === b.to.toUpperCase()) return J({ e: "same" }, 400);
        const type = b.type === "float" ? "float" : "fixed";
        const ck = `${b.frm}:${b.to}:${b.amount}:${type}`;
        const c = cache.get(ck);
        if (c && c.e > Date.now()) return J(c.v, 200);
        const d = await ff(env, "price", { type, fromCcy: b.frm, toCcy: b.to,
          direction: "from", amount: b.amount, refcode: env.FF_REFCODE || "",
          afftax: type === "float" ? 0.2 : 0.4 });
        const out = { from: d.from, to: d.to, errors: d.errors };
        cache.set(ck, { v: out, e: Date.now() + 12000 });
        return J(out, 200);
      }

      if (path === "/order") {
        if (!limit(ip, "create", 8, 60000)) return J({ e: "rate" }, 429);
        if (!CURR.test(b.frm) || !CURR.test(b.to)) return J({ e: "ccy" }, 400);
        if (!AMT.test(String(b.amount))) return J({ e: "amount" }, 400);
        if (!ADDR.test(String(b.payout))) return J({ e: "address" }, 400);
        const type = b.type === "float" ? "float" : "fixed";
        const d = await ff(env, "create", { type, fromCcy: b.frm, toCcy: b.to,
          direction: "from", amount: b.amount, toAddress: b.payout,
          refcode: env.FF_REFCODE || "", afftax: type === "float" ? 0.2 : 0.4 });
        return J({ id: d.id, token: d.token, deposit: d.from.address, tag: d.from.tag,
          amount: d.from.amount, to_amount: d.to.amount, conf: d.from.reqConfirmations,
          left: d.time.left }, 200);
      }

      if (path === "/status") {
        if (!ID.test(b.id) || !TOK.test(b.token)) return J({ e: "order" }, 400);
        const d = await ff(env, "order", { id: b.id, token: b.token });
        return J({ status: d.status, to_amount: d.to.amount }, 200);
      }

      if (path === "/emergency") {
        if (!ID.test(b.id) || !TOK.test(b.token)) return J({ e: "order" }, 400);
        const choice = b.choice === "REFUND" ? "REFUND" : "EXCHANGE";
        if (choice === "REFUND" && !ADDR.test(String(b.address || ""))) return J({ e: "address" }, 400);
        await ff(env, "emergency", { id: b.id, token: b.token, choice,
          ...(choice === "REFUND" ? { address: b.address } : {}) });
        return J({ ok: 1 }, 200);
      }

      if (path === "/email") {
        if (!ID.test(b.id) || !TOK.test(b.token) || !EMAIL.test(String(b.email || ""))) return J({ e: "email" }, 400);
        await ff(env, "setEmail", { id: b.id, token: b.token, email: b.email });
        return J({ ok: 1 }, 200);
      }

      return J({ e: "404" }, 404);
    } catch (e) {
      return J({ e: String(e.message || e).slice(0, 60) }, 502);
    }
  },
};
