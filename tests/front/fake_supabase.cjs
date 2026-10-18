// Faux client Supabase en mémoire, avec les mêmes règles d'accès que la base (RLS simplifié).
module.exports = function makeFake(){
  const db = { users:{}, profiles:{}, user_days:{}, user_settings:{} };
  let session = null, listeners = [], nextId = 1;
  const log = [];
  const err = (message, code) => ({ message, code });
  const uid = () => session && session.user.id;
  const ownAccess = p => !!p && (p.comp || (p.subscription_status==="active"));
  const hasAccess = () => { const p=db.profiles[uid()]; if(!p) return false; const c=p.sponsor_id&&db.profiles[p.sponsor_id]; return ownAccess(p) || (!!c && c.role==="fitmotivator" && ownAccess(c)); };
  function newUser(email, password, meta){ const id="u"+(nextId++); db.users[id]={id,email,password,confirmed:false,user_metadata:meta||{}}; db.profiles[id]={id,email,comp:false,role:"user",display_name:null,sponsor_id:null,referral_code:null}; return db.users[id]; }
  const pub = u => ({ id:u.id, email:u.email, user_metadata:u.user_metadata });
  const emit = (ev) => listeners.forEach(f=>f(ev, session));
  function builder(table){
    const st = { table, filters:[], single:false };
    const run = async () => {
      log.push(["select", table]);
      if(!uid()) return { data:null, error: err("permission denied for table "+table, "42501") };
      if(table==="profiles"){ const p=db.profiles[uid()]; return { data: p ? {email:p.email, display_name:p.display_name, role:p.role, sponsor_id:p.sponsor_id} : null, error:null }; }
      if(!hasAccess()) return { data: st.single ? null : [], error:null };   // RLS : lignes invisibles
      if(table==="user_settings"){ const r=db.user_settings[uid()]; return { data: r ? {data:r.data} : null, error:null }; }
      let rows = Object.values(db.user_days).filter(r=>r.user_id===uid()).sort((a,b)=>a.date<b.date?-1:1);
      if(st.range) rows = rows.slice(st.range[0], st.range[1]+1);
      return { data: rows.map(r=>({data:r.data})), error:null };
    };
    const b = {
      select(){ return b; }, order(){ return b; }, range(a,z){ st.range=[a,z]; return b; },
      maybeSingle(){ st.single=true; return run(); },
      then(res, rej){ return run().then(res, rej); },
      async upsert(rows, opts){
        rows = Array.isArray(rows) ? rows : [rows];
        log.push(["upsert", table, rows.length, opts && opts.onConflict]);
        if(!uid() || !hasAccess() || rows.some(r=>r.user_id!==uid())) return { error: err('new row violates row-level security policy for table "'+table+'"', "42501") };
        rows.forEach(r=>{ if(table==="user_days") db.user_days[r.user_id+"|"+r.date]=r; else db.user_settings[r.user_id]=r; });
        return { error:null };
      }
    };
    return b;
  }
  const client = {
    auth: {
      async signUp({email,password,options}){ log.push(["signUp",email]); if(Object.values(db.users).some(u=>u.email===email)) return {data:{},error:err("User already registered")}; if(password.length<8) return {data:{},error:err("Password should be at least 8 characters.")}; const u=newUser(email,password,options&&options.data); return { data:{ user:pub(u), session:null }, error:null }; },
      async signInWithPassword({email,password}){ const u=Object.values(db.users).find(x=>x.email===email&&x.password===password); if(!u) return {data:{},error:err("Invalid login credentials")}; if(!u.confirmed) return {data:{},error:err("Email not confirmed")}; session={user:pub(u)}; emit("SIGNED_IN"); return {data:{user:pub(u),session},error:null}; },
      async resetPasswordForEmail(email, opts){ log.push(["reset",email,opts&&opts.redirectTo]); return {error:null}; },
      async updateUser({password}){ const u=db.users[uid()]; u.password=password; return {data:{user:pub(u)},error:null}; },
      async getSession(){ return {data:{session}}; },
      onAuthStateChange(f){ listeners.push(f); return {data:{subscription:{unsubscribe(){}}}}; },
      async signOut(){ session=null; log.push(["signOut"]); emit("SIGNED_OUT"); return {error:null}; }
    },
    from: builder,
    async rpc(name, args){
      log.push(["rpc",name,args]);
      if(!uid()) return {data:null,error:err("permission denied for function "+name,"42501")};
      if(name==="has_access") return {data:hasAccess(),error:null};
      if(name==="set_display_name"){ db.profiles[uid()].display_name=args.name; return {data:null,error:null}; }
      if(name==="redeem_referral_code"){ const c=Object.values(db.profiles).find(p=>p.referral_code===String(args.code).trim().toUpperCase()&&p.role==="fitmotivator"); if(!c) return {data:null,error:err("Code de parrainage invalide.","P0002")}; if(!ownAccess(c)) return {data:null,error:err("L'abonnement de ce FitMotivator n'est pas actif.","P0001")}; db.profiles[uid()].sponsor_id=c.id; return {data:c.display_name||c.email,error:null}; }
      return {data:null,error:err("unknown rpc")};
    }
  };
  return { client, db, log, setSession(u){ session = u ? {user:pub(u)} : null; }, confirm(email){ Object.values(db.users).find(u=>u.email===email).confirmed=true; }, newUser };
};
