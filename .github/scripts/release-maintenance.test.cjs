'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { plan, replaceDownload, verifyDownload, prune } = require('./release-maintenance.cjs');
function release(v, id) {
  return { id, tag_name: `v${v}`, draft: false, prerelease: v.includes('-'), published_at: '2026-09-14T00:00:00Z', assets: [{
    name: `MFDesk-Setup-${v}.exe`, state: 'uploaded', size: 3, digest: 'sha256:' + createHash('sha256').update('abc').digest('hex'),
    browser_download_url: `https://github.com/mfdesk/mfdesk.github.io/releases/download/v${v}/MFDesk-Setup-${v}.exe`
  }] };
}
function versions() { return ['2.2.0-beta.5','2.3.0-beta.1','2.3.1-diagnostic.1','2.3.2-beta.1','2.3.3-beta.1','2.3.5-beta.1'].map((v,i)=> release(v,i+1)); }
function harness(rows = versions()) {
  let current = structuredClone(rows); const deleted = [];
  const dependencies = {
    readPlan: async () => plan(current), verify: async () => {}, siteReady: async () => true,
    readRelease: async id => current.find(r => r.id === id),
    deleteRelease: async id => { deleted.push(id); current = current.filter(r => r.id !== id); }, log: () => {}
  };
  return { dependencies, deleted, rows: () => current };
}
test('current plus two previous, gaps and diagnostic versions included', () => {
  const p = plan(versions());
  assert.deepEqual(p.keep.map(r=>r.tag_name), ['v2.3.5-beta.1','v2.3.3-beta.1','v2.3.2-beta.1']);
  assert.equal(p.remove.length, 3);
});
test('semantic ordering, not creation date or lexicographic sorting', () => {
  const p = plan(['2.9.0','2.10.0-beta.2','2.10.0-beta.10','2.10.0'].map((v,i)=>release(v,i+1)));
  assert.deepEqual(p.keep.map(r=>r.tag_name), ['v2.10.0','v2.10.0-beta.10','v2.10.0-beta.2']);
});
test('fewer than four releases never delete', () => {
  for (let n=1; n<=3; n++) assert.equal(plan(versions().slice(0,n)).remove.length, 0);
});
test('drafts and unrelated releases remain untouched', () => {
  const draft = release('99.0.0',90); draft.draft = true;
  const p = plan([...versions(), draft, { id:91, tag_name:'website-preview', draft:false }]);
  assert.equal(p.keep[0].tag_name, 'v2.3.5-beta.1');
  assert.equal(p.remove.length, 3);
});
test('unexpected asset, missing digest and duplicate release fail closed', () => {
  const rows = versions(); rows[0].assets.push({ name: 'private-backup.zip' }); assert.throws(()=>plan(rows));
  const missing = versions(); delete missing[0].assets[0].digest; assert.throws(()=>plan(missing));
  assert.throws(()=>plan([...versions(), versions()[0]]));
});
test('download metadata replacement preserves unrelated historical text', () => {
  const old = { version:'2.3.0-beta.1', url:'https://github.com/old', fileName:'old.exe', sha256:'OLDHASH' };
  const next = { version:'2.3.5-beta.1', url:'https://github.com/new', fileName:'new.exe', sha256:'NEWHASH' };
  assert.equal(replaceDownload('Since 2.3.0-beta.1 supports accounts.', old, next), 'Since 2.3.0-beta.1 supports accounts.');
  assert.equal(replaceDownload('https://github.com/old old.exe OLDHASH 2.3.0-beta.1', old, next), 'https://github.com/new new.exe NEWHASH 2.3.5-beta.1');
});
test('public download hash and size are checked, no token forwarded', async () => {
  await verifyDownload(versions()[0].assets[0], async (_url, options) => {
    assert.equal(options.headers, undefined); return new Response('abc');
  });
  await assert.rejects(verifyDownload(versions()[0].assets[0], async ()=>new Response('abd')), /integrity/);
  await assert.rejects(verifyDownload(versions()[0].assets[0], async ()=>new Response('abcd')), /large/);
  await assert.rejects(verifyDownload(versions()[0].assets[0], async ()=>new Response('ab')), /integrity/);
});
test('external redirects rejected without fetching destination', async () => {
  let calls = 0;
  await assert.rejects(verifyDownload(versions()[0].assets[0], async () => {
    calls++; return new Response(null, {status:302,headers:{location:'https://untrusted.example/file.exe'}});
  }), /redirect/);
  assert.equal(calls,1);
});
test('pruning deletes only exact old IDs and is idempotent', async () => {
  const h = harness(); await prune(plan(h.rows()), h.dependencies);
  assert.deepEqual(h.deleted, [3,2,1]);
  await prune(plan(h.rows()), h.dependencies); assert.deepEqual(h.deleted, [3,2,1]);
  assert.equal(h.rows().length, 3);
});
test('integrity failure prevents all deletions', async () => {
  const h = harness(); h.dependencies.verify = async () => { throw Error('bad hash'); };
  await assert.rejects(prune(plan(h.rows()), h.dependencies)); assert.equal(h.deleted.length,0);
});
test('stale live homepage prevents all deletions', async () => {
  const h = harness(); h.dependencies.siteReady = async () => false;
  await assert.rejects(prune(plan(h.rows()), h.dependencies)); assert.equal(h.deleted.length,0);
});
test('concurrent release change prevents all deletions', async () => {
  const h = harness(); h.dependencies.readPlan = async () => plan([...h.rows(), release('2.3.6-beta.1', 99)]);
  await assert.rejects(prune(plan(h.rows()), h.dependencies), /concurrently/); assert.equal(h.deleted.length,0);
});
test('changed target prevents deletion', async () => {
  const h = harness(); h.dependencies.readRelease = async () => release('9.0.0',99);
  await assert.rejects(prune(plan(h.rows()), h.dependencies), /changed/); assert.equal(h.deleted.length,0);
});
test('failed delete aborts subsequent deletions', async () => {
  const h = harness(); let calls = 0; h.dependencies.deleteRelease = async () => { calls++; throw Error('denied'); };
  await assert.rejects(prune(plan(h.rows()), h.dependencies)); assert.equal(calls,1);
});
