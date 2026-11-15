/* Storage adapter.
   Draft: uses Claude artifact storage (window.storage) when present, otherwise the browser's localStorage.
   Production: replace the three methods below with calls to a real backend (e.g. Supabase / Firebase),
   so every visitor sees the same directory and private fields are protected server-side. */
(function(){
  const PREFIX = "c4c:";
  const hasArtifactStore = !!(window.storage && typeof window.storage.get === "function");

  // localStorage can be blocked (private windows, sandboxed previews); fall back to memory for the session.
  let ls = null;
  try{ ls = window.localStorage; ls.setItem(PREFIX + "probe", "1"); ls.removeItem(PREFIX + "probe"); }catch(e){ ls = null; }
  const mem = new Map();
  const local = {
    async get(key){ try{ const v = ls ? ls.getItem(PREFIX + key) : mem.get(key); return v ? JSON.parse(v) : null; }catch(e){ return null; } },
    async set(key, val){ const s = JSON.stringify(val); if(ls) ls.setItem(PREFIX + key, s); else mem.set(key, s); },
    async remove(key){ try{ if(ls) ls.removeItem(PREFIX + key); else mem.delete(key); }catch(e){} }
  };
  const artifact = {
    async get(key){ try{ const r = await window.storage.get(PREFIX + key, true); return r && r.value ? JSON.parse(r.value) : null; }catch(e){ return null; } },
    async set(key, val){ await window.storage.set(PREFIX + key, JSON.stringify(val), true); },
    async remove(key){ try{ await window.storage.delete(PREFIX + key, true); }catch(e){} }
  };
  const kv = hasArtifactStore ? artifact : local;

  // Collections are stored as one array per collection — fine for a draft with tens/hundreds of rows.
  window.C4CStore = {
    mode: hasArtifactStore ? "Claude artifact storage" : (ls ? "browser localStorage" : "memory only — data clears on reload"),
    async list(name){ return (await kv.get(name)) || []; },
    async saveAll(name, rows){ await kv.set(name, rows); },
    async upsert(name, row){
      const rows = await this.list(name);
      const i = rows.findIndex(r => r.id === row.id);
      if(i >= 0) rows[i] = row; else rows.push(row);
      await kv.set(name, rows);
      return rows;
    },
    async remove(name, id){
      const rows = (await this.list(name)).filter(r => r.id !== id);
      await kv.set(name, rows);
      return rows;
    },
    async getMeta(key){ return kv.get("meta:" + key); },
    async setMeta(key, val){ return kv.set("meta:" + key, val); },
    async clear(){ await kv.remove("counselors"); await kv.remove("requests"); await kv.remove("meta:adminLastViewed"); }
  };
})();
