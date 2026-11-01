import { sb, checkEnv, checkPassword, readJson } from "./_lib.js";

// POST /api/health — appelé par un Raccourci iOS (app Raccourcis) pour envoyer les pas et le sommeil d'Apple Santé.
// Corps JSON : { "date": "2026-11-02", "steps": 11234, "sleep": 452 }
//   - date  : obligatoire, aaaa-MM-jj (date du jour sur le téléphone, pour éviter les décalages de fuseau)
//   - steps : nombre de pas du jour (facultatif)
//   - sleep : durée de sommeil de la nuit précédente, en heures, minutes ou secondes (détecté automatiquement)
//             ou sleepHours / sleepMinutes / sleepSeconds
// Les autres champs de la journée (poids, eau, séances…) ne sont jamais touchés.
// Protégé par le même code que l'app (en-tête x-app-password) si APP_PASSWORD est défini.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toNum = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function sleepHoursFrom(body) {
  const h = toNum(body.sleepHours), m = toNum(body.sleepMinutes), s = toNum(body.sleepSeconds), any = toNum(body.sleep);
  let hours = null;
  if (h != null) hours = h;
  else if (m != null) hours = m / 60;
  else if (s != null) hours = s / 3600;
  else if (any != null) hours = any <= 24 ? any : any <= 1440 ? any / 60 : any / 3600; // h, min ou s
  if (hours == null || hours <= 0 || hours > 24) return null;
  return Math.round(hours * 100) / 100;
}

export function normDate(v) {
  if (!v) return null;
  let s = String(v).trim();
  const fr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // 02/11/2026
  if (fr) s = `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return DATE_RE.test(s) ? s : null;
}

export default async function handler(req, res) {
  if (!checkEnv(res) || !checkPassword(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" && req.method !== "PUT") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    let body = readJson(req) || {};
    const date = normDate(body.date);
    if (!date) return res.status(400).json({ error: "Date manquante ou invalide (format aaaa-MM-jj)." });
    const steps = toNum(body.steps);
    const sleepHours = sleepHoursFrom(body);
    if (steps == null && sleepHours == null) return res.status(400).json({ error: "Rien à enregistrer : envoie steps et/ou sleep." });

    const rows = await sb(`days?date=eq.${date}&select=data`);
    const day = rows[0]?.data || { date, sessions: [] };
    if (steps != null && steps >= 0 && steps < 200000) day.steps = Math.round(steps);
    if (sleepHours != null) day.sleepHours = sleepHours;
    const now = new Date().toISOString();
    day.healthAt = now;
    day.updatedAt = now;
    await sb("days?on_conflict=date", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: [{ date, data: day, updated_at: now }],
    });
    return res.status(200).json({ ok: true, date, steps: day.steps ?? null, sleepHours: day.sleepHours ?? null });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur serveur." });
  }
}
