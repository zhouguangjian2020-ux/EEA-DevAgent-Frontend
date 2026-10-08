export type TextBlock = { kind: "heading"; level: number; text: string } | { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };
// A deliberately small, text-only renderer contract. HTML is never interpreted.
export function parseFreeText(content: string): TextBlock[] {
  const result: TextBlock[] = [];
  let paragraph: string[] = [], items: string[] = [];
  const flush = () => {
    if (paragraph.length) { result.push({ kind: "paragraph", text: paragraph.join("\n") }); paragraph = []; }
    if (items.length) { result.push({ kind: "list", items }); items = []; }
  };
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const item = line.match(/^[-•]\s+(.+)$/);
    if (!line.trim()) flush();
    else if (heading) { flush(); result.push({ kind: "heading", level: heading[1].length, text: heading[2] }); }
    else if (item) { if (paragraph.length) flush(); items.push(item[1]); }
    else { if (items.length) flush(); paragraph.push(line); }
  }
  flush();
  return result;
}
