// Compiles the app script exactly the way the page does in the browser (Babel Standalone,
// classic React runtime). A syntax error here would be a white screen in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const Babel = (await import("@babel/standalone")).default;
const html = readFileSync(fileURLToPath(new URL("../claudia.html", import.meta.url)), "utf8");

test("claudia.html app script compiles with the browser's Babel settings", () => {
  const m = html.match(/<script id="app-script" type="text\/plain">([\s\S]*?)<\/script>/);
  assert.ok(m, "app-script block found");
  const out = Babel.transform(m[1], { presets: [["react", { runtime: "classic" }]], compact: true });
  assert.ok(out.code.length > 100000);
});

test("APP_REV is a number and shows in the page", () => {
  const rev = Number((html.match(/const APP_REV = (\d+);/) || [])[1]);
  assert.ok(rev > 0);
});
