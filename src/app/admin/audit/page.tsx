import { prisma } from "@/lib/db";
import { getServerT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const { t, locale } = await getServerT();
  const nf = locale === "ru" ? "ru-RU" : "en-US";

  const rows = await prisma.adminAudit.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Известные действия имеют локализованную метку; неизвестные показываем как есть.
  const actionLabel = (action: string) => {
    const key = `admin.audit.action.${action}`;
    const label = t(key);
    return label === key ? action : label;
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.audit.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.audit.subtitle", { n: rows.length })}</p>

      <div className="mt-6 card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                <th className="px-5 py-2 font-medium">{t("admin.audit.th.time")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.audit.th.admin")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.audit.th.action")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.audit.th.target")}</th>
                <th className="px-5 py-2 font-medium">{t("admin.audit.th.detail")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                  <td className="px-5 py-2.5 text-muted whitespace-nowrap text-xs">
                    {r.createdAt.toLocaleString(nf)}
                  </td>
                  <td className="px-3 py-2.5 text-muted whitespace-nowrap">{r.actorEmail}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{actionLabel(r.action)}</td>
                  <td className="px-3 py-2.5">
                    {r.targetLabel ?? t("admin.dash")}
                    {r.targetType && <span className="text-faint text-xs"> · {r.targetType}</span>}
                  </td>
                  <td className="px-5 py-2.5 text-muted text-xs">{r.detail ?? t("admin.dash")}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">{t("admin.audit.empty")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
