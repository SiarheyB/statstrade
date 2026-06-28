import AdminCollector from "@/components/AdminCollector";

export const dynamic = "force-dynamic";

export default function AdminCollectorPage() {
  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Карта ордеров</h1>
      <p className="mt-1 text-sm text-muted">
        Наполнение heatmap лимитных ордеров: статус collector-сервиса и факт записи в Postgres.
      </p>
      <AdminCollector />
    </div>
  );
}
