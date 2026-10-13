"use client";
import { useI18n } from "@/features/i18n/provider";
import { LoadingDots } from "./loading";
/** One render commits the system status and its dots; never transforms Agent content. */
export function TaskProgress({ text, pending }: { text: string; pending: boolean }) {
  const { t: tr } = useI18n();
  const label = pending ? tr(text).replace(/(?:\.{3}|…)+\s*$/, "") : tr(text);
  return <span className={pending ? "task-progress" : undefined}>
    {pending && <LoadingDots />}<span>{label}</span>
  </span>;
}
