"use client";
import { useEffect, useRef } from "react";
type Props = {
  kind: "PRD" | "UC"; label: string; status?: "pending" | "accepted";
  selected: boolean; reviewable: boolean; confirming: boolean;
  onSelect: (selected: boolean) => void; onAccept: () => void;
  onDiscard: () => void; onConfirmDiscard: () => void; onCancelDiscard: () => void;
};
export function ObjectReview({ kind, label, status, selected, reviewable, confirming, onSelect, onAccept, onDiscard, onConfirmDiscard, onCancelDiscard }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) cancel.current?.focus(); }, [confirming]);
  if (!status) return null;
  return <div className="object-review-bar" aria-label={`${kind} 产物审阅`}>
    <label><input type="checkbox" aria-label={`选择产物 ${label}`} checked={selected} disabled={!reviewable || confirming} onChange={e => onSelect(e.target.checked)} /><span>已审阅当前版本</span></label>
    {status === "pending" && <div className="object-review-actions">{confirming ? <><span>确定放弃这份草稿？</span><button ref={cancel} className="button-secondary" onClick={onCancelDiscard}>取消放弃</button><button className="button-danger" onClick={onDiscard}>确认放弃</button></> : <><button className="button-secondary" disabled={!reviewable || !selected} onClick={onConfirmDiscard}>放弃</button><button className="button-primary" disabled={!reviewable || !selected} onClick={onAccept}>确认</button></>}</div>}
  </div>;
}
