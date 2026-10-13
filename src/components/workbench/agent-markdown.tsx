import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./agent-markdown.css";

export function AgentMarkdown({ children }: { children: string }) {
  return <div className="agent-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{children}</ReactMarkdown></div>;
}
