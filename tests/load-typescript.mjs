import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";

const modules = new Map();
// Compile pure models with the project's compiler, resolving only their local imports.
function moduleUrl(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  let output = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const ast = ts.createSourceFile(url.pathname, output, ts.ScriptTarget.ES2022, true);
  const replacements = [];
  for (const statement of ast.statements) {
    if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier.text.startsWith(".") && !specifier.text.startsWith("@/")) continue;
    let dependency = specifier.text.startsWith("@/") ? new URL(`../src/${specifier.text.slice(2)}`, import.meta.url) : new URL(specifier.text, url);
    if (!existsSync(dependency)) dependency = new URL(`${dependency.href}.ts`);
    replacements.push({ start: specifier.getStart(ast), end: specifier.end, value: JSON.stringify(moduleUrl(dependency)) });
  }
  for (const r of replacements.reverse()) output = output.slice(0, r.start) + r.value + output.slice(r.end);
  const result = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  modules.set(url.href, result);
  return result;
}
export async function loadTypescript(relativePath) { return import(moduleUrl(new URL(relativePath, import.meta.url))); }
