"use client";
import { useI18n } from "@/features/i18n/provider";
import Image from "next/image";

/** Official supplied assets. Product identity always precedes company identity. */
export function BrandLockup() {
  const { t: tr } = useI18n();
  return <div className="brand-lockup" aria-label={tr("天枢 · 公司标识")}>
    <Image className="brand-product-logo" src="/brand/tianshu.png" alt={tr("天枢")} width={40} height={40} priority />
    <span className="brand-product-name">{tr("天枢")}</span>
    <span className="brand-separator" aria-hidden="true" />
    <Image className="brand-company-logo" src="/brand/company.png" alt={tr("公司标识")} width={80} height={42} priority />
  </div>;
}
