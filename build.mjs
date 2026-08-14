import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, 'web');
const DIST_DIR = join(__dirname, 'dist');
// const PAGE_SLUG = 'lcp-editor'; // dist used to nest under this
const EIDOLON_DATA_SRC = join(WEB_DIR, 'lcp-editor', 'eidolon-data.json');

function textHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

async function buildEditorPage() {
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });

  const entryPath = join(WEB_DIR, 'lcp-editor', 'lcp-editor.ts');
  const built = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: false,
    entryNames: '[name]',
    outdir: DIST_DIR,
    write: false,
    logLevel: 'silent',
  });
  if (built.errors.length > 0) {
    throw new Error(`lcp-editor: ${built.errors.map((e) => e.text).join('; ')}`);
  }

  const entryOutput = built.outputFiles.find((file) => file.path.endsWith('lcp-editor.js'));
  if (entryOutput === undefined) throw new Error('lcp-editor: esbuild produced no entry output');

  const chunks = [];
  for (const file of built.outputFiles) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.text, 'utf8');
    if (file !== entryOutput) chunks.push({ name: file.path.slice(DIST_DIR.length + 1), bytes: Buffer.byteLength(file.text) });
  }

  const css = readFileSync(join(WEB_DIR, 'lcp-editor.css'), 'utf8');
  writeFileSync(join(DIST_DIR, 'lcp-editor.css'), css, 'utf8');
  const cssVersion = textHash(css);
  const scriptVersion = textHash(entryOutput.text);

  const html = readFileSync(join(WEB_DIR, 'lcp-editor.html'), 'utf8')
    .replace('./lcp-editor.js', `./lcp-editor.js?v=${scriptVersion}`)
    .replace('./lcp-editor.css', `./lcp-editor.css?v=${cssVersion}`);
  writeFileSync(join(DIST_DIR, 'index.html'), html, 'utf8');

  cpSync(EIDOLON_DATA_SRC, join(DIST_DIR, 'eidolon.json'));

  console.log(`Built lcp-editor into ${DIST_DIR}`);
  console.log(`  / (${(entryOutput.text.length / 1024).toFixed(1)} KiB entry, ${scriptVersion})`);
  for (const chunk of chunks) console.log(`    ${chunk.name} (${(chunk.bytes / 1024).toFixed(1)} KiB)`);
  console.log('  /eidolon.json');
}

await buildEditorPage();
