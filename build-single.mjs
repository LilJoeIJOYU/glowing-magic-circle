import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname);
const buildDir = path.join(root, '.build');
const distDir = path.join(root, 'dist');

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(path.join(buildDir, 'node_modules', 'three', 'addons'), { recursive: true });

fs.copyFileSync(path.join(root, 'vendor', 'three', 'three.module.js'), path.join(buildDir, 'node_modules', 'three', 'three.module.js'));
fs.cpSync(path.join(root, 'vendor', 'three', 'addons'), path.join(buildDir, 'node_modules', 'three', 'addons'), { recursive: true });
fs.writeFileSync(path.join(buildDir, 'node_modules', 'three', 'package.json'), JSON.stringify({
  name: 'three',
  version: '0.160.1',
  type: 'module',
  main: './three.module.js',
  exports: {
    '.': './three.module.js',
    './addons/*': './addons/*'
  }
}, null, 2));

let mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
if (!mainSrc.includes("'assets/magic-circle.png'")) throw new Error('main.js 中未找到默认贴图引用');
mainSrc = mainSrc.replace("'assets/magic-circle.png'", "'__DEFAULT_TEXTURE__'");
fs.writeFileSync(path.join(buildDir, 'main.entry.js'), mainSrc);

execSync('npx --yes esbuild main.entry.js --bundle --format=iife --minify --outfile=bundle.js', { cwd: buildDir, stdio: 'inherit' });

let bundle = fs.readFileSync(path.join(buildDir, 'bundle.js'), 'utf8');
const png = fs.readFileSync(path.join(root, 'assets', 'magic-circle.png'));
const dataUri = 'data:image/png;base64,' + png.toString('base64');
if (!bundle.includes('__DEFAULT_TEXTURE__')) throw new Error('bundle 中未找到贴图占位符');
bundle = bundle.replace('__DEFAULT_TEXTURE__', () => dataUri);
bundle = bundle.replace(/<\/script/gi, () => '<\\/script');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

html = html.replace(/<script>\s*\/\/ 直接双击[\s\S]*?<\/script>\s*/, '');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css.trim()}\n</style>`);
html = html.replace('<script type="module" src="main.js"></script>', () => `<script>\n${bundle.trim()}\n</script>`);

if (html.includes('importmap') || html.includes('main.js') || html.includes('style.css')) throw new Error('HTML 内联不完整');

fs.mkdirSync(distDir, { recursive: true });
const out = path.join(distDir, '快捷发光魔法阵.html');
fs.writeFileSync(out, html);
console.log(`完成：${out}（${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB）`);
