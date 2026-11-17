// Runs inside demo/claudia-demo.html before the app. Plain browser JS (no build step).
// - window.supabase.createClient → an in-memory database seeded from window.__DEMO.tables
// - the warranty_registrations → equipment status sync that migration 0006's trigger does
// - fetch() to the warranty-send Edge Function → the real send core, with a pretend provider
// - a small DEMO panel: the customer's inbox, and "Reply as the customer" → the real inbound core
(function () {
  var D = window.__DEMO;
  var uuid = function () { return (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); };
  var db = {};
  Object.keys(D.tables).forEach(function (k) { db[k] = D.tables[k].map(function (r) { return Object.assign({}, r); }); });
  window.__demoDB = db;
  var T = function (n) { return (db[n] = db[n] || []); };

  // migration 0006, step 6: registration status → equipment columns
  function syncEquipment(reg, before) {
    if (before && before.status === reg.status) return;
    var e = T("equipment").find(function (x) { return x.id === reg.equipment_id; });
    if (!e) return;
    e.warranty_status = reg.status;
    e.warranty_status_at = new Date().toISOString();
    if (reg.status === "registered") {
      e.warranty_registered = true;
      e.warranty_registered_date = e.warranty_registered_date || new Date().toISOString().slice(0, 10);
    }
  }

  var EMBED_FK = { customers: "customer_id", jobs: "job_id", equipment: "equipment_id", users: "assigned_to" };
  function parseSelect(sel) { var out = [], re = /([a-z_]+)\(([^)]*)\)/g, m; while ((m = re.exec(sel || "")) !== null) out.push({ table: m[1], cols: m[2] }); return out; }
  function pick(row, cols) {
    if (!row) return null;
    if (!cols || cols.trim() === "*") return Object.assign({}, row);
    var o = {}; cols.split(",").map(function (c) { return c.trim(); }).filter(Boolean).forEach(function (c) { o[c] = row[c] == null ? null : row[c]; }); return o;
  }

  function Query(name) { this.name = name; this.op = "select"; this.filters = []; this.sel = "*"; this._single = false; this._maybe = false; this._limit = null; this._order = null; }
  var Q = Query.prototype;
  Q.select = function (s) { this.sel = s || "*"; return this; };
  Q.insert = function (p) { this.op = "insert"; this.payload = p; return this; };
  Q.update = function (p) { this.op = "update"; this.payload = p; return this; };
  Q.upsert = function (p, o) { this.op = "upsert"; this.payload = p; this.opts = o || {}; return this; };
  Q.delete = function () { this.op = "delete"; return this; };
  Q.eq = function (c, v) { this.filters.push(function (r) { return r[c] === v; }); return this; };
  Q.neq = function (c, v) { this.filters.push(function (r) { return r[c] !== v; }); return this; };
  Q.in = function (c, vs) { this.filters.push(function (r) { return (vs || []).indexOf(r[c]) >= 0; }); return this; };
  Q.gte = function (c, v) { this.filters.push(function (r) { return r[c] != null && r[c] >= v; }); return this; };
  Q.gt = function (c, v) { this.filters.push(function (r) { return r[c] != null && r[c] > v; }); return this; };
  Q.lte = function (c, v) { this.filters.push(function (r) { return r[c] != null && r[c] <= v; }); return this; };
  Q.lt = function (c, v) { this.filters.push(function (r) { return r[c] != null && r[c] < v; }); return this; };
  Q.is = function (c, v) { this.filters.push(function (r) { return (r[c] == null ? null : r[c]) === v; }); return this; };
  Q.ilike = function (c, pat) { var re = new RegExp("^" + String(pat).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i"); this.filters.push(function (r) { return re.test(r[c] || ""); }); return this; };
  Q.match = function (o) { var s = this; Object.keys(o).forEach(function (k) { s.eq(k, o[k]); }); return s; };
  Q.or = function (expr) {
    var parts = String(expr || "").split(",").map(function (p) { return p.trim().match(/^([a-z_]+)\.(eq|neq|is)\.(.*)$/); }).filter(Boolean);
    if (!parts.length) return this;
    var val = function (v) { return v === "null" ? null : v === "true" ? true : v === "false" ? false : v; };
    this.filters.push(function (r) { return parts.some(function (p) { var x = r[p[1]] == null ? null : r[p[1]], y = val(p[3]); return p[2] === "neq" ? x !== null && x !== y : x === y; }); });
    return this;
  };
  ["not", "contains", "filter", "range", "overlaps", "textSearch"].forEach(function (k) { Q[k] = function () { return this; }; });
  Q.order = function (c, o) { this._order = { c: c, asc: !(o && o.ascending === false) }; return this; };
  Q.limit = function (n) { this._limit = n; return this; };
  Q.single = function () { this._single = true; return this; };
  Q.maybeSingle = function () { this._maybe = true; return this; };
  Q._embed = function (rows) {
    var embeds = parseSelect(this.sel);
    return rows.map(function (r) {
      var o = Object.assign({}, r);
      embeds.forEach(function (e) { var fk = EMBED_FK[e.table]; if (fk) o[e.table] = pick(T(e.table).find(function (x) { return x.id === r[fk]; }), e.cols); });
      return o;
    });
  };
  Q._run = function () {
    var self = this, rows = T(this.name), match = function (r) { return self.filters.every(function (f) { return f(r); }); }, result;
    var isReg = this.name === "warranty_registrations";
    if (this.op === "select") {
      result = rows.filter(match);
      if (this._order) { var c = this._order.c, asc = this._order.asc; result = result.slice().sort(function (a, b) { var x = a[c] == null ? "" : a[c], y = b[c] == null ? "" : b[c]; return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1); }); }
      if (this._limit != null) result = result.slice(0, this._limit);
      result = this._embed(result);
    } else if (this.op === "insert") {
      var list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(function (p) { return Object.assign({ id: uuid(), created_at: new Date().toISOString() }, p); });
      list.forEach(function (r) { rows.push(r); if (isReg) syncEquipment(r, null); });
      result = list.map(function (r) { return Object.assign({}, r); });
    } else if (this.op === "update") {
      var hit = rows.filter(match);
      hit.forEach(function (r) { var before = Object.assign({}, r); Object.assign(r, self.payload); if (isReg) syncEquipment(r, before); });
      result = hit.map(function (r) { return Object.assign({}, r); });
    } else if (this.op === "upsert") {
      var key = (this.opts && this.opts.onConflict) || "id";
      result = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(function (p) {
        var ex = rows.find(function (r) { return r[key] === p[key]; });
        if (ex) { var before = Object.assign({}, ex); Object.assign(ex, p); if (isReg) syncEquipment(ex, before); return Object.assign({}, ex); }
        var row = Object.assign({ id: uuid() }, p); rows.push(row); if (isReg) syncEquipment(row, null); return Object.assign({}, row);
      });
    } else if (this.op === "delete") {
      db[this.name] = rows.filter(function (r) { return !match(r); }); result = [];
    }
    if (this._single || this._maybe) {
      if (!result.length) return this._single ? { data: null, error: { code: "PGRST116", message: "no rows" } } : { data: null, error: null };
      return { data: result[0], error: null };
    }
    return { data: result, error: null, count: result.length };
  };
  Q.then = function (res, rej) { var s = this; return Promise.resolve().then(function () { return s._run(); }).then(res, rej); };

  var client = {
    from: function (n) { return new Query(n); },
    rpc: function () { return Promise.resolve({ data: null, error: null }); },
    storage: { from: function () { return {
      upload: function () { return Promise.resolve({ data: {}, error: null }); },
      remove: function () { return Promise.resolve({ data: [], error: null }); },
      getPublicUrl: function (p) { return { data: { publicUrl: "about:blank#" + p } }; },
      createSignedUrl: function (p) { return Promise.resolve({ data: { signedUrl: "about:blank#" + p }, error: null }); },
    }; } },
    channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
    removeChannel: function () {},
    auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); }, onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; } },
  };
  window.supabase = { createClient: function () { return client; } };

  // Signed in as Jack on an authorised device (the app's own localStorage keys).
  try {
    localStorage.setItem("abc_device_auth", "ABCmech");
    localStorage.setItem("abc_current_user", JSON.stringify(D.user));
  } catch (e) {}

  // ── the real warranty cores, loaded as modules from the embedded (type-stripped) sources ──
  var C = window.__DEMO_CORES;
  var blob = function (src) { return URL.createObjectURL(new Blob([src], { type: "text/javascript" })); };
  var matchUrl = blob(C.match);
  var coresReady = Promise.all([
    import(blob(C.send)),
    import(blob(C.inbound.replace(/(["'])\.\/warranty-match\.ts\1/g, JSON.stringify(matchUrl)))),
  ]).then(function (m) { return { send: m[0], inbound: m[1] }; });

  var mfByKey = function (k) { return T("warranty_manufacturers").find(function (m) { return m.brand_key === k; }) || null; };
  var cfg = { mode: "live", provider: "postmark", apiKey: "demo", fromEmail: D.inbox, fromName: D.company, replyInbox: D.inbox, mailgunDomain: null, dailyLimit: 40 };
  window.__demoMail = []; // what the pretend provider "delivered"

  function sendStore() {
    return {
      loadJob: async function (jobId, token) {
        var regs = T("warranty_registrations").filter(function (r) { return r.job_id === jobId && r.email_token === token; });
        if (!regs.length) return null;
        var cust = T("customers").find(function (c) { return c.id === regs[0].customer_id; }) || {};
        return {
          customer: cust.name || null, email: cust.email || null,
          units: regs.map(function (r) {
            var e = T("equipment").find(function (x) { return x.id === r.equipment_id; });
            return { registration_id: r.id, status: r.status, equipment: e && { id: e.id, label: e.label, model_number: e.model_number, serial_number: e.serial_number, install_date: e.install_date }, manufacturer: mfByKey(r.brand_key) };
          }).filter(function (u) { return u.equipment; }),
        };
      },
      countOutboundSince: async function () { return 0; },
      hasSent: async function (token) { return T("warranty_outbound").some(function (o) { return o.email_token === token && o.status === "sent"; }); },
      insertOutbound: async function (row) { var id = uuid(); T("warranty_outbound").push(Object.assign({ id: id, created_at: new Date().toISOString() }, row)); return id; },
      markSent: async function (ids, f) {
        T("warranty_registrations").forEach(function (r) {
          if (ids.indexOf(r.id) >= 0 && r.status === "email_prepared") { var b = Object.assign({}, r); Object.assign(r, { status: "sent", sent_at: f.sent_at, outbound_id: f.outbound_id }); syncEquipment(r, b); }
        });
      },
    };
  }
  // Pretend Postmark: accepts the message, returns an id, sends nothing anywhere.
  var fakeProvider = async function (url, init) {
    var msg = JSON.parse(init.body);
    var id = uuid();
    window.__demoMail.push({ provider_id: id, msg: msg, at: new Date().toISOString() });
    return new Response(JSON.stringify({ MessageID: id, ErrorCode: 0, Message: "OK" }), { status: 200 });
  };

  var realFetch = window.fetch.bind(window);
  window.fetch = async function (url, init) {
    var u = String(url);
    if (/\/functions\/v1\/warranty-send/.test(u)) {
      var cores = await coresReady;
      var out = await cores.send.sendJobWarrantyEmail(sendStore(), JSON.parse(init.body), cfg, { fetch: fakeProvider });
      setTimeout(renderPanel, 50);
      return new Response(JSON.stringify(out.body), { status: out.http, headers: { "Content-Type": "application/json" } });
    }
    if (/supabase\.co/.test(u)) return new Response(JSON.stringify({ error: "not available in the demo" }), { status: 503 });
    return realFetch(url, init);
  };

  function inboundStore() {
    return {
      findInboundByMessageId: async function (id) { var h = T("warranty_inbound").find(function (r) { return r.message_id === id; }); return h ? { id: h.id, status: h.status } : null; },
      insertRaw: async function () { return null; },
      insertInbound: async function (row) { var id = uuid(); T("warranty_inbound").push(Object.assign({ id: id, received_at: new Date().toISOString() }, row)); return id; },
      loadManufacturers: async function () { return T("warranty_manufacturers"); },
      loadRegistrations: async function () {
        return T("warranty_registrations").map(function (r) {
          return Object.assign({}, r, { equipment: T("equipment").find(function (e) { return e.id === r.equipment_id; }), customers: T("customers").find(function (c) { return c.id === r.customer_id; }) });
        });
      },
      markRegistered: async function (ids, f) {
        T("warranty_registrations").forEach(function (r) {
          if (ids.indexOf(r.id) >= 0 && r.status !== "registered") {
            var b = Object.assign({}, r);
            Object.assign(r, { status: "registered", registered_at: new Date().toISOString(), registered_via: "auto_match", confirmation_number: f.confirmation_number, matched_inbound_id: f.matched_inbound_id, hold_reasons: [] });
            syncEquipment(r, b);
          }
        });
      },
      findOutbound: async function (q) {
        return T("warranty_outbound").filter(function (o) { return (o.message_ids || []).some(function (id) { return q.threadIds.indexOf(id) >= 0; }) || q.tokens.indexOf(o.email_token) >= 0; });
      },
    };
  }

  // ── DEMO panel ──
  var css = document.createElement("style");
  css.textContent = [
    "#demo-pill{position:fixed;right:12px;bottom:12px;z-index:99999;background:#d9af52;color:#0e0f0c;font:600 13px/1 'Barlow Semi Condensed',sans-serif;border-radius:18px;padding:9px 14px;box-shadow:0 2px 10px rgba(0,0,0,.5);cursor:pointer;letter-spacing:.03em}",
    "#demo-sheet{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.6);display:none;align-items:flex-end;justify-content:center}",
    "#demo-card{background:#f6f5f0;color:#1d1d1b;width:100%;max-width:520px;max-height:92vh;overflow:auto;border-radius:14px 14px 0 0;padding:16px 16px 70px;font:15px/1.45 -apple-system,'Segoe UI',Roboto,sans-serif}",
    "#demo-card h3{font:600 13px/1.2 -apple-system,sans-serif;letter-spacing:.06em;color:#6b7338;margin:0 0 10px;text-transform:uppercase}",
    ".dm-hdr{font-size:13px;color:#555;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:10px}.dm-hdr b{color:#1d1d1b;font-weight:600}",
    ".dm-body{white-space:pre-wrap;font-size:14px}.dm-btn{display:block;width:100%;margin-top:12px;padding:12px;border-radius:9px;border:none;font:600 15px -apple-system,sans-serif;cursor:pointer}",
    ".dm-pri{background:#2f6fde;color:#fff}.dm-sec{background:#e4e2da;color:#1d1d1b}.dm-note{font-size:12px;color:#777;margin-top:8px}",
    ".dm-ok{background:#e7f3dd;border:1px solid #9ac27a;border-radius:9px;padding:10px 12px;margin-top:10px;font-size:14px}",
    ".dm-warn{background:#fbf0d9;border:1px solid #d9af52;border-radius:9px;padding:10px 12px;margin-top:10px;font-size:14px}",
    "textarea.dm-ta{width:100%;min-height:210px;font:14px/1.4 -apple-system,sans-serif;border:1px solid #ccc;border-radius:8px;padding:10px;background:#fff;color:#1d1d1b}",
  ].join("\n");
  document.head.appendChild(css);

  var pill, sheet, card;
  function el(tag, attrs, html) { var e = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function open() { sheet.style.display = "flex"; }
  function close() { sheet.style.display = "none"; }
  window.__demoClose = close;

  function lastMail() { return window.__demoMail[window.__demoMail.length - 1] || null; }
  function renderPanel() { if (pill) pill.textContent = window.__demoMail.length ? "DEMO · 📬 Customer's inbox (" + window.__demoMail.length + ")" : "DEMO"; }

  function showInbox() {
    var m = lastMail();
    if (!m) {
      card.innerHTML = "<h3>Customer's inbox</h3><div class='dm-note'>Nothing sent yet. Finish an install, open the unit's warranty email and press SEND EMAIL.</div><button class='dm-btn dm-sec' onclick='__demoClose()'>Close</button>";
      return open();
    }
    var x = m.msg;
    card.innerHTML = "<h3>📬 " + esc(x.To) + " · Inbox</h3>" +
      "<div class='dm-hdr'><div><b>" + esc(x.From) + "</b></div><div>To: " + esc(x.To) + "</div><div>Reply-To: " + esc(x.ReplyTo) + "</div><div style='margin-top:4px'><b>" + esc(x.Subject) + "</b></div></div>" +
      "<div class='dm-body'>" + esc(x.TextBody).replace(/(https?:\/\/[^\s]+)/g, "<u style='color:#2f6fde'>$1</u>") + "</div>" +
      "<button class='dm-btn dm-pri' id='dm-reply'>↩ Reply</button><button class='dm-btn dm-sec' onclick='__demoClose()'>Close</button>";
    document.getElementById("dm-reply").onclick = function () { showReply(m); };
    open();
  }

  function showReply(m) {
    var x = m.msg;
    var serials = (x.TextBody.match(/Serial number: ([A-Za-z0-9-]+)/g) || []).map(function (s) { return s.replace("Serial number: ", ""); });
    var lines = ["Hi, all done. I registered everything on the Goodman site this morning. Here's what they sent me:", "",
      "---------- Forwarded message ----------", "From: Goodman Product Registration", "Subject: Thank you for registering your Goodman product", "",
      "Thank you for registering your Goodman product.", "Confirmation Number: GM-4471902"];
    serials.forEach(function (s) { lines.push("Serial Number: " + s); });
    lines.push("", "> On " + new Date(m.at).toDateString() + ", " + D.company + " wrote:", "> " + x.Subject);
    card.innerHTML = "<h3>↩ Replying as the customer</h3>" +
      "<div class='dm-hdr'><div>From: <b>" + esc(x.To) + "</b></div><div>To: " + esc(x.ReplyTo) + "</div><div>Subject: <b>Re: " + esc(x.Subject) + "</b></div></div>" +
      "<textarea class='dm-ta' id='dm-ta'>" + esc(lines.join("\n")) + "</textarea>" +
      "<button class='dm-btn dm-pri' id='dm-send'>Send reply</button><button class='dm-btn dm-sec' onclick='__demoClose()'>Cancel</button>" +
      "<div class='dm-note'>Their email app fills in To: from our Reply-To and adds In-Reply-To pointing at our message. That's the tracker.</div>";
    document.getElementById("dm-send").onclick = async function () {
      this.disabled = true; this.textContent = "Sending…";
      var outbound = T("warranty_outbound").filter(function (o) { return (o.message_ids || []).indexOf(String(m.provider_id).toLowerCase()) >= 0; })[0];
      var ourId = outbound && outbound.message_ids[0];
      var payload = { from: x.To, to: x.ReplyTo, subject: "Re: " + x.Subject, text: document.getElementById("dm-ta").value,
        message_id: "reply-" + uuid() + "@mail.example.com", in_reply_to: ourId ? "<" + ourId + ">" : undefined, references: ourId ? "<" + ourId + ">" : undefined };
      var cores = await coresReady;
      var res = await cores.inbound.processInboundEmail(inboundStore(), payload, cores.inbound.normalizeInbound(payload));
      showResult(res, outbound, payload);
    };
  }

  function showResult(res, outbound, payload) {
    var inb = T("warranty_inbound").find(function (r) { return r.id === res.inbound_id; }) || {};
    var regs = T("warranty_registrations").filter(function (r) { return (inb.matched_registration_ids || []).indexOf(r.id) >= 0; });
    var units = regs.map(function (r) { var e = T("equipment").find(function (x) { return x.id === r.equipment_id; }); return e ? e.label + " (S/N " + e.serial_number + ")" : r.id; });
    var tied = (inb.parsed && inb.parsed.reply_to_tokens || []).length;
    var box = res.status === "auto_matched"
      ? "<div class='dm-ok'><b>✓ Registered automatically</b><br>" + esc(units.join(", ")) + "<br>Confirmation " + esc(inb.parsed && inb.parsed.confirmation_number) + " · match score " + Math.round((inb.confidence || 0) * 100) + "</div>"
      : "<div class='dm-warn'><b>Sent to WARRANTY REVIEW</b><br>" + esc(inb.summary) + "</div>";
    card.innerHTML = "<h3>📥 What arrived at " + esc(D.inbox) + "</h3>" +
      "<div class='dm-hdr'><div>From: <b>" + esc(payload.from) + "</b></div><div>To: " + esc(payload.to) + "</div><div>In-Reply-To: " + esc(payload.in_reply_to || "(none)") + "</div></div>" +
      (tied ? "<div class='dm-ok'>↩ Tied to our email <b>W-" + esc(outbound ? outbound.email_token : "") + "</b> (sent to " + esc(outbound ? outbound.to_email : "") + ")</div>" : "<div class='dm-warn'>Not tied to one of our emails</div>") +
      box +
      "<div class='dm-note'>" + esc(inb.summary || "") + "</div>" +
      "<button class='dm-btn dm-sec' onclick='__demoClose()'>Back to the app</button>";
  }

  document.addEventListener("DOMContentLoaded", function () {
    pill = el("div", { id: "demo-pill" }, "DEMO");
    sheet = el("div", { id: "demo-sheet" });
    card = el("div", { id: "demo-card" });
    sheet.appendChild(card);
    sheet.addEventListener("click", function (e) { if (e.target === sheet) close(); });
    pill.addEventListener("click", showInbox);
    document.body.appendChild(sheet);
    document.body.appendChild(pill);
    renderPanel();
  });
})();
