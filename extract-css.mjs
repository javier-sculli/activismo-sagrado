// One-shot: pull the two inline <style> blocks out of public/index.html into
// public/site.css and replace them with a single <link>. Lets the course
// landing reuse the exact same brand CSS.
import { readFileSync, writeFileSync } from 'fs';

let html = readFileSync('public/index.html', 'utf8');
const start = html.indexOf('<style>');
const end = html.lastIndexOf('</style>') + '</style>'.length;
const chunk = html.slice(start, end);

const css = chunk
  .replace(/<\/style>\s*<style>/g, '\n\n')
  .replace(/^<style>/, '')
  .replace(/<\/style>$/, '');

writeFileSync('public/site.css', css);
html = html.slice(0, start) + '<link rel="stylesheet" href="site.css">' + html.slice(end);
writeFileSync('public/index.html', html);
console.log('site.css written:', css.length, 'chars');
