import { sb, checkEnv, checkPassword, readJson } from "./_lib.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAY_BYTES = 200_000; // une journée pèse quelques Ko
const MAX_BATCH = 500;

export default async function handler(req, res) {
  if (!checkEnv(res) || !checkPassword(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      // Supabase renvoie au plus 1000 lignes par requête : on pagine.
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const rows = await sb(`days?select=data&order=date.asc&limit=1000&offset=${offset}`);
        all.push(...rows.map((r) => r.data));
        if (rows.length < 1000) break;
      }
      return res.status(200).json({ days: all });
    }

    if (req.method === "PUT") {
      const body = readJson(req);
      const list = Array.isArray(body) ? body : [body];
      if (!list.length || list.length > MAX_BATCH) return res.status(400).json({ error: "Nombre de journées invalide." });
      for (const d of list) {
        if (!d || typeof d !== "object" || !DATE_RE.test(d.date || "")) return res.status(400).json({ error: "Journée invalide (date manquante)." });
        if (JSON.stringify(d).length > MAX_DAY_BYTES) return res.status(413).json({ error: `Journée ${d.date} trop volumineuse.` });
      }
      const now = new Date().toISOString();
      await sb("days?on_conflict=date", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: list.map((d) => ({ date: d.date, data: d, updated_at: now })),
      });
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Méthode non autorisée." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur serveur." });
  }
}
