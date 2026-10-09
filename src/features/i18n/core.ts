import { english } from "./en";
export type Locale = "zh-CN" | "en";
export const localeStorageKey = "ts.interface-language";
export function normalizeLocale(value: unknown): Locale { return value === "en" ? "en" : "zh-CN"; }
export type UiParams = Record<string, string | number>;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(english).filter(([key]) => /\{\d+\}/.test(key) && /[\u3400-\u9fff]/.test(key.replace(/\{\d+\}/g, "")))
  .sort(([a], [b]) => b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length)
  .map(([key, template]) => {
    const names: string[] = [];
    const parts = key.split(/(\{\d+\})/).map(part => { const placeholder = /^\{(\d+)\}$/.exec(part); if (placeholder) { names.push(placeholder[1]); return "(.*?)"; } return escapeRegex(part); });
    return { expression: new RegExp("^" + parts.join("") + "$", "s"), names, template };
  });
function format(template: string, params: UiParams) {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => Object.hasOwn(params, key) ? String(params[key]) : match);
}
/** Only call for explicitly identified UI copy, never document/user/Agent content. */
export function translate(locale: Locale, source: string, params: UiParams = {}): string {
  if (locale !== "en") return format(source, params);
  if (Object.hasOwn(english, source)) return format(english[source], params);
  // Recover localized system notices that were assembled before a language switch.
  // Captured values are inserted verbatim: names and business text are not translated.
  if (source.length <= 4096 && /[\u3400-\u9fff]/.test(source) && !Object.keys(params).length) {
    for (const pattern of patterns) {
      const match = pattern.expression.exec(source);
      if (match) return format(pattern.template, Object.fromEntries(pattern.names.map((name, i) => [name, match[i + 1]])));
    }
  }
  return format(source, params);
}
