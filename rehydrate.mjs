// Rebuilds an editable static site from the extracted bundle.
// template.html references assets by raw UUID (in url("...") and src="...").
// We rewrite each UUID -> assets/<uuid>.<ext> and strip the SRI attributes the
// bundler added (they pointed at blob URLs; local same-origin files don't need them).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';

const template = readFileSync('src/template.html', 'utf8');
const index = JSON.parse(readFileSync('src/assets-index.json', 'utf8'));

mkdirSync('public/assets', { recursive: true });

let html = template;
for (const a of index) {
  // Replace every occurrence of the bare UUID with the real asset path.
  html = html.split(a.uuid).join('assets/' + a.file);
  copyFileSync('src/assets/' + a.file, 'public/assets/' + a.file);
}

// Strip integrity/crossorigin (hashes were for the bundled blobs).
html = html.replace(/\s+integrity="[^"]*"/gi, '').replace(/\s+crossorigin="[^"]*"/gi, '');

writeFileSync('public/index.html', html);
console.log('public/index.html written:', html.length, 'chars');
console.log('assets copied:', index.length);
const leftover = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
console.log('leftover UUID references:', leftover ? leftover.length : 0);
