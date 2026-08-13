import AdminRecommendations from "@/components/AdminRecommendations";

export const dynamic = "force-dynamic";

export default function AdminRecommendationsPage() {
  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Рекомендации</h1>
      <p className="mt-1 text-sm text-muted">
        Дневные уровни + сетапы «пробой» / «ложный пробой» по всем USDT-M бессрочным фьючерсам
        Binance. Статус последнего пересчёта, ручной пересчёт и настройки раздела для пользователей.
      </p>
      <AdminRecommendations />
    </div>
  );
}
