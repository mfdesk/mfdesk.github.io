'use strict';
// Narrow static-export update: preserve all client bundles and unrelated page content.
// Keep existing RSC child indices: Android icons reference Windows icon nodes.
const assert = require('node:assert/strict');
const node = (tag, props, children) => ['$', tag, null, { ...props, children }];
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function render(n) {
  if (typeof n === 'string') return escape(n);
  assert.equal(n[0], '$'); assert.match(n[1], /^[a-z]+$/);
  const { children, ...props } = n[3];
  const attributes = Object.entries(props).map(([k,v]) => ` ${k === 'className' ? 'class' : k}="${escape(v)}"`).join('');
  return `<${n[1]}${attributes}>${(Array.isArray(children) && children[0] !== '$' ? children : [children]).map(render).join('')}</${n[1]}>`;
}
function details(setup, portable) {
  const selected = portable || setup;
  const text = portable
    ? 'Portable działa bez instalacji i nie dodaje usługi ani autostartu. Dane zapisuje na tym koncie Windows w folderze MFDesk-Portable. Udostępnianie wymaga uruchomionej aplikacji i zalogowanej sesji Windows. Dostęp po restarcie lub wylogowaniu wymaga instalacji. Portable i wersja instalowana mają osobne profile.'
    : 'Instalator wymaga uprawnień administratora. Dodaje usługę uruchamianą z Windows oraz regułę zapory.';
  const file = release => [node('p',{},release.fileName),node('p',{},`SHA-256: ${release.sha256}`)];
  return node('details',{className:'download-integrity'},[
    node('summary',{},'Przed uruchomieniem i dane plików'), node('p',{},text),
    node('p',{},'Pliki nie mają jeszcze podpisu wydawcy — Windows może je zablokować. Portable nie omija Smart App Control. Nie wyłączaj ochrony systemu, aby uruchomić aplikację.'),
    ...file(selected), ...(portable ? [node('p',{},'Instalator (osobna opcja):'),...file(setup)] : [])
  ]);
}
function secondary(setup) { return node('p',{id:'windows-installer'},node('a',{className:'text-link',href:setup.url},'Potrzebujesz autostartu? Pobierz instalator →')); }
function updateRsc(text, setup, portable) {
  let count = 0;
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value[0] === '$' && value[1] === 'article' && value[3]?.id === 'windows') {
      count++;
      const selected = portable || setup, c = value[3].children;
      assert.equal(c[5][1], 'a'); assert.equal(c[6][3].id,'windows-meta');
      c[5][3].href = selected.url;
      c[5][3].children[1] = portable ? 'Pobierz dla Windows — portable' : 'Pobierz dla Windows';
      c[6][3].children = ['Windows 10 / 11 · x64 · EXE · ',Math.ceil(selected.bytes/1048576),' MB'];
      c[7][3].children = ['Wersja ',selected.version];
      c[8] = details(setup,portable);
      if (portable) {
        if (c[9]) assert.equal(c[9][3]?.id,'windows-installer');
        c[9] = secondary(setup);
      }
      return;
    }
    for (const child of Object.values(value)) walk(child);
  }
  const result = text.split('\n').map(line => {
    const match = /^([a-f0-9]+:)([\[{].*)$/.exec(line.replace(/\r$/,''));
    if (!match || !line.includes('windows-title')) return line;
    const value = JSON.parse(match[2]); walk(value);
    return match[1]+JSON.stringify(value)+(line.endsWith('\r')?'\r':'');
  }).join('\n');
  assert(count <= 1, 'Duplicate Windows RSC article');
  return {text:result,count};
}
function updatePage(html, rsc, setup, portable) {
  for (const release of [setup,portable].filter(Boolean)) {
    assert.match(release.version,/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/);
    assert.match(release.sha256,/^[A-F0-9]{64}$/);
    assert(Number.isSafeInteger(release.bytes) && release.bytes>0);
    const kind = release === setup ? 'Setup' : 'Portable';
    assert.equal(release.fileName,`MFDesk-${kind}-${release.version}.exe`);
    assert.equal(release.url,`https://github.com/mfdesk/mfdesk.github.io/releases/download/v${release.version}/${release.fileName}`);
  }
  const selected=portable||setup;
  let articles=0, embedded=0;
  html = html.replace(/<article id="windows"[\s\S]*?<\/article>/g, article => {
    articles++;
    article = article.replace(/(<a class="primary-link download-button" href=")[^"]+("[^>]*>[\s\S]*?<\/svg>)[^<]+(<\/a>)/,
      (_,a,b,c)=>a+selected.url+b+(portable?'Pobierz dla Windows — portable':'Pobierz dla Windows')+c);
    article = article.replace(/(<p class="platform-meta" id="windows-meta">)[\s\S]*?(<\/p>)/,
      `$1Windows 10 / 11 · x64 · EXE · <!-- -->${Math.ceil(selected.bytes/1048576)}<!-- --> MB$2`);
    article = article.replace(/(<p class="release-version">)[\s\S]*?(<\/p>)/,`$1Wersja <!-- -->${selected.version}$2`);
    article = article.replace(/<details class="download-integrity">[\s\S]*?<\/details>/,render(details(setup,portable)));
    article = article.replace(/<p id="windows-installer">[\s\S]*?<\/p>/,'');
    if(portable) article=article.replace('</article>',render(secondary(setup))+'</article>');
    assert(article.includes(`href="${selected.url}"`));
    return article;
  });
  // vinext embeds each RSC record as a JSON string, not executable app source.
  html=html.replace(/(\.rsc\.push\()((?:"(?:[^"\\]|\\.)*"))(\))(?=<\/script>)/g,(_,a,json,b)=>{
    const updated=updateRsc(JSON.parse(json),setup,portable); embedded+=updated.count;
    return a+JSON.stringify(updated.text).replaceAll('<','\\u003c')+b;
  });
  const standalone=updateRsc(rsc,setup,portable);
  assert.equal(articles,1); assert.equal(embedded,1); assert.equal(standalone.count,1);
  return {html,rsc:standalone.text};
}
module.exports={updatePage};
