import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const routeDir = path.join(root, "read-the-room-public-pro");
const htmlPath = path.join(routeDir, "index.html");
const cssPath = path.join(routeDir, "readtheroom-public-pro.css");
const jsPath = path.join(routeDir, "readtheroom-public-pro.js");

assert.ok(fs.existsSync(htmlPath), "public professional route must exist");
assert.ok(fs.existsSync(cssPath), "public professional route must use one scoped stylesheet");
assert.ok(fs.existsSync(jsPath), "public professional route must use one external behavior script");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");
const standaloneServerPath = path.join(root, "scripts", "read-the-room", "readtheroomPublicServer.mjs");
const serverPaths = [standaloneServerPath].filter((candidate) => fs.existsSync(candidate));
assert.ok(serverPaths.length > 0, "a public ReadTheRoom server implementation must exist");
const server = serverPaths.map((candidate) => fs.readFileSync(candidate, "utf8")).join("\n");

assert.match(html, /data-public-pro-version=["']3\.4-final["']/);
assert.match(html, /Teach your AI to read\s*<em>the room\.<\/em>/i);
assert.doesNotMatch(html, /No cloud upload or telemetry/i, 'hosted beta must not imply typed prompts never reach its server');
assert.match(html, /Processed only for this session/i);
assert.match(html, /Voice recognition is handled by your browser and may use its online speech service/i, 'voice processing disclosure must name the browser-provider boundary');
assert.match(html, /ReadTheRoom receives only the resulting text and keeps it in ephemeral session memory/i, 'voice disclosure must describe what the app receives and retains');
assert.doesNotMatch(css, /font(?:-size)?\s*:[^;{}]*\b9px\b/i, 'public UI must not render nine-pixel labels');
assert.match(css, /\.rtr-action--nav\s*\{[\s\S]*?min-height:\s*44px/i, 'navigation CTA needs a 44px target');
assert.match(css, /\.rtr-action--section\s*\{[\s\S]*?min-height:\s*44px/i, 'section CTAs need a 44px target');
assert.doesNotMatch(html, /AI should understand the moment/i);
assert.doesNotMatch(html, /<style\b/i, "styles must be consolidated into the scoped stylesheet");
assert.equal((html.match(/<link\b[^>]*readtheroom-public-pro\.css/gi) || []).length, 1);
assert.equal((html.match(/<script\b[^>]*readtheroom-public-pro\.js/gi) || []).length, 1);
assert.doesNotMatch(html, /\sstyle=["']/i, "public HTML must not retain inline style patches");
assert.doesNotMatch(html, /legacy-v5-cockpit|Madden UI|FLOW TEST OVERRIDES/i);
assert.match(html, /class=["'][^"']*rtr-action--primary/);
assert.match(html, /class=["'][^"']*rtr-action--secondary/);
assert.match(html, /class=["'][^"']*rtr-toggle__option/);
assert.match(html, /class=["'][^"']*rtr-option-card/);

const requiredIds = [
  "rtrPromptInput",
  "voicePromptBtn",
  "samplePromptBtn",
  "analyzePromptBtn",
  "quickProofModeBtn",
  "fullCalibrationModeBtn",
  "calibrationTimerText",
  "liveBehaviorMatchBar",
  "proofDefaultViewBtn",
  "proofCalibratedViewBtn",
  "mayaOptionList",
  "technicalProofPanel",
  "downloadSampleReceiptBtn"
];
for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`));

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicateIds, []);

const hero = html.match(/<section[^>]*class=["'][^"']*rtr-hero[^"']*["'][\s\S]*?<\/section>/i)?.[0] || "";
assert.equal((hero.match(/rtr-action--primary/g) || []).length, 1, "hero must have one clear primary CTA");

assert.match(css, /--rtr-bg:\s*#101013/i);
assert.match(css, /--rtr-orange:\s*#ff7a39/i);
assert.match(css, /--rtr-mint:\s*#78cca0/i);
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i);
assert.doesNotMatch(css, /(?:body|\.rtr-public-pro-body|\.rtr-public-pro|\.rtr-tight-wrap|\.rtr-tight-hero|\.rtr-public-proof-stage)::before\s*\{/i, "root ambient pseudo-elements are forbidden");
assert.doesNotMatch(css, /--(?:maya-)?blue|rgba\(117\s*,\s*187\s*,\s*255|#75bbff/i);
assert.doesNotMatch(js, /textContent\s*(?:===|==|\.includes\()[\s\S]{0,120}style\./i, "styling must use semantic state classes, not visible-text matching");
assert.match(js, /classList\.toggle\(["']is-active["']/);
assert.match(js, /prefers-reduced-motion/);

const fontDir = path.join(routeDir, "assets", "fonts");
const fontFiles = [
  "inter-latin-wght-normal.woff2",
  "jetbrains-mono-latin-wght-normal.woff2",
  "OFL-Inter.txt",
  "OFL-JetBrains-Mono.txt"
];
for (const file of fontFiles) {
  const fontPath = path.join(fontDir, file);
  assert.ok(fs.existsSync(fontPath), `self-hosted public font asset missing: ${file}`);
  assert.ok(fs.statSync(fontPath).size > 1000, `font asset or license appears incomplete: ${file}`);
}
assert.match(css, /@font-face\s*\{[\s\S]*?font-family:\s*["']ReadTheRoom Sans["'][\s\S]*?inter-latin-wght-normal\.woff2[\s\S]*?format\(["']woff2["']\)/i);
assert.match(css, /@font-face\s*\{[\s\S]*?font-family:\s*["']ReadTheRoom Mono["'][\s\S]*?jetbrains-mono-latin-wght-normal\.woff2[\s\S]*?format\(["']woff2["']\)/i);
assert.match(css, /--rtr-sans:\s*["']ReadTheRoom Sans["']/i);
assert.match(css, /--rtr-mono:\s*["']ReadTheRoom Mono["']/i);
assert.match(css, /--rtr-muted-soft:\s*#827b77/i, "secondary copy must retain AA contrast on the matte-black surface");
assert.doesNotMatch(css, /font-size:\s*9px/i, "public labels must not render below 10px");
assert.match(css, /\.rtr-action\s*\{[\s\S]*?min-height:\s*44px/i, "interactive controls need a 44px public touch target");
assert.match(css, /\.rtr-proof-toggle\s+\.rtr-toggle__option\s*\{[\s\S]*?min-height:\s*44px/i, "proof tabs need a 44px public touch target");
assert.match(server, /["']\.woff2["'](?:\s*=>|\s*[:,])\s*["']font\/woff2["']/, "the public server must emit the correct WOFF2 MIME type");

const cockpitLeftStart = html.indexOf('<div class="rtr-cockpit-left">');
const calibrationTimelineStart = html.indexOf('id="calibrationTimeline"');
assert.ok(cockpitLeftStart >= 0 && calibrationTimelineStart > cockpitLeftStart, "live cockpit must keep an explicit left rail before the calibration workspace");
const cockpitLeftMarkup = html.slice(cockpitLeftStart, calibrationTimelineStart);
assert.match(cockpitLeftMarkup, /id=["']liveCalibrationTracker["']/, "live Behavior Match and learning signals belong in the left rail");
assert.match(css, /\.rtr-live-cockpit\s*\{[\s\S]*?grid-template-columns:\s*minmax\(300px,\s*340px\)\s+minmax\(0,\s*1fr\)/i, "desktop cockpit must use a narrow rail and wider main workspace");
assert.match(css, /\.rtr-cockpit-left\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*74px/i, "desktop live rail must stay visible while the calibration workspace scrolls");
assert.match(css, /\.rtr-cockpit-left\s+\.rtr-live-tracker\s*\{[\s\S]*?grid-template-columns:\s*1fr/i, "rail signals must stack vertically instead of becoming another wide card row");

assert.match(server, /read-the-room-public-pro-v3-4/);
assert.match(server, /read-the-room-public-pro/);
assert.match(server, /index\.html/);

console.log(JSON.stringify({
  ok: true,
  route: "/read-the-room-public-pro-v3-4/",
  duplicateIds: duplicateIds.length,
  requiredInteractions: requiredIds.length,
  stylesheetCount: 1,
  scriptCount: 1
}, null, 2));
