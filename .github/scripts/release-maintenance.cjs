'use strict';
// Public repository maintenance only. Never bundled with the desktop app.
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const REPOSITORY = 'mfdesk/mfdesk.github.io';
const KEEP = 3; // Current version + two previous versions.
const MAX_BYTES = 512 * 1024 * 1024;

function version(tag) {
  const m = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:beta|diagnostic)\.(?:0|[1-9]\d*)))?$/.exec(tag);
  return m ? [BigInt(m[1]), BigInt(m[2]), BigInt(m[3]), m[4] || ''] : null;
}
function compare(a, b) {
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; }
  if (a[3] === b[3]) return 0;
  if (!a[3] || !b[3]) return !a[3] ? 1 : -1;
  const [ak, an] = a[3].split('.'), [bk, bn] = b[3].split('.');
  return ak !== bk ? (ak > bk ? 1 : -1) : BigInt(an) > BigInt(bn) ? 1 : -1;
}
function installer(release) {
  const v = version(release.tag_name);
  if (!v || release.draft !== false || release.prerelease !== Boolean(v[3]) ||
      !Number.isSafeInteger(release.id) || release.id <= 0 || !release.published_at) throw Error('Invalid published MFDesk release.');
  const name = `MFDesk-Setup-${release.tag_name.slice(1)}.exe`;
  const assets = release.assets;
  // Fail closed for unexpected attachments: do not remove unrelated user data.
  if (!Array.isArray(assets) || assets.length !== 1 || assets[0].name !== name) throw Error(`Unexpected assets: ${release.tag_name}`);
  const asset = assets[0];
  if (asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_BYTES ||
      !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || asset.browser_download_url !==
      `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${name}`) throw Error(`Invalid installer: ${release.tag_name}`);
  return asset;
}
function plan(releases) {
  if (!Array.isArray(releases)) throw Error('Invalid catalog.');
  const candidates = releases.filter(r => r.draft === false && version(r.tag_name));
  const ids = new Set(), tags = new Set();
  for (const r of candidates) {
    installer(r);
    if (ids.has(r.id) || tags.has(r.tag_name)) throw Error('Duplicate release.');
    ids.add(r.id); tags.add(r.tag_name);
  }
  candidates.sort((a, b) => compare(version(b.tag_name), version(a.tag_name)));
  const keep = candidates.slice(0, KEEP), remove = candidates.slice(KEEP);
  const current = keep.find(r => !r.tag_name.includes('-diagnostic.'));
  if (!current) throw Error('No normal desktop release in retained versions.');
  return { keep, remove, current };
}
function replaceDownload(text, old, next) {
  if (!text.includes(old.url)) return text;
  let updated = text.split(old.url).join(next.url).split(old.fileName).join(next.fileName)
    .split(old.sha256).join(next.sha256).split(old.version).join(next.version);
  if (old.bytes && next.bytes) {
    const before = Math.ceil(old.bytes / 1024 / 1024), after = Math.ceil(next.bytes / 1024 / 1024);
    // Exact server-rendered size patterns (plain HTML, RSC and RSC embedded in HTML).
    updated = updated.split(`<!-- -->${before}<!-- --> MB`).join(`<!-- -->${after}<!-- --> MB`)
      .split(`,${before}," MB"`).join(`,${after}," MB"`)
      .split(`,${before},\\" MB\\"`).join(`,${after},\\" MB\\"`);
  }
  return updated;
}
function signature(p) { return JSON.stringify([...p.keep, ...p.remove].map(r => [r.id, r.tag_name, installer(r).digest, installer(r).size])); }

async function api(route, method = 'GET') {
  if (!/^\/(releases(?:[/?]|$)|pages\/builds)/.test(route)) throw Error('Unsupported API operation.');
  const token = process.env.GH_TOKEN;
  if (!token) throw Error('Missing job token.');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${route}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MFDesk-release-maintenance' }
  });
  if (!response.ok) throw Error(`GitHub ${method} failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function catalog() {
  const result = [];
  for (let page = 1; page <= 20; page++) {
    const rows = await api(`/releases?per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw Error('Malformed release page.');
    result.push(...rows);
    if (rows.length < 100) return result;
  }
  throw Error('Release catalog too large; nothing will be deleted.');
}
async function verifyDownload(asset, fetchImpl = fetch) {
  let destination = asset.browser_download_url;
  for (let hop = 0; hop < 5; hop++) {
    const uri = new URL(destination);
    const initial = hop === 0;
    if (uri.protocol !== 'https:' || uri.username || uri.password || uri.port ||
        (initial ? uri.hostname !== 'github.com' || !uri.pathname.startsWith(`/${REPOSITORY}/releases/download/v`) :
          !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(uri.hostname))) throw Error('Unexpected installer redirect.');
    // Public binary requests NEVER receive the repository token.
    const response = await fetchImpl(destination, { redirect: 'manual', signal: AbortSignal.timeout(180000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      destination = new URL(response.headers.get('location'), destination).href;
      await response.body?.cancel();
      continue;
    }
    if (!response.ok || !response.body) throw Error('Installer unavailable.');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > asset.size || bytes > MAX_BYTES) throw Error('Installer too large.');
      hash.update(chunk);
    }
    if (bytes !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest.toLowerCase()) throw Error('Installer integrity mismatch.');
    return;
  }
  throw Error('Too many installer redirects.');
}
function updateDownloadMetadata(current) {
  const metadataPath = 'release.json';
  const old = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const asset = installer(current);
  const next = { version: current.tag_name.slice(1), url: asset.browser_download_url, fileName: asset.name, bytes: asset.size, sha256: asset.digest.slice(7).toUpperCase() };
  if (!version(`v${old.version}`) || old.fileName !== `MFDesk-Setup-${old.version}.exe` ||
      old.url !== `https://github.com/${REPOSITORY}/releases/download/v${old.version}/${old.fileName}` || !/^[A-F0-9]{64}$/.test(old.sha256)) throw Error('Invalid previous download metadata.');
  const files = ['index.html', 'index.rsc'];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error('Unexpected symbolic link.');
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith('.js') && fs.readFileSync(target, 'utf8').includes(old.url))
        throw Error('Download metadata moved into a hashed client bundle; rebuild the website first.');
    }
  }
  visit('_next');
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const updated = replaceDownload(text, old, next);
    if (updated !== text) fs.writeFileSync(file, updated);
  }
  const homepage = fs.readFileSync('index.html', 'utf8');
  if (!homepage.includes(next.url) || !homepage.includes(next.sha256)) throw Error('Homepage download not updated.');
  fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2) + '\n');
}
async function siteHasCurrent(p) {
  const response = await fetch('https://mfdesk.github.io/?release-check=' + Date.now(), { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) return false;
  const text = await response.text();
  return text.includes(installer(p.current).browser_download_url) && text.includes(installer(p.current).digest.slice(7).toUpperCase()) &&
    p.remove.every(r => !text.includes(installer(r).browser_download_url));
}
async function prune(p, { readPlan, verify, siteReady, readRelease, deleteRelease, log = console.log }) {
  await verify(installer(p.current));
  if (!await siteReady(p)) throw Error('Live download page not ready; nothing deleted.');
  let expected = signature(p);
  for (const target of p.remove) {
    if (signature(await readPlan()) !== expected) throw Error('Catalog changed concurrently; stopped before next deletion.');
    const fresh = await readRelease(target.id);
    if (fresh.id !== target.id || fresh.tag_name !== target.tag_name || installer(fresh).digest !== installer(target).digest ||
        installer(fresh).size !== installer(target).size) throw Error('Release changed; stopped.');
    log(`Delete release and installer: ${target.tag_name} (${target.id}); keep git tag.`);
    await deleteRelease(target.id); // DELETE release only, never git refs/tags, branches, account data or other repositories.
    p = { ...p, remove: p.remove.filter(r => r.id !== target.id) };
    expected = signature(p);
  }
}
async function main(mode) {
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== REPOSITORY) throw Error('Wrong repository.');
  const p = plan(await catalog());
  console.log(JSON.stringify({ keep: p.keep.map(r => r.tag_name), remove: p.remove.map(r => r.tag_name), download: p.current.tag_name }, null, 2));
  if (mode === 'plan') return;
  if (mode === 'prepare') {
    await verifyDownload(installer(p.current));
    updateDownloadMetadata(p.current);
  } else if (mode === 'wait-pages') {
    if (await siteHasCurrent(p)) return;
    await api('/pages/builds', 'POST');
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (await siteHasCurrent(p)) return;
    }
    throw Error('Pages deployment not verified; nothing deleted.');
  } else if (mode === 'prune') {
    await prune(p, { readPlan: async () => plan(await catalog()), verify: verifyDownload, siteReady: siteHasCurrent,
      readRelease: id => api(`/releases/${id}`), deleteRelease: id => api(`/releases/${id}`, 'DELETE') });
    const remaining = plan(await catalog());
    if (remaining.remove.length) throw Error('Retention not completed.');
  } else throw Error('Use plan, prepare, wait-pages or prune.');
}
module.exports = { version, compare, installer, plan, replaceDownload, verifyDownload, prune };
if (require.main === module) main(process.argv[2] || 'plan').catch(error => { console.error(error.message); process.exitCode = 1; });
