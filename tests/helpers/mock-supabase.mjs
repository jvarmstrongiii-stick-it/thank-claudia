// A small in-memory stand-in for the supabase-js client, enough to boot claudia.html in jsdom
// and observe what it reads and writes. Not a full PostgREST implementation — just the
// query-builder surface claudia.html actually uses.
import { randomUUID } from "node:crypto";

const EMBED_FK = { customers: "customer_id", jobs: "job_id", equipment: "equipment_id", users: "assigned_to" };

function parseSelect(sel) {
  const embeds = [];
  const re = /([a-z_]+)\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(sel || "")) !== null) embeds.push({ table: m[1], cols: m[2] });
  return embeds;
}

function pick(row, cols) {
  if (!row) return null;
  if (!cols || cols.trim() === "*") return { ...row };
  const out = {};
  cols.split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => { out[c] = row[c] ?? null; });
  return out;
}

export function createMockSupabase({ tables = {}, missingTables = [] } = {}) {
  const db = {};
  for (const [name, rows] of Object.entries(tables)) db[name] = rows.map((r) => ({ ...r }));
  const log = []; // every write: { table, op, payload, opts }

  function table(name) { return (db[name] ||= []); }

  class Query {
    constructor(name) {
      this.name = name; this.op = "select"; this.filters = []; this.sel = "*";
      this._single = false; this._maybe = false; this._limit = null; this._order = null; this._returning = false;
    }
    select(sel = "*") { if (this.op === "select") this.sel = sel; else { this._returning = true; this.sel = sel; } return this; }
    insert(payload) { this.op = "insert"; this.payload = payload; return this; }
    update(payload) { this.op = "update"; this.payload = payload; return this; }
    upsert(payload, opts = {}) { this.op = "upsert"; this.payload = payload; this.opts = opts; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    in(c, vs) { this.filters.push((r) => (vs || []).includes(r[c])); return this; }
    gte(c, v) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
    gt(c, v) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
    lte(c, v) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
    lt(c, v) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
    is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    ilike(c, pat) { const re = new RegExp("^" + String(pat).replace(/%/g, ".*") + "$", "i"); this.filters.push((r) => re.test(r[c] ?? "")); return this; }
    match(obj) { Object.entries(obj).forEach(([c, v]) => this.eq(c, v)); return this; }
    not() { return this; }
    // PostgREST or-filter, e.g. "job_id.is.null,job_id.neq.<id>" (eq / neq / is only).
    or(expr) {
      const parts = String(expr || "").split(",").map((p) => p.trim().match(/^([a-z_]+)\.(eq|neq|is)\.(.*)$/)).filter(Boolean);
      if (!parts.length) return this;
      const val = (v) => (v === "null" ? null : v === "true" ? true : v === "false" ? false : v);
      this.filters.push((r) => parts.some(([, c, op, v]) => {
        const x = r[c] ?? null, y = val(v);
        return op === "neq" ? x !== null && x !== y : x === y;
      }));
      return this;
    }
    contains() { return this; }
    filter() { return this; }
    order(c, o = {}) { this._order = { c, asc: o.ascending !== false }; return this; }
    limit(n) { this._limit = n; return this; }
    range() { return this; }
    single() { this._single = true; return this; }
    maybeSingle() { this._maybe = true; return this; }

    _embed(rows) {
      const embeds = parseSelect(this.sel);
      if (!embeds.length) return rows.map((r) => ({ ...r }));
      return rows.map((r) => {
        const out = { ...r };
        for (const e of embeds) {
          const fk = EMBED_FK[e.table];
          out[e.table] = pick(table(e.table).find((x) => x.id === r[fk]), e.cols);
        }
        return out;
      });
    }

    _run() {
      if (missingTables.includes(this.name)) {
        return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${this.name}' in the schema cache` } };
      }
      const rows = table(this.name);
      const match = (r) => this.filters.every((f) => f(r));
      let result;
      if (this.op === "select") {
        result = rows.filter(match);
        if (this._order) {
          const { c, asc } = this._order;
          result = [...result].sort((a, b) => ((a[c] ?? "") > (b[c] ?? "") ? 1 : (a[c] ?? "") < (b[c] ?? "") ? -1 : 0) * (asc ? 1 : -1));
        }
        if (this._limit != null) result = result.slice(0, this._limit);
        result = this._embed(result);
      } else if (this.op === "insert") {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p) => ({ id: randomUUID(), ...p }));
        rows.push(...list);
        log.push({ table: this.name, op: "insert", payload: this.payload });
        result = list.map((r) => ({ ...r }));
      } else if (this.op === "update") {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, this.payload));
        log.push({ table: this.name, op: "update", payload: this.payload, count: hit.length });
        result = hit.map((r) => ({ ...r }));
      } else if (this.op === "upsert") {
        const key = (this.opts && this.opts.onConflict) || "id";
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        result = list.map((p) => {
          const existing = rows.find((r) => r[key] === p[key]);
          if (existing) { Object.assign(existing, p); return { ...existing }; }
          const row = { id: randomUUID(), ...p };
          rows.push(row);
          return { ...row };
        });
        log.push({ table: this.name, op: "upsert", payload: this.payload, opts: this.opts });
      } else if (this.op === "delete") {
        const keep = rows.filter((r) => !match(r));
        log.push({ table: this.name, op: "delete", count: rows.length - keep.length });
        db[this.name] = keep;
        result = [];
      }
      if (this._single || this._maybe) {
        if (!result.length) return this._single ? { data: null, error: { code: "PGRST116", message: "no rows" } } : { data: null, error: null };
        return { data: result[0], error: null };
      }
      return { data: result, error: null };
    }
    then(resolve, reject) { return Promise.resolve().then(() => this._run()).then(resolve, reject); }
  }

  const client = {
    from: (name) => new Query(name),
    storage: {
      from: () => ({
        upload: async () => ({ data: {}, error: null }),
        remove: async () => ({ data: [], error: null }),
        getPublicUrl: (p) => ({ data: { publicUrl: `https://storage.test/${p}` } }),
        createSignedUrl: async (p) => ({ data: { signedUrl: `https://storage.test/${p}` }, error: null }),
      }),
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  };
  return { client, db, log };
}
