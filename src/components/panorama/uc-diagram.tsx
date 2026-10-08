import type { CSSProperties } from "react";
import { diagramActors, type DiagramRow } from "@/features/panorama/model";
export function UcDiagram({ featureName, rows }: { featureName: string; rows: DiagramRow[] }) {
  const actors = diagramActors(rows);
  const height = Math.max(552, rows.length * 82 + 140, actors.length * 160 + 100);
  const nodeHeight = Math.max(68, ...rows.map(row => 38 + Math.ceil(row.content.name.length / 18) * 19));
  const step = Math.max(82, nodeHeight + 14), graphHeight = Math.max(height, rows.length * step + 100);
  const actorTop = (index: number) => 60 + (graphHeight - 170) * (index + 0.5) / Math.max(1, actors.length) - 42;
  return <div className="uc-diagram-scroll" tabIndex={0} aria-label="用例图滚动区域">
    <figure className="uc-panorama-diagram" style={{ height: graphHeight }} aria-label={featureName + "用例图，只读"}>
      <div className="uc-system-boundary" style={{ height: graphHeight - 64 }}><strong title={featureName + "系统"}>{featureName}系统</strong><span>{rows.length} 个用例</span></div>
      {actors.flatMap((actor, a) => rows.flatMap((row, i) => {
        if (!actor.ids.includes(row.id)) return [];
        const x = 136, y = actorTop(a) + 42, toX = 402, toY = 80 + i * step + nodeHeight / 2;
        return <span key={actor.name + row.id} className="uc-association" aria-hidden="true" style={{ left: x, top: y, width: Math.hypot(toX - x, toY - y), transform: "rotate(" + Math.atan2(toY - y, toX - x) + "rad)" } as CSSProperties} />;
      }))}
      {actors.map((actor, i) => <div key={actor.name} className="uc-diagram-actor" style={{ top: actorTop(i) }}><span className="uc-actor-head" aria-hidden="true" /><span className="uc-actor-body" aria-hidden="true" /><span className="uc-actor-name">{actor.name}</span></div>)}
      {rows.map((row, i) => <div key={row.id} className="uc-diagram-usecase" style={{ top: 80 + i * step, minHeight: nodeHeight }} data-uc-id={row.id}><small>{row.content.number}</small><span>{row.content.name}</span></div>)}
      <figcaption className="sr-only">参与者与用例通过实线关联。此图不可编辑，节点不提供点击跳转；从左侧打开 UC 修改源内容。</figcaption>
    </figure>
  </div>;
}
