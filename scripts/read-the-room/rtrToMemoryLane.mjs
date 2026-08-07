#!/usr/bin/env node
/**
 * rtrToMemoryLane.mjs — ReadTheRoom → Memory Lane bridge.
 *
 * Absorbs the Memory Lane frontier layer into ReadTheRoom: every completed
 * calibration session is sealed into the Memory Lane library as a chain-linked
 * block — durable, searchable, tamper-evident, resumable. A returning user's
 * calibration history becomes queryable memory instead of a local JSON file
 * that can be lost or edited without trace.
 *
 * Deterministic and free: facts are written explicitly (no LLM extraction),
 * so this runs with zero token cost and zero external dependencies beyond the
 * Memory Lane server.
 *
 * Usage:
 *   node scripts/read-the-room/rtrToMemoryLane.mjs
 *     [--store data/readtheroom-calibration-sessions.json]
 *     [--ml-base http://127.0.0.1:8770]
 *     [--dry-run]
 *
 * Exit 0 on success (or nothing to sync). Non-zero on hard failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STORE = path.join(REPO_ROOT, 'data', 'readtheroom-calibration-sessions.json');
const DEFAULT_ML = 'http://127.0.0.1:8770';
const LEDGER = path.join(REPO_ROOT, 'data', '.rtr-ml-sync-ledger.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const STORE = arg('--store', DEFAULT_STORE);
const ML_BASE = arg('--ml-base', DEFAULT_ML);
const DRY_RUN = process.argv.includes('--dry-run');

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

function loadLedger() {
  return readJson(LEDGER, { version: 'rtr_ml_sync_ledger_v1', synced: {} });
}
function saveLedger(l) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2));
}

function sessionToBlock(sid, s) {
  const baseline = s.baseline || {};
  const bm = s.behaviorMatch || {};
  const pw = s.profileWrite || {};
  const sig = (s.acceptedSignals || []).map((x) => String(x).slice(0, 120)).join('; ');
  const body = [
    `# ReadTheRoom calibration session ${sid}`,
    '',
    `- Status: ${s.status || 'unknown'}`,
    `- Created: ${s.createdAt || 'n/a'} · Completed: ${s.completedAt || 'n/a'}`,
    `- Baseline prompt: ${baseline.prompt || 'n/a'}`,
    `- Baseline score: ${baseline.score ?? 'n/a'} (source: ${baseline.source || 'n/a'})`,
    `- Timing: ${s.timing?.durationMinutes ?? '?'} min`,
    `- Behavior match: ${bm.label || bm.summary || JSON.stringify(bm) || 'n/a'}`,
    `- Accepted signals: ${sig || 'none'}`,
    `- Profile write: ${pw.summary || JSON.stringify(pw) || 'n/a'}`,
    s.receipt ? `- Receipt: ${s.receipt.receiptId || s.receipt.id || JSON.stringify(s.receipt).slice(0, 160)}` : '',
  ].filter(Boolean).join('\n');

  const facts = [
    `ReadTheRoom calibration session ${sid} completed with status ${s.status || 'unknown'}`,
    baseline.prompt ? `User's baseline calibration prompt: ${baseline.prompt}` : null,
    baseline.score != null ? `Baseline score was ${baseline.score} (source ${baseline.source || 'typed'})` : null,
    bm.label || bm.summary ? `Behavior match result: ${bm.label || bm.summary}` : null,
    sig ? `Accepted calibration signals: ${sig}` : null,
  ].filter(Boolean);

  return { title: `rtr-calibration-${sid}`, body, facts };
}

async function writeBlock(block) {
  const resp = await fetch(`${ML_BASE}/api/blocks/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: block.body,
      facts: block.facts,
      title: block.title,
      source: 'readtheroom',
    }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) throw new Error(`ML write failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function main() {
  if (!fs.existsSync(STORE)) {
    console.error(`Store not found: ${STORE}`);
    process.exit(2);
  }
  const store = readJson(STORE, { sessions: {} });
  const sessions = store.sessions || {};
  const ledger = loadLedger();
  const pending = Object.entries(sessions).filter(([sid, s]) => {
    const done = s.status === 'completed' || s.completedAt || s.profileWrite || s.behaviorMatch;
    const already = ledger.synced[sid];
    return done && !already;
  });

  console.log(`RTR store: ${STORE}`);
  console.log(`Sessions: ${Object.keys(sessions).length} total, ${pending.length} to sync to ML (${ML_BASE})`);
  if (DRY_RUN) console.log('DRY RUN — no writes.');

  const synced = [];
  for (const [sid, s] of pending) {
    const block = sessionToBlock(sid, s);
    if (DRY_RUN) {
      console.log(`  [dry] ${sid} → ${block.title} (${block.facts.length} facts)`);
      synced.push(sid);
      continue;
    }
    try {
      const res = await writeBlock(block);
      ledger.synced[sid] = { lib_id: res.lib_id, block_id: res.block_id, sha256: res.sha256, at: new Date().toISOString() };
      console.log(`  [ok] ${sid} → ${res.block_id} (lib ${res.lib_id}, sha ${String(res.sha256).slice(0, 12)}…)`);
      synced.push(sid);
    } catch (e) {
      console.error(`  [err] ${sid}: ${e.message}`);
    }
  }

  if (!DRY_RUN && synced.length) saveLedger(ledger);
  console.log(`Done: ${synced.length} session(s) ${DRY_RUN ? 'staged (dry-run)' : 'sealed into Memory Lane'}.`);
  console.log(`Ledger: ${LEDGER}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
