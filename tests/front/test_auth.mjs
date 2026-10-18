import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require("jsdom"); const makeFake = require("./fake_supabase.cjs");
const html = fs.readFileSync(new URL("../../index.html", import.meta.url),"utf8");
const wait = ms => new Promise(r=>setTimeout(r,ms));
const F = makeFake();
// un FitMotivator abonné avec un code, déjà existant
const coach = F.newUser("coach@test.fr","motdepasse1"); coach.confirmed=true;
Object.assign(F.db.profiles[coach.id],{role:"fitmotivator",comp:true,display_name:"Coach Max",referral_code:"FIT-ABC234"});
function open(hash=""){
  let reloaded=false;
  const vc = new VirtualConsole(); vc.on("jsdomError", e=>{ if(/navigation|reload/i.test(e.message)) reloaded=true; else console.log("JSDOM", e.message); });
  const dom = new JSDOM(html,{url:"https://carnet.test/"+hash,runScripts:"dangerously",pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
    w.matchMedia=()=>({matches:false,addEventListener(){}}); w.confirm=()=>true; w.onerror=(m,s,l)=>console.log("ERR",m,l);
    w.supabase = { createClient:(url,key)=>{ if(!/ssevnpiluybnmvujcgjj/.test(url)||!/^sb_publishable_/.test(key)) throw new Error("mauvaise config"); return F.client; } };
    w.history.replaceState = ()=>{};
  }});
  return { dom, d:dom.window.document, w:dom.window, reloaded:()=>reloaded };
}
const vis = (d,id)=>!d.getElementById(id).hidden;
const msg = (d,id)=>d.getElementById(id).textContent;
const fill=(d,id,v)=>{ d.getElementById(id).value=v; };
const submit=(d,id)=>d.getElementById(id).dispatchEvent(new d.defaultView.Event("submit",{cancelable:true}));
let ok=0, ko=0; const check=(name,cond)=>{ console.log((cond?"✅":"❌")+" "+name); cond?ok++:ko++; };

// 1. Pas de session → écran de connexion
let A = open(); await wait(100);
check("sans session : écran de connexion affiché", vis(A.d,"auth") && vis(A.d,"authLoginView") && msg(A.d,"authSub").includes("Connecte-toi"));
// 2. Inscription
A.d.querySelector('[data-auth-tab="signup"]').click();
check("onglet inscription : champ prénom visible", vis(A.d,"nameWrap"));
fill(A.d,"authName","Valentin"); fill(A.d,"authEmail","val@test.fr"); fill(A.d,"authPassword","court"); submit(A.d,"authForm"); await wait(30);
check("mot de passe trop court refusé", msg(A.d,"authMsg").includes("8 caractères"));
fill(A.d,"authPassword","motdepasse1"); submit(A.d,"authForm"); await wait(50);
check("inscription → écran « vérifie ta boîte mail »", vis(A.d,"authCheckView") && msg(A.d,"checkEmail")==="val@test.fr");
// 3. Connexion avant confirmation
A.d.querySelector("[data-auth-back]").click();
fill(A.d,"authEmail","val@test.fr"); fill(A.d,"authPassword","motdepasse1"); submit(A.d,"authForm"); await wait(50);
check("connexion sans confirmation → message clair", msg(A.d,"authMsg").includes("Confirme d'abord"));
fill(A.d,"authPassword","mauvais"); submit(A.d,"authForm"); await wait(50);
check("mauvais mot de passe → message clair", msg(A.d,"authMsg")==="E-mail ou mot de passe incorrect.");
// 4. Confirmé mais sans accès → paywall
F.confirm("val@test.fr");
fill(A.d,"authPassword","motdepasse1"); submit(A.d,"authForm"); await wait(80);
check("connecté sans accès → écran « pas d'accès »", vis(A.d,"authPaywallView") && msg(A.d,"paywallEmail")==="val@test.fr");
const valId = Object.values(F.db.users).find(u=>u.email==="val@test.fr").id;
check("prénom de l'inscription enregistré via set_display_name", F.db.profiles[valId].display_name==="Valentin");
check("aucune donnée du carnet chargée sans accès", !F.log.some(l=>l[0]==="select"&&l[1]==="user_days"));
// 5. Code de parrainage
fill(A.d,"codeInput","FIT-ZZZZZZ"); submit(A.d,"codeForm"); await wait(50);
check("code invalide refusé", msg(A.d,"codeMsg")==="Code de parrainage invalide.");
fill(A.d,"codeInput"," fit-abc234 "); submit(A.d,"codeForm"); await wait(300);
check("code valide → accès, carnet ouvert", !vis(A.d,"auth") && vis(A.d,"account"));
check("ligne compte : prénom · e-mail", msg(A.d,"accountEmail")==="Valentin · val@test.fr");
await wait(300);
check("réglages créés dans user_settings pour ce compte", !!F.db.user_settings[valId]);
// 6. Saisie → user_days avec le bon user_id
const w=A.d.getElementById("weight"); w.value="104.2"; w.dispatchEvent(new A.w.Event("input",{bubbles:true})); await wait(1200);
const myDays = Object.values(F.db.user_days).filter(r=>r.user_id===valId);
check("saisie enregistrée dans user_days, au nom du bon compte", myDays.length===1 && myDays[0].data.weight===104.2);
check("upsert sur (user_id, date)", F.log.some(l=>l[0]==="upsert"&&l[1]==="user_days"&&l[3]==="user_id,date"));
check("cache local séparé par compte", Object.keys(Object.fromEntries(Object.entries(A.w.localStorage))).some(k=>k==="carnet-sport.days.v2:"+valId));
check("statut synchronisé", msg(A.d,"status").includes("Synchronisé"));
// 7. Le coach arrête → au prochain enregistrement, retour à l'écran d'accès
F.db.profiles[coach.id].comp=false;
w.value="104.0"; w.dispatchEvent(new A.w.Event("input",{bubbles:true})); await wait(1200);
check("accès perdu en cours de route → écran d'accès", vis(A.d,"authPaywallView"));
F.db.profiles[coach.id].comp=true;
// 8. Déconnexion
A.d.querySelector("[data-auth-logout]").click(); await wait(50);
check("déconnexion → signOut + rechargement", F.log.some(l=>l[0]==="signOut") && A.reloaded());

// 9. Réouverture avec une session déjà active → carnet direct, données retrouvées
F.setSession(F.db.users[valId]);
let B = open(); await wait(400);
check("session existante : carnet ouvert directement", !vis(B.d,"auth"));
check("données retrouvées depuis Supabase", JSON.stringify(Object.values(F.db.user_days).map(r=>r.data.weight)).includes("104.2"));

// 10. Mot de passe oublié
F.setSession(null);
let C = open(); await wait(100);
C.d.getElementById("forgotBtn").click(); fill(C.d,"forgotEmail","inconnu@test.fr"); submit(C.d,"forgotForm"); await wait(50);
check("mot de passe oublié : même message pour une adresse inconnue", msg(C.d,"forgotMsg").startsWith("Si un compte existe"));
check("lien de réinitialisation renvoie vers le site", F.log.some(l=>l[0]==="reset"&&l[2]==="https://carnet.test/"));
// 11. Retour par le lien de réinitialisation
F.setSession(F.db.users[valId]);
let R = open("#access_token=x&type=recovery"); await wait(150);
check("lien de réinitialisation → formulaire nouveau mot de passe", vis(R.d,"authResetView"));
fill(R.d,"resetPassword","nouveaumdp9"); submit(R.d,"resetForm"); await wait(400);
check("nouveau mot de passe enregistré et carnet ouvert", F.db.users[valId].password==="nouveaumdp9" && !vis(R.d,"auth"));
// 12. Lien expiré
F.setSession(null);
let X = open("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"); await wait(150);
check("lien expiré → message clair", msg(X.d,"authMsg").includes("expiré"));
// 13. Un autre compte sur le même appareil ne voit rien du premier
const other = F.newUser("autre@test.fr","motdepasse2"); other.confirmed=true; F.db.profiles[other.id].comp=true;
F.setSession(other);
let O = open(); await wait(400);
check("autre compte : 0 journée du premier", Object.values(F.db.user_days).filter(r=>r.user_id===other.id).length===0 && !O.d.getElementById("history").textContent.includes("104,2"));
console.log(`\n${ok} OK, ${ko} échec(s)`);
process.exit(ko?1:0);
