const MAX_CHARACTERS = 100_000;
export const UC_DIAGRAM_HEADER = "---\nconfig:\n  theme: default\n  look: classic\n---\n";

function safeText(code: string, diagramName = "UC关系图") {
  const value = code.replaceAll("\r\n", "\n").trim(), lower = value.toLowerCase();
  if (!value || value.length > MAX_CHARACTERS || value.includes("\0")) throw new Error("图代码为空或超过安全渲染限制");
  if (["%%{", "@{", "<script", "<iframe", "<img", "<style", "<foreignobject", "javascript:", "data:", "https:", "http:", "url("].some(part => lower.includes(part))
      || /^\s*click\b/im.test(value)) throw new Error(`图代码包含不允许的配置、脚本或外部交互，请由Agent返回纯${diagramName}`);
  return value;
}

function withoutFrontmatter(value: string) {
  const lines = value.split("\n");
  if (lines[0].trim() !== "---") return value;
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  const error = "UC图配置只允许theme: default和look: classic";
  if (closing < 0 || closing > 8) throw new Error(error);
  const config = lines.slice(1, closing).filter(line => line.trim());
  if (config[0] !== "config:") throw new Error(error);
  const seen = new Set<string>();
  for (const line of config.slice(1)) {
    const entry = line.match(/^ +(theme: default|look: classic) *$/);
    if (!entry || seen.has(entry[1].split(":")[0])) throw new Error(error);
    seen.add(entry[1].split(":")[0]);
  }
  return lines.slice(closing + 1).join("\n").trim();
}

const DIAGRAM_START = /^(?:usecase-beta(?=[;\s]|$)|(?:flowchart|graph)\s+(?:LR|RL|TB|TD|BT)(?=[;\s]|$))/i;
const MAX_UC_DIAGRAMS = 32;

// This identifies document boundaries only; do not implement Mermaid's grammar here.
function splitUcDocuments(value: string) {
  const documents: string[] = [];
  let current: string[] = [], hasHeader = false, inFrontmatter = false, inFence = false, quoted = false;
  const flush = () => {
    if (current.some(line => line.trim() && !line.trimStart().startsWith("%%"))) {
      documents.push(current.join("\n").trim());
      if (documents.length > MAX_UC_DIAGRAMS) throw new Error("UC图数量超过安全渲染限制（32张）");
    }
    current = []; hasHeader = false;
  };
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!quoted && !inFrontmatter && /^```(?:mermaid)?$/i.test(trimmed)) {
      if (inFence) {
        if (trimmed !== "```") throw new Error("UC图代码围栏未正确闭合");
        flush(); inFence = false;
      } else {
        if (current.length) flush();
        inFence = true;
      }
      continue;
    }
    if (!quoted && trimmed === "---") {
      if (!inFrontmatter && hasHeader) flush();
      inFrontmatter = !inFrontmatter; current.push(line); continue;
    }
    if (inFrontmatter) { current.push(line); continue; }
    if (!quoted && DIAGRAM_START.test(trimmed)) {
      if (hasHeader) flush();
      hasHeader = true;
    }
    current.push(line);
    if (!trimmed.startsWith("%%")) {
      let escaped = false;
      for (const char of line) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = !quoted;
      }
    }
  }
  if (inFence || inFrontmatter) throw new Error("UC图代码围栏或前置配置未正确闭合");
  flush(); return documents;
}

// Agent versions sometimes use PlantUML-style trailing stereotypes. Mermaid's
// native usecase grammar requires the relation kind BEFORE the destination.
// Do not infer a kind for an unlabeled dependency or rewrite text inside labels.
export function normalizeUsecaseRelations(body: string) {
  const header = body.split("\n").find(line => line.trim() && !line.trimStart().startsWith("%%"))?.trim() ?? "";
  if (!/^usecase-beta\b/i.test(header)) return body;
  let quoted = false;
  return body.split("\n").map(line => {
    const original = line;
    if (!quoted) {
      const relation = line.match(/^(\s*)(\w+)\s*\.\.>\s*(\w+)\s*:\s*(?:<<(include|extend)>>|(include|extend)|"(include|extend)")\s*(;?\s*(?:%%.*)?)$/i);
      if (relation) return `${relation[1]}${relation[2]} ..> :${(relation[4] ?? relation[5] ?? relation[6]).toLowerCase()} ${relation[3]}${relation[7]}`;
    }
    if (!line.trimStart().startsWith("%%")) {
      let escaped = false;
      for (const char of line) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = !quoted;
      }
    }
    return original;
  }).join("\n");
}

export function prepareUcDiagrams(code: string): string[] {
  const value = safeText(code);
  const documents = splitUcDocuments(value).map(document => {
    const lines = document.split("\n");
    while (lines.length && (!lines[0].trim() || lines[0].trimStart().startsWith("%%"))) lines.shift();
    const body = normalizeUsecaseRelations(withoutFrontmatter(lines.join("\n")));
    if (/<\/?[A-Za-z][^>]*>/.test(body)) throw new Error("UC图包含不允许的HTML或交互");
    const first = body.split("\n").find(line => line.trim() && !line.trimStart().startsWith("%%"))?.trim() ?? "";
    if (!DIAGRAM_START.test(first)) throw new Error("UC图需要usecase-beta或flowchart/graph图类型声明");
    return UC_DIAGRAM_HEADER + body;
  });
  if (!documents.length || documents.join("\n\n").length > MAX_CHARACTERS) throw new Error("图代码为空或超过安全渲染限制");
  return documents;
}

// Retain the string helper for callers inspecting/copying the complete result.
export function assertSafeUcDiagram(code: string) {
  return prepareUcDiagrams(code).join("\n\n");
}

// Native requirement diagrams are distinct from UC usecase diagrams.
// Keep previously generated flowcharts readable without requesting old syntax.
export function assertSafeRequirementDiagram(code: string) {
  const value = safeText(code, "需求关系图");
  const first = value.split("\n").find(line => line.trim() && !line.trimStart().startsWith("%%"))?.trim() ?? "";
  if (!/^requirementDiagram[ \t]*;?$/i.test(first) && !/^(flowchart|graph) +LR([ ;]|$)/i.test(first))
    throw new Error("子系统需求图需要requirementDiagram声明（兼容旧版flowchart LR）");
  return value;
}
