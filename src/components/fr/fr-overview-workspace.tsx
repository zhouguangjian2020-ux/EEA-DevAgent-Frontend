"use client";
import { useI18n } from "@/features/i18n/provider";
import type { ReactNode } from "react";
import type { FrContent } from "@/features/fr/model";
type Props = { headerActions?: ReactNode; featureName: string; rows: (FrContent & { sourceWorkId?: string })[]; onOpenSource: (id: string) => void; onOpenFr: (id: string) => void; readOnly?: boolean };
export function FrOverviewWorkspace({ featureName, rows, onOpenFr, onOpenSource, readOnly = false, headerActions }: Props) {
  const { t: tr } = useI18n();
  return <section className="fr-overview-workspace document-only" data-testid="fr-overview-workspace"><section className="fr-overview-main" aria-label={tr("FR 全景视图")}>
    <div className="fr-document-toolbar"><span className="document-type">FR</span><div><strong>{tr("FR 全景视图")}</strong><small>{featureName} · {rows.length}{tr(" 条功能需求")}</small></div>{headerActions}</div>
    {!rows.length ? <div className="work-empty"><h2>{tr("还没有 FR")}</h2><p>{tr("可点击右上角“手动新建 FR”创建草稿，来源 UC 可后续补充。")}</p></div> : <div className="fr-table-wrap"><table className="fr-table"><caption>{featureName}{tr(" · 功能需求清单")}</caption><thead><tr><th scope="col">{tr("需求编号")}</th><th scope="col">{tr("需求来源")}</th><th scope="col">{tr("需求描述")}</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><button className="fr-number" onClick={() => onOpenFr(row.id)}>{row.id}</button></td><td>{row.sourceWorkId ? <button className="fr-number" aria-label={tr("查看来源 {0}", { "0": row.source })} onClick={() => onOpenSource(row.sourceWorkId!)}>{row.source}</button> : row.source}</td><td>{row.description}</td></tr>)}</tbody></table></div>}
    <p className="fr-neutral-note">{readOnly ? tr("来自数据库的 FR 全景；点击需求编号查看详情，点击来源编号查看 UC。") : tr("本地 Mock 功能需求，初始待审阅；点击需求编号查看详情，点击来源编号查看 UC。对象正文与项目对话独立。")}</p>
  </section></section>;
}
