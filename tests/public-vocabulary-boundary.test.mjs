import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const ownFile = path.relative(root, new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1))).replaceAll('\\', '/');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.txt']);
const blockedDigests = new Set([
  'ce1114fdeca28e0d568c677ee70705dadf00cc82fe099078ae4a8762a0e3b98a',
  '3771d51a2f7b4474223f620d2a6b3c0ead5ca5e91ed1ae755e15aaa7a0d4f29b',
  'e30c8dfa28625339850bfab92ca666db7b8bacce97fca60420054da4f0d63eb5',
  '00860b2d04e6e076353c50c80960781ab0fd3484dfc10d43256921b9c440381e',
  '9ce00b27299cbd844c8a86508251fcdde9d040b9b1681ffd088580d489510628',
  '7236b195f987d63b2ee6b3082c0417cc571134f84ef849afbe7b53a3536132c1',
  '6cc5d974c0c9c39081be8953cebcb105d23a6328860f2286f10b6967db930c35',
  '11493c4dc06da87ead756609bc506bd2554a65180881e5623c6d2bd5a4c32343',
  'a8cc7381b5deac8e2591ef0ac6ab2f6e748392f6da5b1cbba0596eda65e98b1e',
  '386a85d8c88778b00b1355608363c7e3078857f3e9633cfd0802d3bf1c0b5b83',
  '8cfde6efdfc4ed5ab1f6acbbd1ba49bf31932f84d0a4c090eb41c7d151e8b180',
  '2ecbd698c141be27b26b3decd880367e938dd4921b52bbc081a65561b7c55aa1',
  'ca83ebffa52a314b0f8d0b997a7716c968f5527d27bba95b6a76609aa04f3c0b',
  '59458508a0827cff5f80ed091ebd8808fbe67c97357b58ca00a278e7359dec20',
  '404fcfb394d23199f6d95f1f36bd2beb6df8564f993f44517f6015fcd16101a9',
  'f73afc0bfd21f47115746c84d523e8e055d79a8d1ffac62a4c3b1d88e2f27e6e',
  '080ae5d921e649eb0c02701b346ffccb395b6e82701ba04ad02a0aa271416bfb',
  '59fac8225f15256c8d2457eb19137149281459037f26df4c5ace87842fbf18ce',
  '88461b6a65134d84b828f61ba0e7891ba3d07e9598d0079bba4e87c03fb3345d'
]);

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git') return [];
    const rel = path.posix.join(prefix, entry.name);
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, rel) : [rel];
  });
}

function candidates(text) {
  const tokens = String(text).toLowerCase().match(/[a-z0-9_.-]+/g) || [];
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  const values = new Set(tokens);
  for (let width = 2; width <= 4; width += 1) {
    for (let index = 0; index + width <= words.length; index += 1) {
      values.add(words.slice(index, index + width).join(' '));
    }
  }
  return values;
}

test('public source tree excludes non-public vocabulary', () => {
  const violations = [];
  for (const relative of walk(root)) {
    if (relative === ownFile || !textExtensions.has(path.extname(relative).toLowerCase())) continue;
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const candidate of candidates(text)) {
      if (blockedDigests.has(sha(candidate))) violations.push(`${relative}:${sha(candidate).slice(0, 12)}`);
    }
  }
  assert.deepEqual(violations, []);
});
