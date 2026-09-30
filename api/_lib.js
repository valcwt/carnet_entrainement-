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

// Protection optionnelle : si APP_PASSWORD est défini sur Vercel, il est exigé.
export function checkPassword(req, res) {
  const pw = process.env.APP_PASSWORD;
  if (pw && req.headers["x-app-password"] !== pw) {
    res.status(401).json({ error: "Mot de passe requis." });
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
