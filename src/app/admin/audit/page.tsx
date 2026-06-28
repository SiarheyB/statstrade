import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  "user.delete": "Удаление пользователя",
  "user.reset2fa": "Сброс 2FA",
  "account.sync": "Запуск синхронизации",
  "account.reset": "Сброс статуса синка",
  "content.refresh": "Обновление фида",
};

export default async function AdminAuditPage() {
  const rows = await prisma.adminAudit.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Аудит действий</h1>
      <p className="mt-1 text-sm text-muted">Последние {rows.length} действий администраторов.</p>

      <div className="mt-6 card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                <th className="px-5 py-2 font-medium">Время</th>
                <th className="px-3 py-2 font-medium">Админ</th>
                <th className="px-3 py-2 font-medium">Действие</th>
                <th className="px-3 py-2 font-medium">Объект</th>
                <th className="px-5 py-2 font-medium">Детали</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                  <td className="px-5 py-2.5 text-muted whitespace-nowrap text-xs">
                    {r.createdAt.toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2.5 text-muted whitespace-nowrap">{r.actorEmail}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="px-3 py-2.5">
                    {r.targetLabel ?? "—"}
                    {r.targetType && <span className="text-faint text-xs"> · {r.targetType}</span>}
                  </td>
                  <td className="px-5 py-2.5 text-muted text-xs">{r.detail ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">Пока нет записей.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
