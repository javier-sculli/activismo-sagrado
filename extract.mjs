import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { gunzipSync } from 'zlib';

const html = readFileSync('index.html', 'utf8');

function extractScript(type) {
  const open = `<script type="${type}">`;
  const start = html.indexOf(open);
  if (start === -1) throw new Error('missing ' + type);
  const from = start + open.length;
  const end = html.indexOf('</script>', from);
  return html.slice(from, end).trim();
}

const manifest = JSON.parse(extractScript('__bundler/manifest'));
const template = JSON.parse(extractScript('__bundler/template'));
let extResources = [];
try { extResources = JSON.parse(extractScript('__bundler/ext_resources')); } catch {}

mkdirSync('src', { recursive: true });
mkdirSync('src/assets', { recursive: true });

writeFileSync('src/template.html', template);
console.log('template.html written:', template.length, 'chars');

const extByUuid = Object.fromEntries(extResources.map(e => [e.uuid, e]));
const index = [];
for (const [uuid, entry] of Object.entries(manifest)) {
  let bytes = Buffer.from(entry.data, 'base64');
  if (entry.compressed) bytes = gunzipSync(bytes);
  const ext = (entry.mime || '').split('/')[1]?.split('+')[0] || 'bin';
  const meta = extByUuid[uuid];
  const name = `${uuid}.${ext}`;
  writeFileSync(`src/assets/${name}`, bytes);
  index.push({ uuid, mime: entry.mime, bytes: bytes.length, id: meta?.id, file: name });
}
writeFileSync('src/assets-index.json', JSON.stringify(index, null, 2));
console.log('assets written:', index.length);
console.log('mime breakdown:', index.reduce((a,x)=>{a[x.mime]=(a[x.mime]||0)+1;return a;},{}));
