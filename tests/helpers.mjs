import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as fflate from '../vendor/fflate.js';
import * as fzstd from '../vendor/fzstd.js';

const require = createRequire(import.meta.url);

/** sql-wasm.js is a CommonJS/UMD bundle; evaluate it as such regardless of package type. */
function loadSqlJs() {
  const file = fileURLToPath(new URL('../vendor/sql-wasm.js', import.meta.url));
  const module = { exports: {} };
  new Function('module', 'exports', 'require', '__filename', '__dirname', readFileSync(file, 'utf8'))(module, module.exports, require, file, file.replace(/\/[^/]+$/, ''));
  return module.exports;
}

export async function loadLibs() {
  const initSqlJs = loadSqlJs();
  const SQL = await initSqlJs({ locateFile: (f) => fileURLToPath(new URL('../vendor/' + f, import.meta.url)) });
  return { SQL, unzipSync: fflate.unzipSync, zipSync: fflate.zipSync, zstdDecompress: fzstd.decompress };
}
