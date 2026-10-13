"use client";
import { useI18n } from "@/features/i18n/provider";
import Image from "next/image";
import { BrandWordmark } from "./brand-wordmark";

/** Official supplied assets. Product identity always precedes company identity. */
export function BrandLockup() {
  const { t: tr } = useI18n();
  return <div className="brand-lockup" aria-label={tr("天枢 · 公司标识")}>
    <Image className="brand-product-logo" src="/brand/tianshu.png" alt={tr("天枢")} width={40} height={40} priority />
    <BrandWordmark />
    <span className="brand-separator" aria-hidden="true" />
    <Image className="brand-company-logo" src="/brand/company.png" alt={tr("公司标识")} width={680} height={366} priority />
  </div>;
}
