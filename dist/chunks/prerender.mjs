import { Worker } from 'worker_threads';
import { promises, existsSync, readFileSync, statSync, createWriteStream } from 'fs';
import { debounce } from 'perfect-debounce';
import { eventHandler, createError, createApp } from 'h3';
import httpProxy from 'http-proxy';
import { listen } from 'listhen';
import { servePlaceholder } from 'serve-placeholder';
import serveStatic from 'serve-static';
import { resolve, dirname, relative, normalize, isAbsolute, join, extname } from 'pathe';
import { withLeadingSlash, withoutTrailingSlash, withBase, joinURL, withTrailingSlash, parseURL } from 'ufo';
import { watch } from 'chokidar';
import { fileURLToPath, pathToFileURL } from 'url';
import chalk from 'chalk';
import { createHooks } from 'hookable';
import { createUnimport } from 'unimport';
import consola from 'consola';
import { loadConfig } from 'c12';
import { klona } from 'klona/full';
import { camelCase } from 'scule';
import defu from 'defu';
import { isTest, provider, isDebug, isWindows } from 'std-env';
import { isValidNodeImport, normalizeid, resolvePath as resolvePath$1, sanitizeFilePath } from 'mlly';
import { createRequire } from 'module';
import fse from 'fs-extra';
import 'jiti';
import { getProperty } from 'dot-prop';
import archiver from 'archiver';
import { globby, globbySync } from 'globby';
import { readPackageJSON } from 'pkg-types';
import { normalizeKey, createStorage as createStorage$1 } from 'unstorage';
import * as rollup from 'rollup';
import prettyBytes from 'pretty-bytes';
import { gzipSize } from 'gzip-size';
import { terser } from 'rollup-plugin-terser';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import alias from '@rollup/plugin-alias';
import json from '@rollup/plugin-json';
import wasmPlugin from '@rollup/plugin-wasm';
import inject from '@rollup/plugin-inject';
import { visualizer } from 'rollup-plugin-visualizer';
import * as unenv from 'unenv';
import unimportPlugin from 'unimport/unplugin';
import { hash } from 'ohash';
import _replace from '@rollup/plugin-replace';
import { nodeFileTrace } from '@vercel/nft';
import semver from 'semver';
import createEtag from 'etag';
import mime from 'mime';
import table from 'table';
import isPrimitive from 'is-primitive';
import { transform } from 'esbuild';
import { createFilter } from '@rollup/pluginutils';

async function printFSTree(dir) {
  if (isTest) {
    return;
  }
  const files = await globby("**/*.*", { cwd: dir, ignore: ["*.map"] });
  const items = (await Promise.all(files.map(async (file) => {
    const path = resolve(dir, file);
    const src = await promises.readFile(path);
    const size = src.byteLength;
    const gzip = await gzipSize(src);
    return { file, path, size, gzip };
  }))).sort((a, b) => b.path.localeCompare(a.path));
  let totalSize = 0;
  let totalGzip = 0;
  let totalNodeModulesSize = 0;
  let totalNodeModulesGzip = 0;
  items.forEach((item, index) => {
    dirname(item.file);
    const rpath = relative(process.cwd(), item.path);
    const treeChar = index === items.length - 1 ? "\u2514\u2500" : "\u251C\u2500";
    const isNodeModules = item.file.includes("node_modules");
    if (isNodeModules) {
      totalNodeModulesSize += item.size;
      totalNodeModulesGzip += item.gzip;
      return;
    }
    process.stdout.write(chalk.gray(`  ${treeChar} ${rpath} (${prettyBytes(item.size)}) (${prettyBytes(item.gzip)} gzip)
`));
    totalSize += item.size;
    totalGzip += item.gzip;
  });
  process.stdout.write(`${chalk.cyan("\u03A3 Total size:")} ${prettyBytes(totalSize + totalNodeModulesSize)} (${prettyBytes(totalGzip + totalNodeModulesGzip)} gzip)
`);
}

function hl(str) {
  return chalk.cyan(str);
}
function prettyPath(p, highlight = true) {
  p = relative(process.cwd(), p);
  return highlight ? hl(p) : p;
}
function compileTemplate(contents) {
  return (params) => contents.replace(/{{ ?([\w.]+) ?}}/g, (_, match) => {
    const val = getProperty(params, match);
    if (!val) {
      consola.warn(`cannot resolve template param '${match}' in ${contents.slice(0, 20)}`);
    }
    return val || `${match}`;
  });
}
async function writeFile$1(file, contents, log = false) {
  await fse.mkdirp(dirname(file));
  await fse.writeFile(file, contents, "utf-8");
  if (log) {
    consola.info("Generated", prettyPath(file));
  }
}
function resolvePath(path, nitroOptions, base) {
  if (typeof path !== "string") {
    throw new TypeError("Invalid path: " + path);
  }
  path = compileTemplate(path)(nitroOptions);
  for (const base2 in nitroOptions.alias) {
    if (path.startsWith(base2)) {
      path = nitroOptions.alias[base2] + path.substring(base2.length);
    }
  }
  return resolve(base || nitroOptions.srcDir, path);
}
const autodetectableProviders = {
  azure_static: "azure",
  netlify: "netlify",
  stormkit: "stormkit",
  vercel: "vercel"
};
function detectTarget() {
  return autodetectableProviders[provider];
}
async function isDirectory(path) {
  try {
    return (await fse.stat(path)).isDirectory();
  } catch (_err) {
    return false;
  }
}
createRequire(import.meta.url);
function serializeImportName(id) {
  return "_" + id.replace(/[^a-zA-Z0-9_$]/g, "_");
}
function resolveAliases(aliases) {
  for (const key in aliases) {
    for (const alias in aliases) {
      if (!["~", "@", "#"].includes(alias[0])) {
        continue;
      }
      if (alias === "@" && !aliases[key].startsWith("@/")) {
        continue;
      }
      if (aliases[key].startsWith(alias)) {
        aliases[key] = aliases[alias] + aliases[key].slice(alias.length);
      }
    }
  }
  return aliases;
}

let distDir = dirname(fileURLToPath(import.meta.url));
if (distDir.endsWith("chunks")) {
  distDir = dirname(distDir);
}
const pkgDir = resolve(distDir, distDir.endsWith("/chunks") ? "../.." : "..");
const runtimeDir = resolve(distDir, "runtime");

const NO_REPLACE_RE = /ROLLUP_NO_REPLACE/;
function replace(options) {
  const _plugin = _replace(options);
  return {
    ..._plugin,
    renderChunk(code, chunk, options2) {
      if (!NO_REPLACE_RE.test(code)) {
        return _plugin.renderChunk.call(this, code, chunk, options2);
      }
    }
  };
}

const PREFIX = "\0virtual:";
function virtual(modules, cache = {}) {
  const _modules = /* @__PURE__ */ new Map();
  for (const [id, mod] of Object.entries(modules)) {
    cache[id] = mod;
    _modules.set(id, mod);
    _modules.set(resolve(id), mod);
  }
  return {
    name: "virtual",
    resolveId(id, importer) {
      if (id in modules) {
        return PREFIX + id;
      }
      if (importer) {
        const importerNoPrefix = importer.startsWith(PREFIX) ? importer.slice(PREFIX.length) : importer;
        const resolved = resolve(dirname(importerNoPrefix), id);
        if (_modules.has(resolved)) {
          return PREFIX + resolved;
        }
      }
      return null;
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) {
        return null;
      }
      const idNoPrefix = id.slice(PREFIX.length);
      if (!_modules.has(idNoPrefix)) {
        return null;
      }
      let m = _modules.get(idNoPrefix);
      if (typeof m === "function") {
        m = await m();
      }
      cache[id.replace(PREFIX, "")] = m;
      return {
        code: m,
        map: null
      };
    }
  };
}

const PLUGIN_NAME = "dynamic-require";
const HELPER_DYNAMIC = `\0${PLUGIN_NAME}.mjs`;
const DYNAMIC_REQUIRE_RE = /import\("\.\/" ?\+(.*)\).then/g;
function dynamicRequire({ dir, ignore, inline }) {
  return {
    name: PLUGIN_NAME,
    transform(code, _id) {
      return {
        code: code.replace(DYNAMIC_REQUIRE_RE, `import('${HELPER_DYNAMIC}').then(r => r.default || r).then(dynamicRequire => dynamicRequire($1)).then`),
        map: null
      };
    },
    resolveId(id) {
      return id === HELPER_DYNAMIC ? id : null;
    },
    async load(_id) {
      if (_id !== HELPER_DYNAMIC) {
        return null;
      }
      let files = [];
      try {
        const wpManifest = resolve(dir, "./server.manifest.json");
        files = await import(pathToFileURL(wpManifest).href).then((r) => Object.keys(r.files).filter((file) => !ignore.includes(file)));
      } catch {
        files = await globby("**/*.{cjs,mjs,js}", { cwd: dir, absolute: false, ignore });
      }
      const chunks = (await Promise.all(files.map(async (id) => ({
        id,
        src: resolve(dir, id).replace(/\\/g, "/"),
        name: serializeImportName(id),
        meta: await getWebpackChunkMeta(resolve(dir, id))
      })))).filter((chunk) => chunk.meta);
      return inline ? TMPL_INLINE({ chunks }) : TMPL_LAZY({ chunks });
    }
  };
}
async function getWebpackChunkMeta(src) {
  const chunk = await import(pathToFileURL(src).href).then((r) => r.default || r || {});
  const { id, ids, modules } = chunk;
  if (!id && !ids) {
    return null;
  }
  return {
    id,
    ids,
    moduleIds: Object.keys(modules || {})
  };
}
function TMPL_INLINE({ chunks }) {
  return `${chunks.map((i) => `import * as ${i.name} from '${i.src}'`).join("\n")}
const dynamicChunks = {
  ${chunks.map((i) => ` ['${i.id}']: ${i.name}`).join(",\n")}
};

export default function dynamicRequire(id) {
  return Promise.resolve(dynamicChunks[id]);
};`;
}
function TMPL_LAZY({ chunks }) {
  return `
const dynamicChunks = {
${chunks.map((i) => ` ['${i.id}']: () => import('${i.src}')`).join(",\n")}
};

export default function dynamicRequire(id) {
  return dynamicChunks[id]();
};`;
}

function externals(opts) {
  const trackedExternals = /* @__PURE__ */ new Set();
  const _resolveCache = /* @__PURE__ */ new Map();
  const _resolve = async (id) => {
    let resolved = _resolveCache.get(id);
    if (resolved) {
      return resolved;
    }
    resolved = await resolvePath$1(id, {
      conditions: opts.exportConditions,
      url: opts.moduleDirectories
    });
    _resolveCache.set(id, resolved);
    return resolved;
  };
  return {
    name: "node-externals",
    async resolveId(originalId, importer, options) {
      if (!originalId || originalId.startsWith("\0") || originalId.includes("?") || originalId.startsWith("#")) {
        return null;
      }
      if (originalId.startsWith(".")) {
        return null;
      }
      const id = normalize(originalId);
      const idWithoutNodeModules = id.split("node_modules/").pop();
      if (opts.inline.find((i) => id.startsWith(i) || idWithoutNodeModules.startsWith(i))) {
        return null;
      }
      if (opts.external.find((i) => id.startsWith(i) || idWithoutNodeModules.startsWith(i))) {
        return { id, external: true };
      }
      const resolved = await this.resolve(originalId, importer, { ...options, skipSelf: true }) || { id };
      if (!existsSync(resolved.id)) {
        resolved.id = await _resolve(resolved.id).catch(() => resolved.id);
      }
      if (!await isValidNodeImport(resolved.id).catch(() => false)) {
        return null;
      }
      if (opts.trace === false) {
        return {
          ...resolved,
          id: normalizeid(resolved.id),
          external: true
        };
      }
      const { pkgName, subpath } = parseNodeModulePath(resolved.id);
      if (!pkgName) {
        return null;
      }
      if (pkgName !== originalId) {
        if (!isAbsolute(originalId)) {
          const fullPath = await _resolve(originalId);
          trackedExternals.add(fullPath);
          return {
            id: originalId,
            external: true
          };
        }
        const packageEntry = await _resolve(pkgName).catch(() => null);
        if (packageEntry !== originalId) {
          const guessedSubpath = pkgName + subpath.replace(/\.[a-z]+$/, "");
          const resolvedGuess = await _resolve(guessedSubpath).catch(() => null);
          if (resolvedGuess === originalId) {
            trackedExternals.add(resolvedGuess);
            return {
              id: guessedSubpath,
              external: true
            };
          }
          return null;
        }
      }
      trackedExternals.add(resolved.id);
      return {
        id: pkgName,
        external: true
      };
    },
    async buildEnd() {
      if (opts.trace === false) {
        return;
      }
      for (const pkgName of opts.traceInclude || []) {
        const path = await this.resolve(pkgName);
        if (path?.id) {
          trackedExternals.add(path.id);
        }
      }
      const tracedFiles = await nodeFileTrace(Array.from(trackedExternals), opts.traceOptions).then((r) => Array.from(r.fileList).map((f) => resolve(opts.traceOptions.base, f))).then((r) => r.filter((file) => file.includes("node_modules")));
      const packageJSONCache = /* @__PURE__ */ new Map();
      const getPackageJson = async (pkgDir) => {
        if (packageJSONCache.has(pkgDir)) {
          return packageJSONCache.get(pkgDir);
        }
        const pkgJSON = JSON.parse(await promises.readFile(resolve(pkgDir, "package.json"), "utf8"));
        packageJSONCache.set(pkgDir, pkgJSON);
        return pkgJSON;
      };
      const tracedPackages = /* @__PURE__ */ new Map();
      for (const file of tracedFiles) {
        const { baseDir, pkgName } = parseNodeModulePath(file);
        if (!pkgName) {
          continue;
        }
        const pkgDir = resolve(baseDir, pkgName);
        const existingPkgDir = tracedPackages.get(pkgName);
        if (existingPkgDir && existingPkgDir !== pkgDir) {
          const v1 = await getPackageJson(existingPkgDir).then((r) => r.version);
          const v2 = await getPackageJson(pkgDir).then((r) => r.version);
          if (semver.gte(v1, v2)) {
            continue;
          }
          if (semver.major(v1) !== semver.major(v2)) {
            console.warn(`Multiple major versions of package ${pkgName} are being externalized. Picking latest version.
` + [
              existingPkgDir + "@" + v1,
              pkgDir + "@" + v2
            ].map((p) => "  - " + p).join("\n"));
          }
        }
        tracedPackages.set(pkgName, pkgDir);
      }
      for (const pkgDir of tracedPackages.values()) {
        const pkgJSON = join(pkgDir, "package.json");
        if (!tracedFiles.includes(pkgJSON)) {
          tracedFiles.push(pkgJSON);
        }
      }
      const writeFile = async (file) => {
        if (!await isFile(file)) {
          return;
        }
        const src = resolve(opts.traceOptions.base, file);
        const { pkgName, subpath } = parseNodeModulePath(file);
        const dst = resolve(opts.outDir, `node_modules/${pkgName}/${subpath}`);
        await promises.mkdir(dirname(dst), { recursive: true });
        await promises.copyFile(src, dst);
      };
      if (process.platform === "win32") {
        for (const file of tracedFiles) {
          await writeFile(file);
        }
      } else {
        await Promise.all(tracedFiles.map(writeFile));
      }
      await promises.writeFile(resolve(opts.outDir, "package.json"), JSON.stringify({
        private: true,
        bundledDependencies: Array.from(tracedPackages.keys())
      }, null, 2), "utf8");
    }
  };
}
function parseNodeModulePath(path) {
  if (!path) {
    return {};
  }
  const match = /^(.+\/node_modules\/)([^@/]+|@[^/]+\/[^/]+)(\/?.*?)?$/.exec(normalize(path));
  if (!match) {
    return {};
  }
  const [, baseDir, pkgName, subpath] = match;
  return {
    baseDir,
    pkgName,
    subpath
  };
}
async function isFile(file) {
  try {
    const stat = await promises.stat(file);
    return stat.isFile();
  } catch (err) {
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

const TIMING = "globalThis.__timing__";
const iife = (code) => `(function() { ${code.trim()} })();`.replace(/\n/g, "");
const HELPER = iife(`
const start = () => Date.now();
const end = s => Date.now() - s;
const _s = {};
const metrics = [];
const logStart = id => { _s[id] = Date.now(); };
const logEnd = id => { const t = end(_s[id]); delete _s[id]; metrics.push([id, t]); console.debug('>', id + ' (' + t + 'ms)'); };
${TIMING} = { start, end, metrics, logStart, logEnd };
`);
const HELPERIMPORT = "import './timing.js';";
function timing(_opts = {}) {
  return {
    name: "timing",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "timing.js",
        source: HELPER
      });
    },
    renderChunk(code, chunk) {
      let name = chunk.fileName || "";
      name = name.replace(extname(name), "");
      const logName = name === "index" ? "Nitro Start" : "Load " + name;
      return {
        code: (chunk.isEntry ? HELPERIMPORT : "") + `${TIMING}.logStart('${logName}');` + code + `;${TIMING}.logEnd('${logName}');`,
        map: null
      };
    }
  };
}

function publicAssets(nitro) {
  const assets = {};
  const files = globbySync("**/*.*", { cwd: nitro.options.output.publicDir, absolute: false });
  const publicAssetBases = nitro.options.publicAssets.filter((dir) => !dir.fallthrough && dir.baseURL !== "/").map((dir) => dir.baseURL);
  for (const id of files) {
    let type = mime.getType(id) || "text/plain";
    if (type.startsWith("text")) {
      type += "; charset=utf-8";
    }
    const fullPath = resolve(nitro.options.output.publicDir, id);
    const etag = createEtag(readFileSync(fullPath));
    const stat = statSync(fullPath);
    assets["/" + decodeURIComponent(id)] = {
      type,
      etag,
      mtime: stat.mtime.toJSON(),
      path: relative(nitro.options.output.serverDir, fullPath)
    };
  }
  return virtual({
    "#internal/nitro/virtual/public-assets-data": `export default ${JSON.stringify(assets, null, 2)};`,
    "#internal/nitro/virtual/public-assets-node": `
import { promises as fsp } from 'fs'
import { resolve } from 'pathe'
import { dirname } from 'pathe'
import { fileURLToPath } from 'url'
import assets from '#internal/nitro/virtual/public-assets-data'
export function readAsset (id) {
  const serverDir = dirname(fileURLToPath(import.meta.url))
  return fsp.readFile(resolve(serverDir, assets[id].path))
}`,
    "#internal/nitro/virtual/public-assets": `
import assets from '#internal/nitro/virtual/public-assets-data'
${nitro.options.serveStatic ? 'export * from "#internal/nitro/virtual/public-assets-node"' : "export const readAsset = () => Promise(null)"}

export const publicAssetBases = ${JSON.stringify(publicAssetBases)}

export function isPublicAssetURL(id = '') {
  if (assets[id]) {
    return
  }
  for (const base of publicAssetBases) {
    if (id.startsWith(base)) { return true }
  }
  return false
}

export function getAsset (id) {
  return assets[id]
}
`
  }, nitro.vfs);
}

function serverAssets(nitro) {
  if (nitro.options.dev || nitro.options.preset === "nitro-prerender") {
    return virtual({ "#internal/nitro/virtual/server-assets": getAssetsDev(nitro) }, nitro.vfs);
  }
  return virtual({
    "#internal/nitro/virtual/server-assets": async () => {
      const assets = {};
      for (const asset of nitro.options.serverAssets) {
        const files = await globby("**/*.*", { cwd: asset.dir, absolute: false });
        for (const _id of files) {
          const fsPath = resolve(asset.dir, _id);
          const id = asset.baseName + "/" + _id;
          assets[id] = { fsPath, meta: {} };
          let type = mime.getType(id) || "text/plain";
          if (type.startsWith("text")) {
            type += "; charset=utf-8";
          }
          const etag = createEtag(await promises.readFile(fsPath));
          const mtime = await promises.stat(fsPath).then((s) => s.mtime.toJSON());
          assets[id].meta = { type, etag, mtime };
        }
      }
      return getAssetProd(assets);
    }
  }, nitro.vfs);
}
function getAssetsDev(nitro) {
  return `
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'

const serverAssets = ${JSON.stringify(nitro.options.serverAssets)}

export const assets = createStorage()

for (const asset of serverAssets) {
  assets.mount(asset.baseName, fsDriver({ base: asset.dir }))
}`;
}
function getAssetProd(assets) {
  return `
const _assets = {
${Object.entries(assets).map(([id, asset]) => `  ['${normalizeKey(id)}']: {
    import: () => import('raw:${asset.fsPath}').then(r => r.default || r),
    meta: ${JSON.stringify(asset.meta)}
  }`).join(",\n")}
}

${normalizeKey.toString()}

export const assets = {
  getKeys() {
    return Promise.resolve(Object.keys(_assets))
  },
  hasItem (id) {
    id = normalizeKey(id)
    return Promise.resolve(id in _assets)
  },
  getItem (id) {
    id = normalizeKey(id)
    return Promise.resolve(_assets[id] ? _assets[id].import() : null)
  },
  getMeta (id) {
    id = normalizeKey(id)
    return Promise.resolve(_assets[id] ? _assets[id].meta : {})
  }
}
`;
}

const unique = (arr) => Array.from(new Set(arr));
function handlers(nitro) {
  const getImportId = (p, lazy) => (lazy ? "_lazy_" : "_") + hash(p).slice(0, 6);
  let lastDump = "";
  return virtual({
    "#internal/nitro/virtual/server-handlers": () => {
      const handlers2 = [
        ...nitro.scannedHandlers,
        ...nitro.options.handlers
      ];
      if (nitro.options.serveStatic) {
        handlers2.unshift({ middleware: true, handler: "#internal/nitro/static" });
      }
      if (nitro.options.renderer) {
        handlers2.push({ route: "/**", lazy: true, handler: nitro.options.renderer });
      }
      if (isDebug) {
        const dumped = dumpHandler(handlers2);
        if (dumped !== lastDump) {
          lastDump = dumped;
          if (handlers2.length) {
            console.log(dumped);
          }
        }
      }
      const imports = unique(handlers2.filter((h) => !h.lazy).map((h) => h.handler));
      const lazyImports = unique(handlers2.filter((h) => h.lazy).map((h) => h.handler));
      const code = `
${imports.map((handler) => `import ${getImportId(handler)} from '${handler}';`).join("\n")}

${lazyImports.map((handler) => `const ${getImportId(handler, true)} = () => import('${handler}');`).join("\n")}

export const handlers = [
${handlers2.map((h) => `  { route: '${h.route || ""}', handler: ${getImportId(h.handler, h.lazy)}, lazy: ${!!h.lazy}, middleware: ${!!h.middleware}, method: ${JSON.stringify(h.method)} }`).join(",\n")}
];
  `.trim();
      return code;
    }
  }, nitro.vfs);
}
function dumpHandler(handler) {
  const data = handler.map(({ route, handler: handler2, ...props }) => {
    return [
      route && route !== "/" ? route : "*",
      relative(process.cwd(), handler2),
      dumpObject(props)
    ];
  });
  return table.table([
    ["Path", "Handler", "Options"],
    ...data
  ], {
    singleLine: true,
    border: table.getBorderCharacters("norc")
  });
}
function dumpObject(obj) {
  const items = [];
  for (const key in obj) {
    const val = obj[key];
    items.push(`${key}: ${isPrimitive(val) ? val : JSON.stringify(val)}`);
  }
  return items.join(", ");
}

const defaultLoaders = {
  ".ts": "ts",
  ".js": "js"
};
function esbuild(options) {
  const loaders = {
    ...defaultLoaders
  };
  if (options.loaders) {
    for (const key of Object.keys(options.loaders)) {
      const value = options.loaders[key];
      if (typeof value === "string") {
        loaders[key] = value;
      } else if (value === false) {
        delete loaders[key];
      }
    }
  }
  const extensions = Object.keys(loaders);
  const INCLUDE_REGEXP = new RegExp(`\\.(${extensions.map((ext) => ext.slice(1)).join("|")})$`);
  const EXCLUDE_REGEXP = /node_modules/;
  const filter = createFilter(options.include || INCLUDE_REGEXP, options.exclude || EXCLUDE_REGEXP);
  return {
    name: "esbuild",
    async transform(code, id) {
      if (!filter(id)) {
        return null;
      }
      const ext = extname(id);
      const loader = loaders[ext];
      if (!loader) {
        return null;
      }
      const result = await transform(code, {
        loader,
        target: options.target,
        define: options.define,
        sourcemap: options.sourceMap,
        sourcefile: id
      });
      printWarnings(id, result, this);
      return result.code && {
        code: result.code,
        map: result.map || null
      };
    },
    async renderChunk(code) {
      if (options.minify) {
        const result = await transform(code, {
          loader: "js",
          minify: true,
          target: options.target
        });
        if (result.code) {
          return {
            code: result.code,
            map: result.map || null
          };
        }
      }
      return null;
    }
  };
}
function printWarnings(id, result, plugin) {
  if (result.warnings) {
    for (const warning of result.warnings) {
      let message = "[esbuild]";
      if (warning.location) {
        message += ` (${relative(process.cwd(), id)}:${warning.location.line}:${warning.location.column})`;
      }
      message += ` ${warning.text}`;
      plugin.warn(message);
    }
  }
}

function raw(opts = {}) {
  const extensions = new Set([".md", ".mdx", ".yml", ".txt", ".css", ".htm", ".html"].concat(opts.extensions || []));
  return {
    name: "raw",
    resolveId(id) {
      if (id[0] === "\0") {
        return;
      }
      let isRawId = id.startsWith("raw:");
      if (isRawId) {
        id = id.substring(4);
      } else if (extensions.has(extname(id))) {
        isRawId = true;
      }
      if (isRawId) {
        return { id: "\0raw:" + id };
      }
    },
    load(id) {
      if (id.startsWith("\0raw:")) {
        return promises.readFile(id.substring(5), "utf8");
      }
    },
    transform(code, id) {
      if (id.startsWith("\0raw:")) {
        return {
          code: `// ROLLUP_NO_REPLACE 
 export default ${JSON.stringify(code)}`,
          map: null
        };
      }
    }
  };
}

const builtinDrivers = {
  fs: "unstorage/drivers/fs",
  http: "unstorage/drivers/http",
  memory: "unstorage/drivers/memory",
  redis: "unstorage/drivers/redis",
  "cloudflare-kv": "unstorage/drivers/cloudflare-kv"
};
async function createStorage(nitro) {
  const storage = createStorage$1();
  const mounts = {
    ...nitro.options.storage,
    ...nitro.options.devStorage
  };
  for (const [path, opts] of Object.entries(mounts)) {
    const driver = await import(builtinDrivers[opts.driver] || opts.driver).then((r) => r.default || r);
    storage.mount(path, driver(opts));
  }
  return storage;
}
async function snapshotStorage(nitro) {
  const data = {};
  const allKeys = Array.from(new Set(await Promise.all(nitro.options.bundledStorage.map((base) => nitro.storage.getKeys(base))).then((r) => r.flat())));
  await Promise.all(allKeys.map(async (key) => {
    data[key] = await nitro.storage.getItem(key);
  }));
  return data;
}

function storage(nitro) {
  const mounts = [];
  const isDevOrPrerender = nitro.options.dev || nitro.options.preset === "nitro-prerender";
  const storageMounts = isDevOrPrerender ? { ...nitro.options.storage, ...nitro.options.devStorage } : nitro.options.storage;
  for (const path in storageMounts) {
    const mount = storageMounts[path];
    mounts.push({
      path,
      driver: builtinDrivers[mount.driver] || mount.driver,
      opts: mount
    });
  }
  const driverImports = Array.from(new Set(mounts.map((m) => m.driver)));
  const bundledStorageCode = `
import { prefixStorage } from 'unstorage'
import overlay from 'unstorage/drivers/overlay'
import memory from 'unstorage/drivers/memory'

const bundledStorage = ${JSON.stringify(nitro.options.bundledStorage)}
for (const base of bundledStorage) {
  storage.mount(base, overlay({
    layers: [
      memory(),
      // TODO
      // prefixStorage(storage, base),
      prefixStorage(storage, 'assets:nitro:bundled:' + base)
    ]
  }))
}`;
  return virtual({
    "#internal/nitro/virtual/storage": `
import { createStorage } from 'unstorage'
import { assets } from '#internal/nitro/virtual/server-assets'

${driverImports.map((i) => `import ${serializeImportName(i)} from '${i}'`).join("\n")}

const storage = createStorage({})

export const useStorage = () => storage

storage.mount('/assets', assets)

${mounts.map((m) => `storage.mount('${m.path}', ${serializeImportName(m.driver)}(${JSON.stringify(m.opts)}))`).join("\n")}

${!isDevOrPrerender && nitro.options.bundledStorage.length ? bundledStorageCode : ""}
`
  }, nitro.vfs);
}

function importMeta(nitro) {
  const ImportMetaRe = /import\.meta|globalThis._importMeta_/;
  return {
    name: "import-meta",
    renderChunk(code, chunk) {
      const isEntry = chunk.isEntry;
      if (!isEntry && (!ImportMetaRe.test(code) || code.includes("ROLLUP_NO_REPLACE"))) {
        return;
      }
      const url = nitro.options.node && isEntry ? "_import_meta_url_" : '"file:///_entry.js"';
      const env = nitro.options.node ? "process.env" : "{}";
      const ref = "globalThis._importMeta_";
      const stub = `{url:${url},env:${env}}`;
      const stubInit = isEntry ? `${ref}=${stub};` : `${ref}=${ref}||${stub};`;
      return {
        code: stubInit + code,
        map: null
      };
    }
  };
}

const getRollupConfig = (nitro) => {
  const extensions = [".ts", ".mjs", ".js", ".json", ".node"];
  const nodePreset = nitro.options.node === false ? unenv.nodeless : unenv.node;
  const builtinPreset = {
    alias: {
      debug: "unenv/runtime/npm/debug",
      consola: "unenv/runtime/npm/consola",
      ...nitro.options.alias
    }
  };
  const env = unenv.env(nodePreset, builtinPreset, nitro.options.unenv);
  if (nitro.options.sourceMap) {
    env.polyfill.push("source-map-support/register.js");
  }
  const buildServerDir = join(nitro.options.buildDir, "dist/server");
  const runtimeAppDir = join(runtimeDir, "app");
  const rollupConfig = defu(nitro.options.rollupConfig, {
    input: nitro.options.entry,
    output: {
      dir: nitro.options.output.serverDir,
      entryFileNames: "index.mjs",
      chunkFileNames(chunkInfo) {
        let prefix = "";
        const modules = Object.keys(chunkInfo.modules);
        const lastModule = modules[modules.length - 1];
        if (lastModule.startsWith(buildServerDir)) {
          prefix = join("app", relative(buildServerDir, dirname(lastModule)));
        } else if (lastModule.startsWith(runtimeAppDir)) {
          prefix = "app";
        } else if (lastModule.startsWith(nitro.options.buildDir)) {
          prefix = "build";
        } else if (lastModule.startsWith(runtimeDir)) {
          prefix = "nitro";
        } else if (nitro.options.handlers.find((m) => lastModule.startsWith(m.handler))) {
          prefix = "handlers";
        } else if (lastModule.includes("assets") || lastModule.startsWith("\0raw:")) {
          prefix = "raw";
        } else if (lastModule.startsWith("\0")) {
          prefix = "rollup";
        }
        return join("chunks", prefix, "[name].mjs");
      },
      inlineDynamicImports: nitro.options.inlineDynamicImports,
      format: "esm",
      exports: "auto",
      intro: "",
      outro: "",
      preferConst: true,
      sanitizeFileName: sanitizeFilePath,
      sourcemap: nitro.options.sourceMap,
      sourcemapExcludeSources: true,
      sourcemapPathTransform(relativePath, sourcemapPath) {
        return resolve(dirname(sourcemapPath), relativePath);
      }
    },
    external: env.external,
    makeAbsoluteExternalsRelative: false,
    plugins: [],
    onwarn(warning, rollupWarn) {
      if (!["CIRCULAR_DEPENDENCY", "EVAL"].includes(warning.code) && !warning.message.includes("Unsupported source map comment")) {
        rollupWarn(warning);
      }
    },
    treeshake: {
      moduleSideEffects(id) {
        const normalizedId = normalize(id);
        const idWithoutNodeModules = normalizedId.split("node_modules/").pop();
        return nitro.options.moduleSideEffects.some((m) => normalizedId.startsWith(m) || idWithoutNodeModules.startsWith(m));
      }
    }
  });
  if (nitro.options.timing) {
    rollupConfig.plugins.push(timing());
  }
  if (nitro.options.autoImport) {
    rollupConfig.plugins.push(unimportPlugin.rollup(nitro.options.autoImport));
  }
  rollupConfig.plugins.push(raw());
  if (nitro.options.experimental.wasm) {
    rollupConfig.plugins.push(wasmPlugin());
  }
  const buildEnvVars = {
    NODE_ENV: nitro.options.dev ? "development" : nitro.options.preset === "nitro-prerender" ? "prerender" : "production",
    server: true,
    client: false,
    dev: String(nitro.options.dev),
    RUNTIME_CONFIG: nitro.options.runtimeConfig,
    DEBUG: nitro.options.dev
  };
  rollupConfig.plugins.push(importMeta(nitro));
  rollupConfig.plugins.push(replace({
    preventAssignment: true,
    values: {
      "typeof window": '"undefined"',
      _import_meta_url_: "import.meta.url",
      ...Object.fromEntries([".", ";", ")", "[", "]", "}", " "].map((d) => [`import.meta${d}`, `globalThis._importMeta_${d}`])),
      ...Object.fromEntries([";", "(", "{", "}", " ", "	", "\n"].map((d) => [`${d}global.`, `${d}globalThis.`])),
      ...Object.fromEntries(Object.entries(buildEnvVars).map(([key, val]) => [`process.env.${key}`, JSON.stringify(val)])),
      ...Object.fromEntries(Object.entries(buildEnvVars).map(([key, val]) => [`import.meta.env.${key}`, JSON.stringify(val)])),
      ...nitro.options.replace
    }
  }));
  rollupConfig.plugins.push(esbuild({
    target: "es2019",
    sourceMap: nitro.options.sourceMap,
    ...nitro.options.esbuild?.options
  }));
  rollupConfig.plugins.push(dynamicRequire({
    dir: resolve(nitro.options.buildDir, "dist/server"),
    inline: nitro.options.node === false || nitro.options.inlineDynamicImports,
    ignore: [
      "client.manifest.mjs",
      "server.js",
      "server.cjs",
      "server.mjs",
      "server.manifest.mjs"
    ]
  }));
  rollupConfig.plugins.push(serverAssets(nitro));
  rollupConfig.plugins.push(publicAssets(nitro));
  rollupConfig.plugins.push(storage(nitro));
  rollupConfig.plugins.push(handlers(nitro));
  rollupConfig.plugins.push(virtual({
    "#internal/nitro/virtual/polyfill": env.polyfill.map((p) => `import '${p}';`).join("\n")
  }, nitro.vfs));
  rollupConfig.plugins.push(virtual(nitro.options.virtual, nitro.vfs));
  rollupConfig.plugins.push(virtual({
    "#internal/nitro/virtual/plugins": `
${nitro.options.plugins.map((plugin) => `import _${hash(plugin)} from '${plugin}';`).join("\n")}

export const plugins = [
  ${nitro.options.plugins.map((plugin) => `_${hash(plugin)}`).join(",\n")}
]
    `
  }, nitro.vfs));
  let buildDir = nitro.options.buildDir;
  if (isWindows && nitro.options.externals?.trace === false) {
    buildDir = pathToFileURL(buildDir).href;
  }
  rollupConfig.plugins.push(alias({
    entries: resolveAliases({
      "#build": buildDir,
      "#internal/nitro/virtual/error-handler": nitro.options.errorHandler,
      "~": nitro.options.srcDir,
      "@/": nitro.options.srcDir,
      "~~": nitro.options.rootDir,
      "@@/": nitro.options.rootDir,
      ...env.alias
    })
  }));
  if (!nitro.options.noExternals) {
    rollupConfig.plugins.push(externals(defu(nitro.options.externals, {
      outDir: nitro.options.output.serverDir,
      moduleDirectories: nitro.options.nodeModulesDirs,
      external: [
        ...nitro.options.dev ? [nitro.options.buildDir] : []
      ],
      inline: [
        "#",
        "~",
        "@/",
        "~~",
        "@@/",
        "virtual:",
        runtimeDir,
        nitro.options.srcDir,
        ...nitro.options.handlers.map((m) => m.handler).filter((i) => typeof i === "string")
      ],
      traceOptions: {
        base: "/",
        processCwd: nitro.options.rootDir,
        exportsOnly: true
      },
      exportConditions: [
        "default",
        "module",
        "node",
        "import"
      ]
    })));
  } else {
    rollupConfig.plugins.push({
      name: "no-externals",
      async resolveId(id, from, options) {
        const resolved = await this.resolve(id, from, { ...options, skipSelf: true });
        if (!resolved || resolved.external) {
          throw new Error(`Cannot resolve ${JSON.stringify(id)} from ${JSON.stringify(from)} and externals are not allowed!`);
        }
      }
    });
  }
  rollupConfig.plugins.push(nodeResolve({
    extensions,
    preferBuiltins: !!nitro.options.node,
    rootDir: nitro.options.rootDir,
    moduleDirectories: ["node_modules"].concat(nitro.options.nodeModulesDirs),
    mainFields: ["main"],
    exportConditions: [
      "default",
      "module",
      "node",
      "import"
    ]
  }));
  rollupConfig.plugins.push(commonjs({
    esmExternals: (id) => !id.startsWith("unenv/"),
    requireReturnsDefault: "auto",
    ...nitro.options.commonJS
  }));
  rollupConfig.plugins.push(json());
  rollupConfig.plugins.push(inject(env.inject));
  if (nitro.options.minify) {
    rollupConfig.plugins.push(terser({
      mangle: {
        keep_fnames: true,
        keep_classnames: true
      },
      format: {
        comments: false
      }
    }));
  }
  if (nitro.options.analyze) {
    rollupConfig.plugins.push(visualizer({
      ...nitro.options.analyze,
      filename: nitro.options.analyze.filename.replace("{name}", "nitro"),
      title: "Nitro Server bundle stats"
    }));
  }
  return rollupConfig;
};

const GLOB_SCAN_PATTERN = "**/*.{ts,mjs,js,cjs}";
const httpMethodRegex = /\.(connect|delete|get|head|options|patch|post|put|trace)/;
async function scanHandlers(nitro) {
  const handlers = await Promise.all([
    scanMiddleware(nitro),
    scanRoutes(nitro, "api", "/api"),
    scanRoutes(nitro, "routes", "/")
  ]).then((r) => r.flat());
  nitro.scannedHandlers = handlers.flatMap((h) => h.handlers);
  return handlers;
}
function scanMiddleware(nitro) {
  return scanServerDir(nitro, "middleware", (file) => ({
    middleware: true,
    handler: file.fullPath
  }));
}
function scanRoutes(nitro, dir, prefix = "/") {
  return scanServerDir(nitro, dir, (file) => {
    let route = file.path.replace(/\.[a-zA-Z]+$/, "").replace(/\[\.\.\.\]/g, "**").replace(/\[\.\.\.(\w+)]/g, "**:$1").replace(/\[(\w+)\]/g, ":$1");
    route = withLeadingSlash(withoutTrailingSlash(withBase(route, prefix)));
    let method;
    const methodMatch = route.match(httpMethodRegex);
    if (methodMatch) {
      route = route.substring(0, methodMatch.index);
      method = methodMatch[1];
    }
    route = route.replace(/\/index$/, "");
    return {
      handler: file.fullPath,
      lazy: true,
      route,
      method
    };
  });
}
async function scanServerDir(nitro, name, mapper) {
  const dirs = nitro.options.scanDirs.map((dir) => join(dir, name));
  const files = await scanDirs(dirs);
  const handlers = files.map(mapper);
  return { dirs, files, handlers };
}
function scanDirs(dirs) {
  return Promise.all(dirs.map(async (dir) => {
    const fileNames = await globby(GLOB_SCAN_PATTERN, { cwd: dir, dot: true });
    return fileNames.map((fileName) => {
      return {
        dir,
        path: fileName,
        fullPath: resolve(dir, fileName)
      };
    }).sort((a, b) => b.path.localeCompare(a.path));
  })).then((r) => r.flat());
}

async function prepare(nitro) {
  await prepareDir(nitro.options.output.dir);
  await prepareDir(nitro.options.output.publicDir);
  await prepareDir(nitro.options.output.serverDir);
}
async function prepareDir(dir) {
  await promises.mkdir(dir, { recursive: true });
  await fse.emptyDir(dir);
}
async function copyPublicAssets(nitro) {
  for (const asset of nitro.options.publicAssets) {
    if (await isDirectory(asset.dir)) {
      await fse.copy(asset.dir, join(nitro.options.output.publicDir, asset.baseURL));
    }
  }
  nitro.logger.success("Generated public " + prettyPath(nitro.options.output.publicDir));
}
async function build(nitro) {
  const rollupConfig = getRollupConfig(nitro);
  await nitro.hooks.callHook("rollup:before", nitro);
  return nitro.options.dev ? _watch(nitro, rollupConfig) : _build(nitro, rollupConfig);
}
async function writeTypes(nitro) {
  const routeTypes = {};
  const middleware = [
    ...nitro.scannedHandlers,
    ...nitro.options.handlers
  ];
  for (const mw of middleware) {
    if (typeof mw.handler !== "string" || !mw.route) {
      continue;
    }
    const relativePath = relative(join(nitro.options.buildDir, "types"), mw.handler).replace(/\.[a-z]+$/, "");
    routeTypes[mw.route] = routeTypes[mw.route] || [];
    routeTypes[mw.route].push(`Awaited<ReturnType<typeof import('${relativePath}').default>>`);
  }
  let autoImportedTypes = [];
  if (nitro.unimport) {
    autoImportedTypes = [
      nitro.unimport.generateTypeDecarations({ exportHelper: false }).trim()
    ];
  }
  const lines = [
    "// Generated by nitro",
    "declare module 'nitropack' {",
    "  type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T",
    "  interface InternalApi {",
    ...Object.entries(routeTypes).map(([path, types]) => `    '${path}': ${types.join(" | ")}`),
    "  }",
    "}",
    ...autoImportedTypes,
    "export {}"
  ];
  await writeFile$1(join(nitro.options.buildDir, "types/nitro.d.ts"), lines.join("\n"));
  if (nitro.options.typescript.generateTsConfig) {
    const tsConfig = {
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Node",
        allowJs: true,
        resolveJsonModule: true,
        paths: nitro.options.typescript.internalPaths ? {
          "#internal/nitro": [
            join(runtimeDir, "index")
          ],
          "#internal/nitro/*": [
            join(runtimeDir, "*")
          ]
        } : {}
      },
      include: [
        "./nitro.d.ts",
        join(relative(join(nitro.options.buildDir, "types"), nitro.options.rootDir), "**/*"),
        ...nitro.options.srcDir !== nitro.options.rootDir ? [join(relative(join(nitro.options.buildDir, "types"), nitro.options.srcDir), "**/*")] : []
      ]
    };
    await writeFile$1(join(nitro.options.buildDir, "types/tsconfig.json"), JSON.stringify(tsConfig, null, 2));
  }
}
async function _snapshot(nitro) {
  if (!nitro.options.bundledStorage.length || nitro.options.preset === "nitro-prerender") {
    return;
  }
  const storageDir = resolve(nitro.options.buildDir, "snapshot");
  nitro.options.serverAssets.push({
    baseName: "nitro:bundled",
    dir: storageDir
  });
  const data = await snapshotStorage(nitro);
  await Promise.all(Object.entries(data).map(async ([path, contents]) => {
    if (typeof contents !== "string") {
      contents = JSON.stringify(contents);
    }
    const fsPath = join(storageDir, path.replace(/:/g, "/"));
    await promises.mkdir(dirname(fsPath), { recursive: true });
    await promises.writeFile(fsPath, contents, "utf8");
  }));
}
async function _build(nitro, rollupConfig) {
  await scanHandlers(nitro);
  await writeTypes(nitro);
  await _snapshot(nitro);
  nitro.logger.start("Building server...");
  const build2 = await rollup.rollup(rollupConfig).catch((error) => {
    nitro.logger.error("Rollup error: " + error.message);
    throw error;
  });
  nitro.logger.start("Writing server bundle...");
  await build2.write(rollupConfig.output);
  const nitroConfigPath = resolve(nitro.options.output.dir, "nitro.json");
  const buildInfo = {
    date: new Date(),
    preset: nitro.options.preset,
    commands: {
      preview: nitro.options.commands.preview,
      deploy: nitro.options.commands.deploy
    },
    output: {
      serverDir: relative(nitro.options.output.dir, nitro.options.output.serverDir),
      publicDir: relative(nitro.options.output.dir, nitro.options.output.publicDir)
    }
  };
  await writeFile$1(nitroConfigPath, JSON.stringify(buildInfo, null, 2));
  nitro.logger.success("Server built");
  if (nitro.options.logLevel > 1) {
    await printFSTree(nitro.options.output.serverDir);
  }
  await nitro.hooks.callHook("compiled", nitro);
  const rOutput = relative(process.cwd(), nitro.options.output.dir);
  const rewriteRelativePaths = (input) => {
    return input.replace(/\s\.\/([^\s]*)/g, ` ${rOutput}/$1`);
  };
  if (buildInfo.commands.preview) {
    nitro.logger.success(`You can preview this build using \`${rewriteRelativePaths(buildInfo.commands.preview)}\``);
  }
  if (buildInfo.commands.deploy) {
    nitro.logger.success(`You can deploy this build using \`${rewriteRelativePaths(buildInfo.commands.deploy)}\``);
  }
}
function startRollupWatcher(nitro, rollupConfig) {
  const watcher = rollup.watch(defu(rollupConfig, {
    watch: {
      chokidar: nitro.options.watchOptions
    }
  }));
  let start;
  watcher.on("event", (event) => {
    switch (event.code) {
      case "START":
        return;
      case "BUNDLE_START":
        start = Date.now();
        return;
      case "END":
        nitro.hooks.callHook("compiled", nitro);
        nitro.logger.success("Nitro built", start ? `in ${Date.now() - start} ms` : "");
        nitro.hooks.callHook("dev:reload");
        return;
      case "ERROR":
        nitro.logger.error("Rollup error: ", event.error);
    }
  });
  return watcher;
}
async function _watch(nitro, rollupConfig) {
  let rollupWatcher;
  const reload = debounce(async () => {
    if (rollupWatcher) {
      await rollupWatcher.close();
    }
    await scanHandlers(nitro);
    rollupWatcher = startRollupWatcher(nitro, rollupConfig);
    await writeTypes(nitro);
  });
  const watchPatterns = nitro.options.scanDirs.flatMap((dir) => [
    join(dir, "api"),
    join(dir, "routes"),
    join(dir, "middleware", GLOB_SCAN_PATTERN)
  ]);
  const watchReloadEvents = /* @__PURE__ */ new Set(["add", "addDir", "unlink", "unlinkDir"]);
  const reloadWacher = watch(watchPatterns, { ignoreInitial: true }).on("all", (event) => {
    if (watchReloadEvents.has(event)) {
      reload();
    }
  });
  nitro.hooks.hook("close", () => {
    rollupWatcher.close();
    reloadWacher.close();
  });
  await reload();
}

function defineNitroPreset(preset) {
  return preset;
}

const awsLambda = defineNitroPreset({
  entry: "#internal/nitro/entries/aws-lambda",
  externals: true
});

const awsLambdaEdge = defineNitroPreset({
  entry: "#internal/nitro/entries/aws-lambda-edge",
  externals: true,
  commands: {
    deploy: "cd ./cdk && APP_ID=<your app id> npm run deploy"
  },
  hooks: {
    async "compiled"(nitro) {
      await generateCdkApp(nitro);
    }
  }
});
async function generateCdkApp(nitro) {
  const cdkDir = resolve(nitro.options.output.dir, "cdk");
  await promises.mkdir(resolve(nitro.options.output.dir, "cdk"));
  await writeFile$1(resolve(cdkDir, "bin/nitro-lambda-edge.ts"), entryTemplate$1());
  await writeFile$1(resolve(cdkDir, "lib/nitro-asset.ts"), nitroAssetTemplate());
  await writeFile$1(resolve(cdkDir, "lib/nitro-lambda-edge-stack.ts"), nitroLambdaEdgeStackTemplate());
  await writeFile$1(resolve(cdkDir, "package.json"), JSON.stringify({
    private: true,
    scripts: {
      deploy: "npm install && cdk deploy"
    },
    devDependencies: {
      "@types/node": "18",
      "aws-cdk": "^2",
      "ts-node": "^10.7.0",
      typescript: "~3.9.7"
    },
    dependencies: {
      "aws-cdk-lib": "^2",
      constructs: "^10.0.0",
      "source-map-support": "^0.5.21"
    }
  }));
  await writeFile$1(resolve(cdkDir, "cdk.json"), JSON.stringify({
    app: "npx ts-node --prefer-ts-exts bin/nitro-lambda-edge.ts"
  }));
  await writeFile$1(resolve(cdkDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2018",
      module: "commonjs",
      lib: ["es2018"],
      declaration: true,
      strict: true,
      noImplicitAny: true,
      strictNullChecks: true,
      noImplicitThis: true,
      alwaysStrict: true,
      noUnusedLocals: false,
      noUnusedParameters: false,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: false,
      inlineSourceMap: true,
      inlineSources: true,
      experimentalDecorators: true,
      strictPropertyInitialization: false,
      typeRoots: ["./node_modules/@types"]
    },
    exclude: ["node_modules", "cdk.out"]
  }));
}
function entryTemplate$1() {
  return `
#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NitroLambdaEdgeStack } from "../lib/nitro-lambda-edge-stack";

if (!process.env.APP_ID) {
  throw new Error("$APP_ID is not set. Please rerun after set that.");
}

const app = new cdk.App();
new NitroLambdaEdgeStack(app, process.env.APP_ID, {
  env: {
    region: process.env.REGION ?? "us-east-1",
  },
});
`.trim();
}
function nitroLambdaEdgeStackTemplate() {
  return `
import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deployment from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { NitroAsset } from "./nitro-asset";

export class NitroLambdaEdgeStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const nitro = new NitroAsset(this, "NitroAsset", {
      path: "../../",
      exclude: ["cdk"],
    });
    const edgeFunction = new cloudfront.experimental.EdgeFunction(
      this,
      "EdgeFunction",
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        handler: "index.handler",
        code: nitro.serverHandler,
      }
    );
    const bucket = new s3.Bucket(this, "Bucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const s3Origin = new origins.S3Origin(bucket);
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: s3Origin,
        edgeLambdas: [
          {
            functionVersion: edgeFunction.currentVersion,
            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
          },
        ],
      },
      additionalBehaviors: nitro.staticAsset.resolveCloudFrontBehaviors({
        resolve: () => ({
          origin: s3Origin,
        }),
      }),
    });
    new s3deployment.BucketDeployment(this, "Deployment", {
      sources: [nitro.staticAsset],
      destinationBucket: bucket,
      distribution,
    });
    new CfnOutput(this, "URL", {
      value: \`https://\${distribution.distributionDomainName}\`,
    });
  }
}
`.trim();
}
function nitroAssetTemplate() {
  return `
import { AssetCode, Code } from "aws-cdk-lib/aws-lambda";
import { Asset, AssetProps } from "aws-cdk-lib/aws-s3-assets";
import {
  DeploymentSourceContext,
  ISource,
  Source,
  SourceConfig,
} from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";
import { BehaviorOptions } from "aws-cdk-lib/aws-cloudfront";

export interface CloudFrontBehaviorResolver {
  resolve: (key: string) => BehaviorOptions;
}

export class NitroStaticAsset implements ISource {
  public readonly directories: string[];
  public readonly files: string[];
  private readonly source: ISource;
  constructor(publicDir: string) {
    const objects = fs.readdirSync(publicDir);
    this.directories = objects.filter((obj) =>
      fs.statSync(path.join(publicDir, obj)).isDirectory()
    );
    this.files = objects.filter((obj) =>
      fs.statSync(path.join(publicDir, obj)).isFile()
    );
    if (!objects.length) {
      fs.writeFileSync(path.join(publicDir, "dotfile"), "");
    }
    this.source = Source.asset(publicDir);
  }

  bind(
    scope: Construct,
    context?: DeploymentSourceContext | undefined
  ): SourceConfig {
    return this.source.bind(scope, context);
  }

  resolveCloudFrontBehaviors(
    resolver: CloudFrontBehaviorResolver
  ): Record<string, BehaviorOptions> {
    return {
      ...this.directories.reduce<Record<string, BehaviorOptions>>(
        (acc, obj) => ({
          ...acc,
          [\`\${obj}/*\`]: resolver.resolve(obj),
        }),
        {}
      ),
      ...this.files.reduce<Record<string, BehaviorOptions>>(
        (acc, obj) => ({
          ...acc,
          [obj]: resolver.resolve(obj),
        }),
        {}
      ),
    };
  }
}

interface NitroJSON {
  date: string;
  preset: string;
  commands: {
    preview?: string;
    deploy?: string;
  };
  output: {
    serverDir: string;
    publicDir: string;
  };
}

export class NitroAsset extends Construct {
  readonly serverHandler: AssetCode;
  readonly staticAsset: NitroStaticAsset;

  constructor(scope: Construct, id: string, props: AssetProps) {
    super(scope, id);
    const nitroOutput = new Asset(this, "NitroOutput", props);
    const nitroJSON = JSON.parse(
      fs
        .readFileSync(
          path.join("cdk.out", nitroOutput.assetPath, ".output/nitro.json")
        )
        .toString()
    ) as NitroJSON;

    this.serverHandler = Code.fromAsset(
      path.join("cdk.out", nitroOutput.assetPath, ".output", nitroJSON.output.serverDir)
    );
    this.staticAsset = new NitroStaticAsset(
      path.join("cdk.out", nitroOutput.assetPath, ".output", nitroJSON.output.publicDir)
    );
  }
}
`.trim();
}

const azureFunctions = defineNitroPreset({
  serveStatic: true,
  entry: "#internal/nitro/entries/azure-functions",
  externals: true,
  commands: {
    deploy: "az functionapp deployment source config-zip -g <resource-group> -n <app-name> --src {{ output.dir }}/deploy.zip"
  },
  hooks: {
    async "compiled"(ctx) {
      await writeRoutes$3(ctx);
    }
  }
});
function zipDirectory(dir, outfile) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const stream = createWriteStream(outfile);
  return new Promise((resolve2, reject) => {
    archive.directory(dir, false).on("error", (err) => reject(err)).pipe(stream);
    stream.on("close", () => resolve2(void 0));
    archive.finalize();
  });
}
async function writeRoutes$3(nitro) {
  const host = {
    version: "2.0",
    extensions: { http: { routePrefix: "" } }
  };
  const functionDefinition = {
    entryPoint: "handle",
    bindings: [
      {
        authLevel: "anonymous",
        type: "httpTrigger",
        direction: "in",
        name: "req",
        route: "{*url}",
        methods: [
          "delete",
          "get",
          "head",
          "options",
          "patch",
          "post",
          "put"
        ]
      },
      {
        type: "http",
        direction: "out",
        name: "res"
      }
    ]
  };
  await writeFile$1(resolve(nitro.options.output.serverDir, "function.json"), JSON.stringify(functionDefinition));
  await writeFile$1(resolve(nitro.options.output.dir, "host.json"), JSON.stringify(host));
  await zipDirectory(nitro.options.output.dir, join(nitro.options.output.dir, "deploy.zip"));
}

const azure = defineNitroPreset({
  entry: "#internal/nitro/entries/azure",
  externals: true,
  output: {
    serverDir: "{{ output.dir }}/server/functions"
  },
  commands: {
    preview: "npx @azure/static-web-apps-cli start ./public --api-location ./server"
  },
  hooks: {
    async "compiled"(ctx) {
      await writeRoutes$2(ctx);
    }
  }
});
async function writeRoutes$2(nitro) {
  const host = {
    version: "2.0"
  };
  let nodeVersion = "16";
  try {
    const currentNodeVersion = fse.readJSONSync(join(nitro.options.rootDir, "package.json")).engines.node;
    if (["16", "14"].includes(currentNodeVersion)) {
      nodeVersion = currentNodeVersion;
    }
  } catch {
    const currentNodeVersion = process.versions.node.slice(0, 2);
    if (["16", "14"].includes(currentNodeVersion)) {
      nodeVersion = currentNodeVersion;
    }
  }
  const config = {
    platform: {
      apiRuntime: `node:${nodeVersion}`
    },
    routes: [],
    navigationFallback: {
      rewrite: "/api/server"
    }
  };
  const indexPath = resolve(nitro.options.output.publicDir, "index.html");
  const indexFileExists = fse.existsSync(indexPath);
  if (!indexFileExists) {
    config.routes.unshift({
      route: "/index.html",
      redirect: "/"
    }, {
      route: "/",
      rewrite: "/api/server"
    });
  }
  const folderFiles = await globby([
    join(nitro.options.output.publicDir, "index.html"),
    join(nitro.options.output.publicDir, "**/index.html")
  ]);
  const prefix = nitro.options.output.publicDir.length;
  const suffix = "/index.html".length;
  folderFiles.forEach((file) => config.routes.unshift({
    route: file.slice(prefix, -suffix) || "/",
    rewrite: file.slice(prefix)
  }));
  const otherFiles = await globby([join(nitro.options.output.publicDir, "**/*.html"), join(nitro.options.output.publicDir, "*.html")]);
  otherFiles.forEach((file) => {
    if (file.endsWith("index.html")) {
      return;
    }
    const route = file.slice(prefix, ".html".length);
    const existingRouteIndex = config.routes.findIndex((_route) => _route.route === route);
    if (existingRouteIndex > -1) {
      config.routes.splice(existingRouteIndex, 1);
    }
    config.routes.unshift({
      route,
      rewrite: file.slice(prefix)
    });
  });
  const functionDefinition = {
    entryPoint: "handle",
    bindings: [
      {
        authLevel: "anonymous",
        type: "httpTrigger",
        direction: "in",
        name: "req",
        route: "{*url}",
        methods: ["delete", "get", "head", "options", "patch", "post", "put"]
      },
      {
        type: "http",
        direction: "out",
        name: "res"
      }
    ]
  };
  await writeFile$1(resolve(nitro.options.output.serverDir, "function.json"), JSON.stringify(functionDefinition));
  await writeFile$1(resolve(nitro.options.output.serverDir, "../host.json"), JSON.stringify(host));
  const stubPackageJson = resolve(nitro.options.output.serverDir, "../package.json");
  await writeFile$1(stubPackageJson, JSON.stringify({ private: true }));
  await writeFile$1(resolve(nitro.options.rootDir, "staticwebapp.config.json"), JSON.stringify(config));
  if (!indexFileExists) {
    await writeFile$1(indexPath, "");
  }
}

const baseWorker = defineNitroPreset({
  entry: null,
  node: false,
  minify: true,
  noExternals: true,
  rollupConfig: {
    output: {
      format: "iife"
    }
  },
  inlineDynamicImports: true
});

const cloudflare = defineNitroPreset({
  extends: "base-worker",
  entry: "#internal/nitro/entries/cloudflare",
  commands: {
    preview: "npx miniflare ./server/index.mjs --site ./public",
    deploy: "cd ./server && npx wrangler publish"
  },
  hooks: {
    async "compiled"(nitro) {
      await writeFile$1(resolve(nitro.options.output.dir, "package.json"), JSON.stringify({ private: true, main: "./server/index.mjs" }, null, 2));
      await writeFile$1(resolve(nitro.options.output.dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 1 }, null, 2));
    }
  }
});

const digitalOcean = defineNitroPreset({
  extends: "node-server"
});

const firebase = defineNitroPreset({
  entry: "#internal/nitro/entries/firebase",
  externals: true,
  commands: {
    deploy: "npx firebase deploy"
  },
  hooks: {
    async "compiled"(ctx) {
      await writeRoutes$1(ctx);
    }
  }
});
async function writeRoutes$1(nitro) {
  if (!fse.existsSync(join(nitro.options.rootDir, "firebase.json"))) {
    const firebase2 = {
      functions: {
        source: relative(nitro.options.rootDir, nitro.options.output.serverDir)
      },
      hosting: [
        {
          site: "<your_project_id>",
          public: relative(nitro.options.rootDir, nitro.options.output.publicDir),
          cleanUrls: true,
          rewrites: [
            {
              source: "**",
              function: "server"
            }
          ]
        }
      ]
    };
    await writeFile$1(resolve(nitro.options.rootDir, "firebase.json"), JSON.stringify(firebase2));
  }
  const _require = createRequire(import.meta.url);
  const jsons = await globby(join(nitro.options.output.serverDir, "node_modules/**/package.json"));
  const prefixLength = `${nitro.options.output.serverDir}/node_modules/`.length;
  const suffixLength = "/package.json".length;
  const dependencies = jsons.reduce((obj, packageJson) => {
    const dirname = packageJson.slice(prefixLength, -suffixLength);
    if (!dirname.includes("node_modules")) {
      obj[dirname] = _require(packageJson).version;
    }
    return obj;
  }, {});
  let nodeVersion = "14";
  try {
    const currentNodeVersion = fse.readJSONSync(join(nitro.options.rootDir, "package.json")).engines.node;
    if (["16", "14"].includes(currentNodeVersion)) {
      nodeVersion = currentNodeVersion;
    }
  } catch {
    const currentNodeVersion = process.versions.node.slice(0, 2);
    if (["16", "14"].includes(currentNodeVersion)) {
      nodeVersion = currentNodeVersion;
    }
  }
  const getPackageVersion = async (id) => {
    const pkg = await readPackageJSON(id, { url: nitro.options.nodeModulesDirs });
    return pkg.version;
  };
  await writeFile$1(resolve(nitro.options.output.serverDir, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    main: "./index.mjs",
    dependencies: {
      "firebase-functions-test": "latest",
      "firebase-admin": await getPackageVersion("firebase-admin"),
      "firebase-functions": await getPackageVersion("firebase-functions"),
      ...dependencies
    },
    engines: { node: nodeVersion }
  }, null, 2));
}

const heroku = defineNitroPreset({
  extends: "node-server"
});

const layer0 = defineNitroPreset({
  extends: "node",
  commands: {
    deploy: "cd ./ && npm run deploy",
    preview: "cd ./ && npm run preview"
  },
  hooks: {
    async "compiled"(nitro) {
      const layer0Config = {
        connector: "./layer0",
        name: "nitro-app",
        routes: "routes.js",
        backends: {},
        includeFiles: {
          "public/**/*": true,
          "server/**/*": true
        }
      };
      const configPath = resolve(nitro.options.output.dir, "layer0.config.js");
      await writeFile(configPath, `module.exports = ${JSON.stringify(layer0Config, null, 2)}`);
      const routerPath = resolve(nitro.options.output.dir, "routes.js");
      await writeFile(routerPath, routesTemplate());
      const connectorPath = resolve(nitro.options.output.dir, "layer0/prod.js");
      await writeFile(connectorPath, entryTemplate());
      const pkgJSON = {
        private: true,
        scripts: {
          deploy: "npm install && 0 deploy",
          preview: "npm install && 0 build && 0 run -p"
        },
        devDependencies: {
          "@layer0/cli": "^4.13.2",
          "@layer0/core": "^4.13.2"
        }
      };
      await writeFile(resolve(nitro.options.output.dir, "package.json"), JSON.stringify(pkgJSON, null, 2));
    }
  }
});
async function writeFile(path, contents) {
  await promises.mkdir(dirname(path), { recursive: true });
  await promises.writeFile(path, contents, "utf-8");
}
function entryTemplate() {
  return `
const http = require('http')

module.exports = async function prod(port) {
  const { handler } = await import('../server/index.mjs')
  const server = http.createServer(handler)
  server.listen(port)
}
  `.trim();
}
function routesTemplate() {
  return `
import { Router } from '@layer0/core'

const router = new Router()
export default router

router.fallback(({ renderWithApp }) => {
  renderWithApp()
})
`.trim();
}

const netlify = defineNitroPreset({
  extends: "aws-lambda",
  output: {
    dir: "{{ rootDir }}/.netlify/functions-internal",
    publicDir: "{{ rootDir }}/dist"
  },
  rollupConfig: {
    output: {
      entryFileNames: "server.ts"
    }
  },
  hooks: {
    async "compiled"(nitro) {
      const redirectsPath = join(nitro.options.output.publicDir, "_redirects");
      let contents = "/* /.netlify/functions/server 200";
      if (existsSync(redirectsPath)) {
        const currentRedirects = await promises.readFile(redirectsPath, "utf-8");
        if (currentRedirects.match(/^\/\* /m)) {
          nitro.logger.info("Not adding Nitro fallback to `_redirects` (as an existing fallback was found).");
          return;
        }
        nitro.logger.info("Adding Nitro fallback to `_redirects` to handle all unmatched routes.");
        contents = currentRedirects + "\n" + contents;
      }
      await promises.writeFile(redirectsPath, contents);
    }
  }
});
const netlifyBuilder = defineNitroPreset({
  extends: "netlify",
  entry: "#internal/nitro/entries/netlify-builder"
});
const netlifyEdge = defineNitroPreset({
  extends: "base-worker",
  entry: "#internal/nitro/entries/netlify-edge",
  output: {
    serverDir: "{{ rootDir }}/.netlify/edge-functions",
    publicDir: "{{ rootDir }}/dist"
  },
  rollupConfig: {
    output: {
      entryFileNames: "server.js"
    }
  },
  hooks: {
    async "compiled"(nitro) {
      const manifest = {
        version: 1,
        functions: [
          {
            function: "server",
            pattern: "/*"
          }
        ]
      };
      const manifestPath = join(nitro.options.rootDir, ".netlify/edge-functions/manifest.json");
      await promises.mkdir(dirname(manifestPath), { recursive: true });
      await promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }
});

const nitroDev = defineNitroPreset({
  extends: "node",
  entry: "#internal/nitro/entries/nitro-dev",
  output: {
    serverDir: "{{ buildDir }}/dev"
  },
  externals: { trace: false },
  inlineDynamicImports: true,
  sourceMap: true
});

const nitroPrerender = defineNitroPreset({
  extends: "node",
  entry: "#internal/nitro/entries/nitro-prerenderer",
  output: {
    serverDir: "{{ buildDir }}/prerender"
  },
  commands: {
    preview: "npx serve -s ./public"
  },
  externals: { trace: false }
});

const cli = defineNitroPreset({
  extends: "node",
  entry: "#internal/nitro/entries/cli",
  commands: {
    preview: "Run with node ./server/index.mjs [route]"
  }
});

const nodeServer = defineNitroPreset({
  extends: "node",
  entry: "#internal/nitro/entries/node-server",
  serveStatic: true,
  commands: {
    preview: "node ./server/index.mjs"
  }
});

const node = defineNitroPreset({
  entry: "#internal/nitro/entries/node",
  externals: true
});

const renderCom = defineNitroPreset({
  extends: "node-server"
});

const htmlTemplate = (baseURL = "/") => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="prefetch" href="${joinURL(baseURL, "sw.js")}">
  <link rel="prefetch" href="${joinURL(baseURL, "server/index.mjs")}">
  <script>
  async function register () {
    const registration = await navigator.serviceWorker.register('${joinURL(baseURL, "sw.js")}')
    await navigator.serviceWorker.ready
    registration.active.addEventListener('statechange', (event) => {
      if (event.target.state === 'activated') {
        window.location.reload()
      }
    })
  }
  if (location.hostname !== 'localhost' && location.protocol === 'http:') {
    location.replace(location.href.replace('http://', 'https://'))
  } else {
    register()
  }
  <\/script>
</head>

<body>
  Initializing nitro service worker...
</body>
</html>`;
const serviceWorker = defineNitroPreset(() => {
  return {
    extends: "base-worker",
    entry: "#internal/nitro/entries/service-worker",
    output: {
      serverDir: "{{ output.dir }}/public/server"
    },
    commands: {
      preview: "npx serve ./public"
    },
    hooks: {
      async "compiled"(nitro) {
        await promises.writeFile(resolve(nitro.options.output.publicDir, "sw.js"), `self.importScripts('${joinURL(nitro.options.baseURL, "server/index.mjs")}');`, "utf8");
        const html = htmlTemplate(nitro.options.baseURL);
        if (!existsSync(resolve(nitro.options.output.publicDir, "index.html"))) {
          await promises.writeFile(resolve(nitro.options.output.publicDir, "index.html"), html, "utf8");
        }
        if (!existsSync(resolve(nitro.options.output.publicDir, "200.html"))) {
          await promises.writeFile(resolve(nitro.options.output.publicDir, "200.html"), html, "utf8");
        }
        if (!existsSync(resolve(nitro.options.output.publicDir, "404.html"))) {
          await promises.writeFile(resolve(nitro.options.output.publicDir, "404.html"), html, "utf8");
        }
      }
    }
  };
});

const stormkit = defineNitroPreset({
  entry: "#internal/nitro/entries/stormkit",
  externals: true,
  output: {
    dir: "{{ rootDir }}/.stormkit"
  }
});

const vercel = defineNitroPreset({
  extends: "node",
  entry: "#internal/nitro/entries/vercel",
  output: {
    dir: "{{ rootDir }}/.vercel_build_output",
    serverDir: "{{ output.dir }}/functions/node/server",
    publicDir: "{{ output.dir }}/static"
  },
  hooks: {
    async "compiled"(nitro) {
      await writeRoutes(nitro);
    }
  }
});
async function writeRoutes(nitro) {
  const routes = [
    {
      src: "/sw.js",
      headers: {
        "cache-control": "public, max-age=0, must-revalidate"
      },
      continue: true
    },
    ...nitro.options.publicAssets.filter((asset) => !asset.fallthrough).map((asset) => asset.baseURL).map((baseURL) => ({
      src: baseURL + "(.*)",
      headers: {
        "cache-control": "public,max-age=31536000,immutable"
      },
      continue: true
    })),
    {
      handle: "filesystem"
    },
    {
      src: "(.*)",
      dest: "/.vercel/functions/server/index"
    }
  ];
  await writeFile$1(resolve(nitro.options.output.dir, "config/routes.json"), JSON.stringify(routes, null, 2));
}

const PRESETS = {
  __proto__: null,
  awsLambda: awsLambda,
  awsLambdaEdge: awsLambdaEdge,
  azureFunctions: azureFunctions,
  azure: azure,
  baseWorker: baseWorker,
  cloudflare: cloudflare,
  digitalOcean: digitalOcean,
  firebase: firebase,
  heroku: heroku,
  layer0: layer0,
  netlify: netlify,
  netlifyBuilder: netlifyBuilder,
  netlifyEdge: netlifyEdge,
  nitroDev: nitroDev,
  nitroPrerender: nitroPrerender,
  cli: cli,
  nodeServer: nodeServer,
  node: node,
  renderCom: renderCom,
  serviceWorker: serviceWorker,
  stormkit: stormkit,
  vercel: vercel
};

const nitroImports = [
  {
    from: "#internal/nitro",
    imports: [
      "defineCachedFunction",
      "defineCachedEventHandler",
      "cachedFunction",
      "cachedEventHandler",
      "useRuntimeConfig",
      "useStorage",
      "useNitroApp",
      "defineNitroPlugin",
      "nitroPlugin"
    ]
  },
  {
    from: "h3",
    imports: [
      "defineEventHandler",
      "defineLazyEventHandler",
      "eventHandler",
      "lazyEventHandler",
      "dynamicEventHandler",
      "appendHeader",
      "assertMethod",
      "createError",
      "handleCacheHeaders",
      "isMethod",
      "sendRedirect",
      "useCookies",
      "useCookie",
      "deleteCookie",
      "setCookie",
      "useBody",
      "useMethod",
      "useQuery",
      "useRawBody"
    ]
  }
];

const NitroDefaults = {
  preset: void 0,
  logLevel: isTest ? 1 : 3,
  runtimeConfig: { app: {}, nitro: {} },
  scanDirs: [],
  buildDir: ".nitro",
  output: {
    dir: "{{ rootDir }}/.output",
    serverDir: "{{ output.dir }}/server",
    publicDir: "{{ output.dir }}/public"
  },
  experimental: {},
  storage: {},
  devStorage: {},
  bundledStorage: [],
  publicAssets: [],
  serverAssets: [],
  plugins: [],
  autoImport: {
    presets: nitroImports
  },
  virtual: {},
  dev: false,
  devServer: { watch: [] },
  watchOptions: { ignoreInitial: true },
  baseURL: process.env.NITRO_APP_BASE_URL || "/",
  handlers: [],
  devHandlers: [],
  errorHandler: "#internal/nitro/error",
  routes: {},
  prerender: {
    crawlLinks: false,
    routes: []
  },
  alias: {
    "#internal/nitro": runtimeDir
  },
  unenv: {},
  analyze: false,
  moduleSideEffects: ["unenv/runtime/polyfill/", "node-fetch-native/polyfill"],
  replace: {},
  node: true,
  sourceMap: true,
  typescript: {
    generateTsConfig: true,
    internalPaths: false
  },
  nodeModulesDirs: [],
  hooks: {},
  commands: {}
};
async function loadOptions(userConfig = {}) {
  let preset = userConfig.preset || process.env.NITRO_PRESET || detectTarget() || "node-server";
  if (userConfig.dev) {
    preset = "nitro-dev";
  }
  userConfig = klona(userConfig);
  const { config } = await loadConfig({
    name: "nitro",
    defaults: NitroDefaults,
    cwd: userConfig.rootDir,
    resolve(id) {
      let matchedPreset = PRESETS[id] || PRESETS[camelCase(id)];
      if (matchedPreset) {
        if (typeof matchedPreset === "function") {
          matchedPreset = matchedPreset();
        }
        return {
          config: matchedPreset
        };
      }
      return null;
    },
    overrides: {
      ...userConfig,
      extends: [preset]
    }
  });
  const options = klona(config);
  options._config = userConfig;
  options.preset = preset;
  options.rootDir = resolve(options.rootDir || ".");
  options.srcDir = resolve(options.srcDir || options.rootDir);
  for (const key of ["srcDir", "publicDir", "buildDir"]) {
    options[key] = resolve(options.rootDir, options[key]);
  }
  if (!options.entry) {
    throw new Error(`Nitro entry is missing! Is "${options.preset}" preset correct?`);
  }
  options.entry = resolvePath(options.entry, options);
  options.output.dir = resolvePath(options.output.dir, options);
  options.output.publicDir = resolvePath(options.output.publicDir, options);
  options.output.serverDir = resolvePath(options.output.serverDir, options);
  options.nodeModulesDirs.push(resolve(options.rootDir, "node_modules"));
  options.nodeModulesDirs.push(resolve(pkgDir, "node_modules"));
  options.nodeModulesDirs = Array.from(new Set(options.nodeModulesDirs));
  if (!options.scanDirs.length) {
    options.scanDirs = [options.srcDir];
  }
  options.baseURL = withLeadingSlash(withTrailingSlash(options.baseURL));
  options.runtimeConfig = defu(options.runtimeConfig, {
    app: {
      baseURL: options.baseURL
    },
    nitro: {
      routes: options.routes
    }
  });
  for (const asset of options.publicAssets) {
    asset.dir = resolve(options.srcDir, asset.dir);
    asset.baseURL = withLeadingSlash(withoutTrailingSlash(asset.baseURL || "/"));
  }
  for (const pkg of ["defu", "h3"]) {
    if (!options.alias[pkg]) {
      options.alias[pkg] = await resolvePath$1(pkg, { url: import.meta.url });
    }
  }
  const fsMounts = {
    root: resolve(options.rootDir),
    src: resolve(options.srcDir),
    build: resolve(options.buildDir),
    cache: resolve(options.buildDir, "cache")
  };
  for (const p in fsMounts) {
    options.devStorage[p] = options.devStorage[p] || { driver: "fs", base: fsMounts[p] };
  }
  return options;
}
function defineNitroConfig(config) {
  return config;
}

async function createNitro(config = {}) {
  const options = await loadOptions(config);
  const nitro = {
    options,
    hooks: createHooks(),
    vfs: {},
    logger: consola.withTag("nitro"),
    scannedHandlers: [],
    close: () => nitro.hooks.callHook("close"),
    storage: void 0
  };
  nitro.storage = await createStorage(nitro);
  nitro.hooks.hook("close", async () => {
    await nitro.storage.dispose();
  });
  if (nitro.options.logLevel !== void 0) {
    nitro.logger.level = nitro.options.logLevel;
  }
  nitro.hooks.addHooks(nitro.options.hooks);
  for (const dir of options.scanDirs) {
    const publicDir = resolve(dir, "public");
    if (!existsSync(publicDir)) {
      continue;
    }
    if (options.publicAssets.find((asset) => asset.dir === publicDir)) {
      continue;
    }
    options.publicAssets.push({ dir: publicDir });
  }
  for (const asset of options.publicAssets) {
    asset.baseURL = asset.baseURL || "/";
    const isTopLevel = asset.baseURL === "/";
    asset.fallthrough = asset.fallthrough ?? isTopLevel;
    asset.maxAge = asset.maxAge ?? (isTopLevel ? 0 : 60);
  }
  nitro.options.serverAssets.push({
    baseName: "server",
    dir: resolve(nitro.options.srcDir, "assets")
  });
  if (nitro.options.autoImport) {
    nitro.unimport = createUnimport(nitro.options.autoImport);
    nitro.options.virtual["#imports"] = () => nitro.unimport.toExports();
    nitro.options.virtual["#nitro"] = 'export * from "#imports"';
  }
  return nitro;
}

function createVFSHandler(nitro) {
  return eventHandler(async (event) => {
    const vfsEntries = {
      ...nitro.vfs,
      ...nitro.options.virtual
    };
    if (event.req.url === "/") {
      const items = Object.keys(vfsEntries).map((key) => `<li><a href="/_vfs/${encodeURIComponent(key)}">${key.replace(nitro.options.rootDir, "")}</a></li>`).join("\n");
      return `<!doctype html><html><body><ul>${items}</ul></body></html>`;
    }
    const id = decodeURIComponent(event.req.url?.slice(1) || "");
    if (id in vfsEntries) {
      let contents = vfsEntries[id];
      if (typeof contents === "function") {
        contents = await contents();
      }
      return editorTemplate({
        readOnly: true,
        language: id.endsWith("html") ? "html" : "javascript",
        theme: "vs-dark",
        value: contents,
        wordWrap: "wordWrapColumn",
        wordWrapColumn: 80
      });
    }
    throw createError({ message: "File not found", statusCode: 404 });
  });
}
const monacoVersion = "0.30.0";
const monacoUrl = `https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/${monacoVersion}/min`;
const vsUrl = `${monacoUrl}/vs`;
const editorTemplate = (options) => `
<!doctype html>
<html>
<head>
    <link rel="stylesheet" data-name="vs/editor/editor.main" href="${vsUrl}/editor/editor.main.min.css">
</head>
<body style="margin: 0">
<div id="editor" style="height:100vh"></div>
<script src="${vsUrl}/loader.min.js"><\/script>
<script>
  require.config({ paths: { vs: '${vsUrl}' } })

  const proxy = URL.createObjectURL(new Blob([\`
    self.MonacoEnvironment = { baseUrl: '${monacoUrl}' }
    importScripts('${vsUrl}/base/worker/workerMain.min.js')
  \`], { type: 'text/javascript' }))
  window.MonacoEnvironment = { getWorkerUrl: () => proxy }

  require(['vs/editor/editor.main'], function () {
    monaco.editor.create(document.getElementById('editor'), ${JSON.stringify(options)})
  })
<\/script>
</body>
</html>
`;

function errorHandler(error, event) {
  event.res.setHeader("Content-Type", "text/html; charset=UTF-8");
  event.res.statusCode = 503;
  event.res.statusMessage = "Server Unavailable";
  let body;
  let title;
  if (error) {
    title = `${event.res.statusCode} ${event.res.statusMessage}`;
    body = `<code><pre>${error.stack}</pre></code>`;
  } else {
    title = "Reloading server...";
    body = "<progress></progress><script>document.querySelector('progress').indeterminate=true<\/script>";
  }
  event.res.end(`<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${error ? "" : '<meta http-equiv="refresh" content="2">'}
    <title>${title}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico/css/pico.min.css">
  </head>
  <body>
    <main class="container">
      <article>
        <header>
          <h2>${title}</h2>
        </header>
        ${body}
        <footer>
          Check console logs for more information.
        </footer>
      </article>
  </main>
  </body>
</html>
`);
}

function initWorker(filename) {
  if (!existsSync(filename)) {
    return null;
  }
  return new Promise((resolve2, reject) => {
    const worker = new Worker(filename);
    worker.once("exit", (code) => {
      reject(new Error(code ? "[worker] exited with code: " + code : "[worker] exited"));
    });
    worker.once("error", (err) => {
      err.message = "[worker init] " + err.message;
      reject(err);
    });
    const addressListener = (event) => {
      if (!event || !event.address) {
        return;
      }
      worker.off("message", addressListener);
      resolve2({
        worker,
        address: event.address
      });
    };
    worker.on("message", addressListener);
  });
}
async function killWorker(worker) {
  if (!worker) {
    return;
  }
  if (worker.worker) {
    worker.worker.removeAllListeners();
    await worker.worker.terminate();
    worker.worker = null;
  }
  if (worker.address.socketPath && existsSync(worker.address.socketPath)) {
    await promises.rm(worker.address.socketPath);
  }
}
function createDevServer(nitro) {
  const workerEntry = resolve(nitro.options.output.dir, nitro.options.output.serverDir, "index.mjs");
  const errorHandler$1 = nitro.options.devErrorHandler || errorHandler;
  let lastError = null;
  let reloadPromise = null;
  let currentWorker = null;
  async function _reload() {
    const oldWorker = currentWorker;
    currentWorker = null;
    await killWorker(oldWorker);
    currentWorker = await initWorker(workerEntry);
  }
  const reload = debounce(() => {
    reloadPromise = _reload().then(() => {
      lastError = null;
    }).catch((error) => {
      console.error("[worker reload]", error);
      lastError = error;
    }).finally(() => {
      reloadPromise = null;
    });
    return reloadPromise;
  });
  nitro.hooks.hook("dev:reload", reload);
  const app = createApp();
  for (const handler of nitro.options.devHandlers) {
    app.use(handler.route || "/", handler.handler);
  }
  app.use("/_vfs", createVFSHandler(nitro));
  for (const asset of nitro.options.publicAssets) {
    const url = joinURL(nitro.options.runtimeConfig.app.baseURL, asset.baseURL);
    app.use(url, serveStatic(asset.dir));
    if (!asset.fallthrough) {
      app.use(url, servePlaceholder());
    }
  }
  const proxy = httpProxy.createProxy();
  app.use(eventHandler(async (event) => {
    await reloadPromise;
    const address = currentWorker?.address;
    if (!address || address.socketPath && !existsSync(address.socketPath)) {
      return errorHandler$1(lastError, event);
    }
    return new Promise((resolve2, reject) => {
      proxy.web(event.req, event.res, { target: address }, (error) => {
        lastError = error;
        if (error.code !== "ECONNRESET") {
          reject(error);
        }
        resolve2();
      });
    });
  }));
  let listeners = [];
  const _listen = async (port, opts) => {
    const listener = await listen(app, { port, ...opts });
    listeners.push(listener);
    return listener;
  };
  let watcher = null;
  if (nitro.options.devServer.watch.length) {
    watcher = watch(nitro.options.devServer.watch, nitro.options.watchOptions);
    watcher.on("add", reload).on("change", reload);
  }
  async function close() {
    if (watcher) {
      await watcher.close();
    }
    await killWorker(currentWorker);
    await Promise.all(listeners.map((l) => l.close()));
    listeners = [];
  }
  nitro.hooks.hook("close", close);
  return {
    reload,
    listen: _listen,
    app,
    close,
    watcher
  };
}

const allowedExtensions = /* @__PURE__ */ new Set(["", ".json"]);
async function prerender(nitro) {
  const routes = new Set(nitro.options.prerender.routes);
  if (nitro.options.prerender.crawlLinks && !routes.size) {
    routes.add("/");
  }
  if (!routes.size) {
    return;
  }
  nitro.logger.info("Initializing prerenderer");
  const nitroRenderer = await createNitro({
    ...nitro.options._config,
    rootDir: nitro.options.rootDir,
    logLevel: 0,
    preset: "nitro-prerender"
  });
  await build(nitroRenderer);
  const serverEntrypoint = resolve(nitroRenderer.options.output.serverDir, "index.mjs");
  const { localFetch } = await import(pathToFileURL(serverEntrypoint).href);
  const generatedRoutes = /* @__PURE__ */ new Set();
  const canPrerender = (route = "/") => {
    if (generatedRoutes.has(route)) {
      return false;
    }
    if (route.length > 250) {
      return false;
    }
    return true;
  };
  const generateRoute = async (route) => {
    const start = Date.now();
    if (!canPrerender(route)) {
      return;
    }
    generatedRoutes.add(route);
    routes.delete(route);
    const _route = { route };
    const res = await localFetch(joinURL(nitro.options.baseURL, route), { headers: { "X-Nitro-Prerender": route } });
    _route.contents = await res.text();
    if (res.status !== 200) {
      _route.error = new Error(`[${res.status}] ${res.statusText}`);
      _route.error.statusCode = res.status;
      _route.error.statusMessage = res.statusText;
    }
    const isImplicitHTML = !route.endsWith(".html") && (res.headers.get("content-type") || "").includes("html");
    const routeWithIndex = route.endsWith("/") ? route + "index" : route;
    _route.fileName = isImplicitHTML ? route + "/index.html" : routeWithIndex;
    const filePath = join(nitro.options.output.publicDir, _route.fileName);
    await writeFile$1(filePath, _route.contents);
    if (!_route.error && nitro.options.prerender.crawlLinks && isImplicitHTML) {
      const crawledRoutes = extractLinks(_route.contents, route, res);
      for (const crawledRoute of crawledRoutes) {
        if (canPrerender(crawledRoute)) {
          routes.add(crawledRoute);
        }
      }
    }
    _route.generateTimeMS = Date.now() - start;
    return _route;
  };
  nitro.logger.info(nitro.options.prerender.crawlLinks ? `Prerendering ${routes.size} initial routes with crawler` : `Prerendering ${routes.size} routes`);
  for (let i = 0; i < 100 && routes.size; i++) {
    for (const route of Array.from(routes)) {
      const _route = await generateRoute(route).catch((error) => ({ route, error }));
      if (!_route) {
        continue;
      }
      await nitro.hooks.callHook("prerender:route", _route);
      nitro.logger.log(chalk[_route.error ? "yellow" : "gray"](`  \u251C\u2500 ${_route.route} (${_route.generateTimeMS}ms) ${_route.error ? `(${_route.error})` : ""}`));
    }
  }
}
const LINK_REGEX = /href=['"]?([^'" >]+)/g;
function extractLinks(html, from, res) {
  const links = [];
  const _links = [];
  _links.push(...Array.from(html.matchAll(LINK_REGEX)).map((m) => m[1]));
  const header = res.headers.get("x-nitro-prerender") || "";
  _links.push(...header.split(",").map((i) => i.trim()));
  for (const link of _links.filter(Boolean)) {
    const parsed = parseURL(link);
    if (parsed.protocol) {
      continue;
    }
    let { pathname } = parsed;
    if (!allowedExtensions.has(getExtension(pathname))) {
      continue;
    }
    if (!pathname.startsWith("/")) {
      const fromURL = new URL(from, "http://localhost");
      pathname = new URL(pathname, fromURL).pathname;
    }
    links.push(pathname);
  }
  return links;
}
const EXT_REGEX = /\.[a-z0-9]+$/;
function getExtension(path) {
  return (path.match(EXT_REGEX) || [])[0] || "";
}

export { GLOB_SCAN_PATTERN as G, createNitro as a, build as b, copyPublicAssets as c, scanMiddleware as d, scanRoutes as e, createDevServer as f, defineNitroConfig as g, prerender as h, defineNitroPreset as i, loadOptions as l, prepare as p, scanHandlers as s, writeTypes as w };
