// Utilitaires partagés (les fichiers commençant par "_" ne deviennent pas des routes sur Vercel).
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function checkEnv(res) {
  if (!URL_ || !KEY) {
    res.status(500).json({ error: "Variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquantes sur Vercel." });
    return false;
  }
  return true;
}

import { timingSafeEqual } from "node:crypto";

// Code d'accès : si APP_PASSWORD est défini sur Vercel (ex. 6 chiffres), il est exigé partout.
export function passwordRequired() { return !!process.env.APP_PASSWORD; }
export function passwordOk(given) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true;
  const a = Buffer.from(String(given || "")), b = Buffer.from(pw);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function checkPassword(req, res) {
  if (!passwordOk(req.headers["x-app-password"])) {
    res.status(401).json({ error: "Code requis." });
    return false;
  }
  return true;
}

// Appel à l'API REST de Supabase avec la clé serveur (jamais envoyée au navigateur).
export async function sb(path, { method = "GET", body, headers = {} } = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase ${r.status} : ${txt.slice(0, 300)}`);
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

export function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return null;
}
