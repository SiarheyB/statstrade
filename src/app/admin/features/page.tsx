import AdminFeatures from "@/components/AdminFeatures";

export const dynamic = "force-dynamic";

export default function AdminFeaturesPage() {
  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Функции</h1>
      <p className="mt-1 text-sm text-muted">
        Включение/отключение опциональных фич и их лимиты (например частота запросов к публичным
        API бирж). Отключённая фича скрывается у всех пользователей.
      </p>
      <AdminFeatures />
    </div>
  );
}
