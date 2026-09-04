import { getStore } from "@netlify/blobs";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function genKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `GL-${part()}-${part()}`;
}

function isAdmin(req) {
  const secret = Netlify.env.get("ADMIN_SECRET");
  const provided = req.headers.get("x-admin-secret");
  return Boolean(secret) && provided === secret;
}

async function safeAction(req) {
  try {
    const clone = req.clone();
    const body = await clone.json();
    return body?.action || "";
  } catch {
    return "";
  }
}

export default async (req, _context) => {
  const store = getStore("gl-licenses");
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || (await safeAction(req));

  if (action === "verify" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const key = String(body.key || "").trim().toUpperCase();
    const deviceId = String(body.deviceId || "").trim();
    if (!key || !deviceId) return json({ ok: false, reason: "missing_fields" }, 400);

    const record = await store.get(key, { type: "json" });
    if (!record) return json({ ok: false, reason: "not_found" });
    if (record.status === "revoked") return json({ ok: false, reason: "revoked" });

    if (!record.activatedDevice) {
      record.activatedDevice = deviceId;
      record.activatedAt = new Date().toISOString();
      await store.setJSON(key, record);
      return json({ ok: true, name: record.name });
    }
    if (record.activatedDevice === deviceId) {
      return json({ ok: true, name: record.name });
    }
    return json({ ok: false, reason: "already_activated" });
  }

  if (!isAdmin(req)) return json({ ok: false, reason: "unauthorized" }, 401);

  if (action === "create" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const key = genKey();
    const record = {
      key,
      name: String(body.name || "").trim(),
      phone: String(body.phone || "").trim(),
      amount: Number(body.amount) || 0,
      notes: String(body.notes || "").trim(),
      status: "active",
      activatedDevice: null,
      activatedAt: null,
      date: new Date().toISOString(),
    };
    await store.setJSON(key, record);
    return json({ ok: true, record });
  }

  if (action === "list" && req.method === "GET") {
    const { blobs } = await store.list();
    const records = await Promise.all(
      blobs.map((b) => store.get(b.key, { type: "json" }))
    );
    records.sort((a, b) => (a && b ? +new Date(b.date) - +new Date(a.date) : 0));
    return json({ ok: true, records });
  }

  if (action === "revoke" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const key = String(body.key || "").trim().toUpperCase();
    const record = await store.get(key, { type: "json" });
    if (!record) return json({ ok: false, reason: "not_found" }, 404);
    record.status = record.status === "revoked" ? "active" : "revoked";
    await store.setJSON(key, record);
    return json({ ok: true, record });
  }

  if (action === "reset-device" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const key = String(body.key || "").trim().toUpperCase();
    const record = await store.get(key, { type: "json" });
    if (!record) return json({ ok: false, reason: "not_found" }, 404);
    record.activatedDevice = null;
    record.activatedAt = null;
    await store.setJSON(key, record);
    return json({ ok: true, record });
  }

  if (action === "delete" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const key = String(body.key || "").trim().toUpperCase();
    await store.delete(key);
    return json({ ok: true });
  }

  return json({ ok: false, reason: "unknown_action" }, 400);
};

export const config = {
  path: "/api/license",
};
