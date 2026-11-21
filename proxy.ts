const KEY = Deno.env.get("FF_KEY")!;
const SECRET = Deno.env.get("FF_SECRET")!;
const REF = Deno.env.get("FF_REFCODE") ?? "";
const ORIGIN = Deno.env.get("ORIGIN") ?? "";
const enc = new TextEncoder();

const SEC: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "geolocation=(), microphone=(), camera=()",
  "cross-origin-resource-policy": "same-site",
};

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  const ok = ORIGIN.split(",").map(s => s.trim()).filter(Boolean);
  const allow = ok.length === 0 || ok.includes(o);
  return {
    allow,
    h: {
      "access-control-allow-origin": allow ? (o || "*") : "null",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-max-age": "86400",
      vary: "origin",
    },
  };
}

const J = (o: unknown, s: number, h: Record<string, string>) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { ...SEC, ...h, "content-type": "application/json", "cache-control": "no-store" },
  });

async function sign(b: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, enc.encode(b));
  return [...new Uint8Array(s)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function ff(method: string, data: unknown) {
  const body = JSON.stringify(data);
  const r = await fetch(`https://ff.io/api/v2/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8",
               "x-api-key": KEY, "x-api-sign": await sign(body) },
    body,
    signal: AbortSignal.timeout(9000),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(String(j.code));
  return j.data;
}

// ---- حدود ومعدلات ----
const hits = new Map<string, { n: number; t: number }>();
function limit(ip: string, key: string, max: number, win: number) {
  const k = ip + ":" + key, now = Date.now();
  const c = hits.get(k);
  if (!c || now - c.t > win) { hits.set(k, { n: 1, t: now }); return true; }
  c.n++; return c.n <= max;
}

const CURR = /^[A-Za-z0-9][A-Za-z0-9 -]{1,23}$/;
const AMT = /^\d{1,18}(\.\d{1,12})?$/;
const ID = /^[A-Za-z0-9_-]{3,64}$/;
const TOK = /^[A-Za-z0-9_-]{6,128}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{3,190}$/;
const ADDR = /^[A-Za-z0-9:_\-.]{8,160}$/;

const cache = new Map<string, { v: unknown; e: number }>();
const bad = (h: Record<string, string>, msg = "bad request") => J({ e: msg }, 400, h);

Deno.serve(async (req) => {
  const { allow, h } = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...SEC, ...h }, status: 204 });
  if (!allow) return J({ e: "origin" }, 403, h);
  if (req.method !== "POST") return J({ e: "method" }, 405, h);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "0";
  if (!limit(ip, "all", 45, 60_000)) return J({ e: "rate" }, 429, h);

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 4096) return J({ e: "size" }, 413, h);

  let b: any;
  try { b = await req.json(); } catch { return bad(h, "json"); }
  if (typeof b !== "object" || b === null || Array.isArray(b)) return bad(h, "json");

  try {
    if (path === "/quote") {
      if (!CURR.test(b.frm) || !CURR.test(b.to)) return bad(h, "ccy");
      if (!AMT.test(String(b.amount))) return bad(h, "amount");
      if (b.frm.toUpperCase() === b.to.toUpperCase()) return bad(h, "same");
      const type = b.type === "float" ? "float" : "fixed";
      const ck = `${b.frm}:${b.to}:${b.amount}:${type}`;
      const c = cache.get(ck);
      if (c && c.e > Date.now()) return J(c.v, 200, h);
      const d = await ff("price", { type, fromCcy: b.frm, toCcy: b.to,
        direction: "from", amount: b.amount, refcode: REF, afftax: type === "float" ? 0.2 : 0.4 });
      const out = { from: d.from, to: d.to, errors: d.errors };
      cache.set(ck, { v: out, e: Date.now() + 12000 });
      return J(out, 200, h);
    }

    if (path === "/order") {
      if (!limit(ip, "create", 8, 60_000)) return J({ e: "rate" }, 429, h);
      if (!CURR.test(b.frm) || !CURR.test(b.to)) return bad(h, "ccy");
      if (!AMT.test(String(b.amount))) return bad(h, "amount");
      if (!ADDR.test(String(b.payout))) return bad(h, "address");
      const type = b.type === "float" ? "float" : "fixed";
      const d = await ff("create", { type, fromCcy: b.frm, toCcy: b.to,
        direction: "from", amount: b.amount, toAddress: b.payout, refcode: REF,
        afftax: type === "float" ? 0.2 : 0.4 });
      return J({ id: d.id, token: d.token, deposit: d.from.address, tag: d.from.tag,
        amount: d.from.amount, to_amount: d.to.amount, conf: d.from.reqConfirmations,
        left: d.time.left }, 200, h);
    }

    if (path === "/status") {
      if (!ID.test(b.id) || !TOK.test(b.token)) return bad(h, "order");
      const d = await ff("order", { id: b.id, token: b.token });
      return J({ status: d.status, to_amount: d.to.amount }, 200, h);
    }

    if (path === "/emergency") {
      if (!ID.test(b.id) || !TOK.test(b.token)) return bad(h, "order");
      const choice = b.choice === "REFUND" ? "REFUND" : "EXCHANGE";
      if (choice === "REFUND" && !ADDR.test(String(b.address ?? ""))) return bad(h, "address");
      await ff("emergency", { id: b.id, token: b.token, choice,
        ...(choice === "REFUND" ? { address: b.address } : {}) });
      return J({ ok: 1 }, 200, h);
    }

    if (path === "/email") {
      if (!ID.test(b.id) || !TOK.test(b.token) || !EMAIL.test(String(b.email ?? ""))) return bad(h, "email");
      await ff("setEmail", { id: b.id, token: b.token, email: b.email });
      return J({ ok: 1 }, 200, h);
    }
    return J({ e: "404" }, 404, h);
  } catch (e) {
    return J({ e: String((e as Error).message).slice(0, 60) }, 502, h);
  }
});
