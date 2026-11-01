import { passwordRequired, passwordOk } from "./_lib.js";

// GET /api/auth (en-tête x-app-password facultatif)
// → { required: le code est-il activé ?, ok: le code envoyé est-il bon ? }
// Un mauvais code attend ~0,8 s avant de répondre pour freiner les essais en série.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Méthode non autorisée." }); }
  const required = passwordRequired();
  const given = req.headers["x-app-password"];
  if (!required) return res.status(200).json({ required: false, ok: true });
  if (!given) return res.status(200).json({ required: true, ok: false });
  const ok = passwordOk(given);
  if (!ok) await new Promise((r) => setTimeout(r, 800));
  return res.status(ok ? 200 : 401).json({ required: true, ok });
}
