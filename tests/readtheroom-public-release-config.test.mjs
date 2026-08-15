import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const configPath = path.join(root, 'docs', 'release', 'readtheroom-public-pro.release.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const product = config.products?.[0];

function walkFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(prefix, entry.name);
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full, rel) : [rel];
  });
}

test('public release config is a focused explicit allowlist', () => {
  assert.equal(config.suite_id, 'readtheroom-public-pro-v3-4');
  assert.equal(config.release_gate, 'ready_with_disclosed_limits');
  assert.equal(config.products.length, 1);
  assert.equal(product.id, 'readtheroom-public-pro');
  assert.ok(product.allowlist.length >= 15);

  const sources = product.allowlist.map((entry) => entry.source);
  const destinations = product.allowlist.map((entry) => entry.destination);
  assert.equal(new Set(destinations).size, destinations.length, 'package destinations must be unique');
  assert.ok(sources.includes('scripts/read-the-room/readtheroomPublicServer.mjs'));
  assert.ok(sources.includes('scripts/read-the-room/readtheroomPolicy.js'));
  assert.ok(sources.includes('read-the-room-public-pro/package.runtime.json'));
  assert.ok(sources.every((source) => !/(?:^|\/)(?:data|state)(?:\/|$)/i.test(source)));

  for (const entry of product.allowlist) {
    const sourceExists = fs.existsSync(path.join(root, entry.source));
    const destinationExists = fs.existsSync(path.join(root, entry.destination));
    assert.ok(sourceExists || destinationExists, `missing mapped file: ${entry.source} -> ${entry.destination}`);
    assert.ok(!path.isAbsolute(entry.destination));
    assert.ok(!entry.destination.split('/').includes('..'));
  }
});

test('packaged runtime source excludes non-public identity and profile-discovery markers', () => {
  const runtimeSource = [
    fs.readFileSync(path.join(root, 'scripts', 'read-the-room', 'readtheroomPolicy.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'scripts', 'read-the-room', 'readtheroomPublicServer.mjs'), 'utf8')
  ].join('\n');
  for (const forbidden of [
    /\b(?:sourcePath|archetypeDir)\b/,
    /READ_THE_ROOM_PROFILE_PATH/i
  ]) {
    assert.doesNotMatch(runtimeSource, forbidden);
  }
});

test('every public product asset is intentionally mapped', () => {
  const actual = walkFiles(path.join(root, 'read-the-room-public-pro'))
    .map((relative) => `read-the-room-public-pro/${relative}`)
    .sort();
  const mapped = product.allowlist
    .filter((entry) => fs.existsSync(path.join(root, entry.source)))
    .map((entry) => entry.source)
    .filter((source) => source.startsWith('read-the-room-public-pro/'))
    .sort();
  assert.deepEqual(mapped, actual);
});

test('runtime package is dependency-free and starts only the standalone server', () => {
  const packageCandidates = [
    path.join(root, 'read-the-room-public-pro', 'package.runtime.json'),
    path.join(root, 'package.json')
  ];
  const runtimePackagePath = packageCandidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(runtimePackagePath, 'runtime package metadata must exist in source or remapped package layout');
  const packageJson = JSON.parse(fs.readFileSync(runtimePackagePath, 'utf8'));
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, 'module');
  assert.deepEqual(packageJson.dependencies || {}, {});
  assert.equal(packageJson.scripts.start, 'node scripts/read-the-room/readtheroomPublicServer.mjs');
  assert.match(packageJson.scripts.test, /readtheroom-public-standalone-server\.test\.mjs/);
});

test('runtime package carries the MIT license plus third-party font licenses', () => {
  const licenseCandidates = [
    path.join(root, 'read-the-room-public-pro', 'LICENSE.txt'),
    path.join(root, 'LICENSE.txt')
  ];
  const licensePath = licenseCandidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(licensePath, 'package-level license notice must exist');
  const notice = fs.readFileSync(licensePath, 'utf8');
  assert.match(notice, /2ndNatureAi/);
  assert.match(notice, /MIT License/i);
  assert.match(notice, /permission is hereby granted/i);
  assert.ok(fs.existsSync(path.join(root, 'read-the-room-public-pro', 'assets', 'fonts', 'OFL-Inter.txt')));
  assert.ok(fs.existsSync(path.join(root, 'read-the-room-public-pro', 'assets', 'fonts', 'OFL-JetBrains-Mono.txt')));
});

test('release capability matrix separates local package readiness from deployed HTTPS readiness', () => {
  const packageCapability = config.capabilities.find((entry) => entry.capability === 'Sterile explicit-allowlist deployment package');
  const deploymentCapability = config.capabilities.find((entry) => entry.capability === 'Real public HTTPS deployment');
  assert.equal(packageCapability.clean_extraction, 'PASS');
  assert.equal(packageCapability.public_claim, 'SUPPORTED');
  assert.equal(deploymentCapability.finding_class, 'transitional_architecture');
  assert.equal(deploymentCapability.clean_extraction, 'N/A');
  assert.equal(deploymentCapability.public_claim, 'SUPPORTED_WITH_LIMITS');
});
