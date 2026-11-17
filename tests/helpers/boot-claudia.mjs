// Boots a copy of claudia.html inside jsdom with React/Babel from node_modules (no CDN), a mock
// Supabase client and stubs for browser-only libraries, so tests can click through the real app.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { createMockSupabase } from "./mock-supabase.mjs";

// Read UMD bundles straight from node_modules (their package "exports" hide these paths).
const NM = fileURLToPath(new URL("../node_modules/", import.meta.url));
const src = (p) => readFileSync(NM + p, "utf8");
const REACT = src("react/umd/react.development.js");
const REACT_DOM = src("react-dom/umd/react-dom.development.js");
const BABEL = src("@babel/standalone/babel.min.js");

export function loadHtml(path) {
  // Drop every external <script src> (CDNs) and the Google Maps loader; we inject our own.
  return readFileSync(path, "utf8")
    .replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, "")
    .replace(/<script>\s*\(g\s*=>[\s\S]*?<\/script>/, "");
}

export async function bootClaudia({ html, tables = {}, missingTables = [], storage = {}, fetchHandler = null }) {
  const { client, db, log } = createMockSupabase({ tables, missingTables });
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("error", (...a) => errors.push(a.map(String).join(" ")));
  vc.on("jsdomError", (e) => errors.push(`jsdomError: ${e.message}`));

  const dom = new JSDOM(html, {
    url: "https://claudia.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.alert = (m) => errors.push(`alert: ${m}`);
      window.confirm = () => true;
      window.navigator.clipboard = { writeText: async () => {} };
      // Edge Function calls: tests can supply fetchHandler(url, init, db) → { status, body }.
      const fetchCalls = (window.__fetchCalls = []);
      window.fetch = async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        const r = fetchHandler ? await fetchHandler(String(url), init, db) : { status: 503, body: {} };
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
      };
      window.L = { map: () => ({}), tileLayer: () => ({ addTo() {} }), marker: () => ({ addTo() {} }) };
      window.google = { maps: { importLibrary: async () => ({}) } };
      window.eval(REACT);
      window.eval(REACT_DOM);
      window.eval(BABEL);
      window.supabase = { createClient: () => client };
    },
  });
  const { window } = dom;
  await tick(window, 400);
  return { dom, window, db, log, errors };
}

export function tick(window, ms = 50) {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** Find a clickable element whose text includes `text` (case-sensitive, trimmed). */
export function findByText(window, text, selector = "button, a, div, span") {
  const els = Array.from(window.document.querySelectorAll(selector));
  // Prefer the most specific (deepest) match.
  const hits = els.filter((el) => (el.textContent || "").includes(text));
  return hits.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
}

export async function click(window, el, wait = 150) {
  if (!el) throw new Error("click: element not found");
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await tick(window, wait);
}
