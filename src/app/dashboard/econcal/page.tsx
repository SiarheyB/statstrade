import { redirect } from "next/navigation";
import { CalendarOff } from "lucide-react";
import { getSession } from "@/lib/auth";
import { calendarSettings } from "@/lib/econcal";
import EconCalView from "./EconCalView";

export const dynamic = "force-dynamic";

// Серверная проверка общего выключателя календаря (фича `econcal`,
// переключается в /admin/content). Пункт меню при выключенной фиче и так
// пропадает (см. DashboardNav), но это защита от прямого захода по адресу —
// тот же приём, что у «Рекомендаций» и форекса.
//
// Выключатель один и действует на ВСЕХ, включая админа: это рубильник раздела,
// а не обкатка перед публичным релизом, поэтому пары
// «общий + доступ для пользователей» здесь нет.
export default async function EconCalPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { enabled } = await calendarSettings();
  if (!enabled) {
    return (
      <div className="p-6 md:p-8 max-w-2xl">
        <div className="card p-6 flex items-start gap-3">
          <CalendarOff size={24} className="text-muted shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-fg">Календарь отключён</div>
            <p className="mt-1 text-sm text-muted">
              Раздел «Экономический календарь» временно отключён администратором.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <EconCalView />;
}
