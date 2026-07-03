import AdminExchanges from "@/components/AdminExchanges";

export const dynamic = "force-dynamic";

export default function AdminExchangesPage() {
  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Биржи</h1>
      <p className="mt-1 text-sm text-muted">
        Включение/отключение бирж для синхронизации аккаунтов. Отключённая биржа исчезает из формы
        добавления аккаунта. На уже подключённые аккаунты и карты ордеров/ликвидаций не влияет.
      </p>
      <AdminExchanges />
    </div>
  );
}
