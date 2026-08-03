function wasmLocation() {
  const url = new URL("../build/highs.wasm", import.meta.url);
  if (typeof process !== "undefined" && process.versions?.node) {
    if (url.protocol !== "file:")
      return `${process.cwd().replace(/\\/g, "/")}/vendor/highs-ts/build/highs.wasm`;
  }
  if (url.protocol !== "file:") return url.href;
  const pathname = decodeURIComponent(url.pathname);
  return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
}
/** Loads a fresh HiGHS WebAssembly module with the given options. */
export async function loadHiGHSModule(options) {
  const createModule = await loadHiGHSFactory();
  const consoleConfig = options?.console ?? { log: null, error: null };
  const moduleOptions = {
    print: consoleConfig.log ?? (() => {}),
    printErr: consoleConfig.error ?? (() => {}),
    locateFile: (path) => (path.endsWith(".wasm") ? wasmLocation() : path),
  };
  return createModule(moduleOptions);
}
async function loadHiGHSFactory() {
  // A static relative specifier keeps this import visible to consumers'
  // bundlers (webpack, vite, ...), which otherwise fail to include the
  // emscripten glue in their bundles. Our own rollup pass marks it external
  // so the specifier survives verbatim in the dist output.
  const { default: HiGHSModuleFactory } = await import("../build/highs.js");
  return HiGHSModuleFactory;
}
//# sourceMappingURL=module.js.map
