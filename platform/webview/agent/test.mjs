// Checks agent.js in Chromium: the snapshot of fixture.html matches fixture.snapshot, and
// clicking and typing at the positions locate() and focusForFill() return reach the right
// elements, through scrolling, frames and shadow roots.
//
//   node test.mjs [--update]
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const update = process.argv.includes("--update");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")); }
catch (error) { throw new Error("An existing Playwright installation is required (set PLAYWRIGHT_MODULE to its absolute module path); do not run playwright install", { cause: error }); }

const agent = await readFile(path.join(here, "agent.js"), "utf8");
const fixture = await readFile(path.join(here, "fixture.html"), "utf8");
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
let failures = 0;
function expect(condition, message) {
  if (condition) {
    console.log("  ok  " + message);
  } else {
    failures += 1;
    console.log("  FAIL " + message);
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.addInitScript(agent);
  await page.setContent(fixture, { waitUntil: "load" });
  // setContent does not rerun init scripts on about:blank; make sure it is there.
  await page.evaluate(agent);
  await page.waitForFunction(() => document.querySelector("iframe").contentDocument?.body?.childElementCount > 0);

  const snapshot = await page.evaluate(() => window.__silkAgent.snapshot());
  const goldenPath = path.join(here, "fixture.snapshot");
  if (update) {
    await writeFile(goldenPath, snapshot);
    console.log("wrote " + goldenPath);
  } else {
    const golden = await readFile(goldenPath, "utf8");
    expect(snapshot === golden, "the snapshot matches fixture.snapshot");
    if (snapshot !== golden) console.log(snapshot);
  }

  const refOf = (name) => {
    const match = new RegExp(`"${name}"[^\\n]*\\[ref=(e\\d+)\\]`).exec(snapshot);
    return match && match[1];
  };

  async function click(name) {
    const ref = refOf(name);
    const place = await page.evaluate((r) => window.__silkAgent.locate(r), ref);
    if (!place.ok) return place;
    await page.mouse.click(place.x, place.y);
    return place;
  }

  for (const [name, result] of [["Far away", "far"], ["Inside frame", "framed"], ["Shadow button", "shadow"], ["Custom control", "custom"]]) {
    await page.evaluate(() => { window.result = null; });
    const place = await click(name);
    const got = await page.evaluate(() => window.result);
    expect(place.ok && !place.covered && got === result, `a native click at locate("${name}") reaches it`);
  }

  const email = refOf("Email");
  const filled = await page.evaluate((r) => window.__silkAgent.focusForFill(r), email);
  await page.keyboard.type("new@example.com");
  const value = await page.evaluate(() => document.getElementById("email").value);
  expect(filled.ok && value === "new@example.com", "typing after focusForFill replaces the value");

  const notes = refOf("Notes");
  await page.evaluate((r) => window.__silkAgent.focusForFill(r), notes);
  await page.keyboard.type("final");
  const text = await page.evaluate(() => document.querySelector("[contenteditable]").textContent);
  expect(text === "final", "and the content of a contenteditable");

  const after = await page.evaluate(() => window.__silkAgent.snapshot());
  expect(after.includes(`[ref=${email}]: "new@example.com"`), "a new snapshot keeps refs and shows the new value");

  await page.evaluate(() => document.querySelector("form button").remove());
  const stale = await page.evaluate((r) => window.__silkAgent.locate(r), refOf("Sign in"));
  expect(!stale.ok && /take a new snapshot/.test(stale.error), "a removed element's ref fails with a hint");
} finally {
  await browser.close();
}

if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("agent.js checks passed");
