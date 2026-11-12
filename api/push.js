import webpush from "web-push";
import { sb, checkEnv, checkPassword, readJson } from "./_lib.js";

// Notifications push (iPhone : app ajoutée à l'écran d'accueil, iOS 16.4+).
// Tout est rangé dans la table settings, ligne id = "push" (accessible seulement par le serveur) :
//   { vapid:{publicKey, privateKey}, subs:[subscription…], tz, prefs:{weigh:{on,at},…}, sent:{"2026-11-02:weigh":1} }
// Les clés VAPID sont générées automatiquement au premier appel : rien à configurer sur Vercel.
//
// GET  /api/push            → { publicKey, subscribed, prefs, tz }
// POST /api/push            → { action:"subscribe", subscription, tz } | { action:"unsubscribe", endpoint }
//                             | { action:"prefs", prefs } | { action:"test" }
// GET  /api/push?run=1      → vérifie les rappels et envoie ceux qui sont dus (appelé toutes les 15 min par Supabase)

export const DEFAULT_PREFS = {
  weigh:   { on: true, at: "08:00" },
  session: { on: true, at: "09:00" },
  water:   { on: true, at: "16:00" },
  recap:   { on: true, at: "19:00" },
};
// Programme intégré (Big Seven) ; un programme perso actif (settings.programs / activeProgram) le remplace.
const BUILTIN = { id: "b7", start: "2026-11-02", plan: [{ dow: 0, k: "A" }, { dow: 2, k: "Q" }, { dow: 4, k: "B" }, { dow: 6, k: "E" }],
  sessions: { A: { short: "Renfo A", kind: "renfo" }, Q: { short: "Fractionné", kind: "run" }, B: { short: "Renfo B", kind: "renfo" }, E: { short: "Endurance", kind: "run" } } };
// séance prévue aujourd'hui : { label, kind, keys } ou null. dowJs : 0 = dimanche ; dans les programmes, 0 = lundi.
export function plannedToday(settings, date, dowJs) {
  const list = Array.isArray(settings?.programs) ? settings.programs : [];
  const prog = list.find((p) => p && p.id === settings?.activeProgram) || BUILTIN;
  if (prog.start && date < prog.start) return null;
  const dow = (dowJs + 6) % 7, item = (prog.plan || []).find((x) => Number(x.dow) === dow);
  const ses = item && prog.sessions?.[item.k];
  if (!ses) return null;
  // séance reportée à la semaine suivante : pas de rappel
  const mon = new Date(Date.parse(date + "T12:00:00Z") - dow * 864e5).toISOString().slice(0, 10);
  if ((Array.isArray(settings?.moved) ? settings.moved : []).some((x) => x && x.from === mon && x.k === item.k)) return null;
  return { label: ses.short || ses.label || "Séance", kind: ses.kind, keys: [item.k, "T" + item.k] };
}
const WINDOW_MIN = 180; // un rappel manqué n'est plus envoyé 3 h après son heure

async function loadState() {
  const rows = await sb("settings?id=eq.push&select=data");
  let st = rows[0]?.data || null;
  if (!st || !st.vapid) {
    const v = webpush.generateVAPIDKeys();
    st = { ...(st || {}), vapid: { publicKey: v.publicKey, privateKey: v.privateKey }, subs: [], prefs: DEFAULT_PREFS, sent: {} };
    await saveState(st);
  }
  st.prefs = mergePrefs(st.prefs);
  st.subs ||= []; st.sent ||= {};
  return st;
}
async function saveState(st) {
  await sb("settings?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: [{ id: "push", data: st, updated_at: new Date().toISOString() }],
  });
}
export function mergePrefs(p) {
  const out = {};
  for (const k of Object.keys(DEFAULT_PREFS)) {
    const x = (p && p[k]) || {};
    out[k] = { on: x.on ?? DEFAULT_PREFS[k].on, at: /^\d{2}:\d{2}$/.test(x.at || "") ? x.at : DEFAULT_PREFS[k].at };
  }
  return out;
}
// date (aaaa-MM-jj), minutes depuis minuit et jour de la semaine dans le fuseau du téléphone
export function localNow(tz, now = new Date()) {
  let parts;
  try { parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now); }
  catch { parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now); }
  const g = (t) => parts.find((p) => p.type === t)?.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { date: `${g("year")}-${g("month")}-${g("day")}`, min: Number(g("hour")) * 60 + Number(g("minute")), dow };
}
const fmt = (n, d = 0) => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

// Rappels dus maintenant (fonction pure, testée à part)
export const isPaused = (pauses, date) => (Array.isArray(pauses) ? pauses : []).some((p) => p && p.from <= date && (!p.to || date <= p.to));
export function dueReminders({ prefs, sent, now, day, goals, pauses, settings }) {
  const out = [];
  const water = Number(goals?.water) || 2.5;
  for (const [id, p] of Object.entries(prefs)) {
    if (!p.on) continue;
    const [h, m] = p.at.split(":").map(Number), at = h * 60 + m;
    const key = `${now.date}:${id}`;
    if (sent[key] || now.min < at || now.min > at + WINDOW_MIN) continue;
    let msg = null;
    if (id === "weigh" && day?.weight == null && !settings?.scaleOff && !day?.noScale) msg = { title: "⚖️ Pesée du matin", body: "Monte sur la balance avant le petit-déj, ça prend 10 secondes.", tag: "weigh" };
    if (id === "water") { const w = Number(day?.water) || 0; if (w < water * 0.6) msg = { title: "💧 Pense à boire", body: `${fmt(w, 1)} L pour l'instant : encore ${fmt(water - w, 1)} L pour ton objectif.`, tag: "water" }; }
    const pl = id === "session" ? plannedToday(settings || {}, now.date, now.dow) : null;
    if (id === "session" && pl && !isPaused(pauses, now.date)) { // programme en pause : pas de rappel de séance
      const done = (day?.sessions || []).some((s) => pl.keys.includes(s.b7) || pl.keys.includes(s.replaces?.k) || (pl.kind === "wod" && s.b7 === "W")); // une activité de remplacement compte
      if (!done) msg = { title: `💪 ${pl.label} aujourd'hui`, body: pl.kind === "run" ? "Ta sortie du jour t'attend. Note-la dans le carnet en rentrant." : pl.kind === "wod" ? "Ton WOD Attilius t'attend : 20 minutes, chrono prêt." : "Ta séance de renfo t'attend. Le minuteur de repos est prêt.", tag: "session" };
    }
    if (id === "recap" && now.dow === 0) msg = { title: "📊 Ton récap de la semaine", body: "Séances, km, poids, sommeil : tout est prêt, avec l'image pour ton coach.", tag: "recap", url: "/?tab=sem" };
    out.push({ id, key, msg }); // msg null = condition déjà remplie : on marque quand même pour ne pas revérifier
  }
  return out;
}

async function sendAll(st, payload) {
  webpush.setVapidDetails("mailto:carnet@example.com", st.vapid.publicKey, st.vapid.privateKey);
  let ok = 0; const keep = [];
  for (const sub of st.subs) {
    try { await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: "normal" }); ok++; keep.push(sub); }
    catch (e) { if (e.statusCode !== 404 && e.statusCode !== 410) keep.push(sub); else console.log("abonnement expiré retiré"); }
  }
  const changed = keep.length !== st.subs.length; st.subs = keep;
  return { ok, changed };
}

export default async function handler(req, res) {
  if (!checkEnv(res) || !checkPassword(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const st = await loadState();
    const url = new URL(req.url, "http://x");

    if (req.method === "GET" && url.searchParams.get("run")) {
      const now = localNow(st.tz);
      const [dayRows, setRows] = await Promise.all([sb(`days?date=eq.${now.date}&select=data`), sb("settings?id=eq.main&select=data")]);
      const due = dueReminders({ prefs: st.prefs, sent: st.sent, now, day: dayRows[0]?.data, goals: setRows[0]?.data?.goals, pauses: setRows[0]?.data?.pauses, settings: setRows[0]?.data });
      let sent = 0;
      for (const d of due) { if (d.msg && st.subs.length) sent += (await sendAll(st, d.msg)).ok; st.sent[d.key] = 1; }
      // on ne garde que l'historique des 7 derniers jours
      const keepFrom = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      for (const k of Object.keys(st.sent)) if (k.slice(0, 10) < keepFrom) delete st.sent[k];
      if (due.length) await saveState(st);
      return res.status(200).json({ ok: true, local: now, checked: due.map((d) => d.id), sent });
    }

    if (req.method === "GET") {
      return res.status(200).json({ publicKey: st.vapid.publicKey, subscribed: st.subs.length, prefs: st.prefs, tz: st.tz || null });
    }

    if (req.method === "POST") {
      const b = readJson(req) || {};
      if (b.action === "subscribe") {
        const s = b.subscription;
        if (!s || typeof s.endpoint !== "string" || !s.keys?.p256dh || !s.keys?.auth) return res.status(400).json({ error: "Abonnement invalide." });
        st.subs = st.subs.filter((x) => x.endpoint !== s.endpoint).concat([{ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }]).slice(-5);
        if (typeof b.tz === "string" && b.tz.length < 60) st.tz = b.tz;
        await saveState(st);
        return res.status(200).json({ ok: true, subscribed: st.subs.length });
      }
      if (b.action === "unsubscribe") {
        st.subs = st.subs.filter((x) => x.endpoint !== b.endpoint);
        await saveState(st);
        return res.status(200).json({ ok: true, subscribed: st.subs.length });
      }
      if (b.action === "prefs") {
        st.prefs = mergePrefs(b.prefs);
        if (typeof b.tz === "string" && b.tz.length < 60) st.tz = b.tz;
        await saveState(st);
        return res.status(200).json({ ok: true, prefs: st.prefs });
      }
      if (b.action === "test") {
        if (!st.subs.length) return res.status(400).json({ error: "Aucun appareil abonné." });
        const r = await sendAll(st, { title: "✅ Notifications activées", body: "Le carnet pourra te rappeler la pesée, l'eau et tes séances.", tag: "test" });
        if (r.changed) await saveState(st);
        return res.status(200).json({ ok: true, sent: r.ok });
      }
      return res.status(400).json({ error: "Action inconnue." });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur serveur." });
  }
}
