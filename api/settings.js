import { sb, checkEnv, checkPassword, readJson } from "./_lib.js";

const MAX_BYTES = 500_000;

export default async function handler(req, res) {
  if (!checkEnv(res) || !checkPassword(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const rows = await sb("settings?id=eq.main&select=data");
      return res.status(200).json({ settings: rows[0]?.data ?? null });
    }
    if (req.method === "PUT") {
      const s = readJson(req);
      if (!s || typeof s !== "object" || Array.isArray(s)) return res.status(400).json({ error: "Réglages invalides." });
      if (JSON.stringify(s).length > MAX_BYTES) return res.status(413).json({ error: "Réglages trop volumineux." });
      await sb("settings?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: [{ id: "main", data: s, updated_at: new Date().toISOString() }],
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
