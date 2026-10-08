import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
// Compile real TS/TSX components for SSR and handler tests, without a new test framework.
export function loadComponent(relativePath, dependencies = {}) {
  const cache = new Map();
  function load(url) {
    if (cache.has(url.href)) return cache.get(url.href).exports;
    const compiledModule = { exports: {} };
    cache.set(url.href, compiledModule);
    const { outputText } = ts.transpileModule(readFileSync(url, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    });
    new Function("require", "module", "exports", outputText)(name => {
      if (name.endsWith(".css")) return {};
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (!name.startsWith(".") && !name.startsWith("@/")) return require(name);
      const base = name.startsWith("@/") ? new URL("../src/" + name.slice(2), import.meta.url) : new URL(name, url);
      const target = [base, new URL(base.href + ".ts"), new URL(base.href + ".tsx")].find(existsSync);
      if (!target) throw new Error("Missing local component dependency: " + name);
      return load(target);
    }, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  return load(new URL(relativePath, import.meta.url));
}
