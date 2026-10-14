"use client";
import { useI18n } from "@/features/i18n/provider";
/* eslint-disable @next/next/no-img-element -- SVG remains an inert image; never inject it into app DOM. */
import { useEffect, useState } from "react";
import { createUuid } from "@/lib/uuid";
import { prepareUcDiagrams, assertSafeRequirementDiagram } from "@/features/panorama/mermaid-safety";
import { requirementDiagramLayout } from "@/features/panorama/requirement-layout";
import { DiagramViewport } from "./diagram-viewport";
import { WorkDialog } from "@/components/workbench/work-dialog";
import { LoadingIcon } from "@/components/feedback/loading";

let renderQueue: Promise<void> = Promise.resolve();
type DiagramImage = { code: string; attemptId?: string | null; urls: string[] };
export function MermaidDiagram({ code, attemptId, label = "UC图形", kind = "uc" }: {
  code: string; attemptId?: string | null; label?: string; kind?: "uc" | "requirement";
}) {
  const { t: tr } = useI18n();
  const [image, setImage] = useState<DiagramImage | null>(null);
  const [failure, setFailure] = useState<{ code: string; attemptId?: string | null; message: string } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  useEffect(() => image ? () => image.urls.forEach(url => URL.revokeObjectURL(url)) : undefined, [image]);
  useEffect(() => {
    if (attemptId === null) return;
    let cancelled = false;
    const render = async () => {
      const urls: string[] = [];
      let published = false;
      try {
        const documents = kind === "uc" ? prepareUcDiagrams(code) : [assertSafeRequirementDiagram(code)];
        const { default: mermaid } = await import("mermaid");
        if (cancelled) return;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
          maxTextSize: 100000, maxEdges: 500, htmlLabels: false, flowchart: { htmlLabels: false },
          theme: kind === "uc" ? "default" : "neutral", look: "classic",
          themeCSS: ".usecase-element .label text { text-anchor: middle; }",
          ...(kind === "requirement" ? requirementDiagramLayout(documents[0]) : {}) });
        for (const documentText of documents) {
          if (cancelled) return;
          const host = document.createElement("div");
          host.style.cssText = "position:fixed;left:-100000px;top:0;width:1200px;visibility:hidden";
          document.body.append(host);
          try {
            const result = await mermaid.render("uc-graph-" + createUuid(), documentText, host);
            if (cancelled) return;
            urls.push(URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" })));
          } finally { host.remove(); }
        }
        setImage({ code, attemptId, urls }); setFailure(null); published = true;
      } catch (error) {
        if (!cancelled) setFailure({ code, attemptId, message: error instanceof Error ? error.message : "图形渲染失败" });
      } finally {
        if (!published) urls.forEach(url => URL.revokeObjectURL(url));
      }
    };
    renderQueue = renderQueue.then(render, render);
    return () => { cancelled = true; };
  }, [code, attemptId, kind]);
  const currentFailure = attemptId !== null && failure?.code === code && failure.attemptId === attemptId ? failure : null;
  const rendering = attemptId !== null && !currentFailure && (!image || image.code !== code || image.attemptId !== attemptId);
  const previewIndex = preview !== null && image ? Math.min(preview, image.urls.length - 1) : null;
  return <div className="uc-mermaid-render" aria-label={tr(label)}>
    {currentFailure && <p role="alert">{tr("图形渲染失败：")}{tr(currentFailure.message)}。{image ? tr("仍显示上次成功的图，当前图并非最新结果。") : tr("请重新生成图形或核对输入；不会执行图中的交互。")}</p>}
    {rendering && <p role="status" className="task-progress"><LoadingIcon />{tr(image ? "正在绘制新版图形，当前保留上次成功结果。" : "正在绘制图形…")}</p>}
    {image?.urls.map((url, index) => <button key={url} type="button" className="diagram-thumbnail" aria-label={`${tr("预览图形")} · ${tr(label)} ${index + 1}`} onClick={() => setPreview(index)}>
      <img src={url} alt={image.urls.length === 1 ? tr(label) : `${tr(label)} ${index + 1}/${image.urls.length}`} />
      <span>{tr("点击预览与缩放")}</span>
    </button>)}
    {image && previewIndex !== null && <WorkDialog title={tr(label)} className="diagram-preview-dialog" onClose={() => setPreview(null)}>
      {currentFailure && <p role="status">{tr("仍显示上次成功的图，当前图并非最新结果。")}</p>}
      <DiagramViewport key={image.urls[previewIndex]} src={image.urls[previewIndex]} label={tr(label)}>
        {image.urls.length > 1 && <><button type="button" className="button-secondary" disabled={previewIndex === 0} onClick={() => setPreview(previewIndex - 1)}>{tr("上一张")}</button><span>{previewIndex + 1}/{image.urls.length}</span><button type="button" className="button-secondary" disabled={previewIndex === image.urls.length - 1} onClick={() => setPreview(previewIndex + 1)}>{tr("下一张")}</button></>}
      </DiagramViewport>
    </WorkDialog>}
  </div>;
}
