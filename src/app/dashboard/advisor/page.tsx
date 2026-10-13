import { getSession } from "@/lib/auth";
import { getAdvisorLabel } from "@/lib/advisorFile";
import AdvisorView from "./AdvisorView";

// Сессию проверяет layout кабинета; здесь нужно только знать, демо ли это:
// в демо-режиме («без регистрации») советник не скачивается (см. /api/advisor/download).
export default async function AdvisorPage() {
  const session = await getSession();
  return <AdvisorView canDownload={!!session && !session.demo} version={await getAdvisorLabel()} />;
}
