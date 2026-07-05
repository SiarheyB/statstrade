import AdminErrors from "@/components/AdminErrors";

export const dynamic = "force-dynamic";

export default function AdminErrorsPage() {
  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Логи ошибок</h1>
      <p className="mt-1 text-sm text-muted">
        Серверные ошибки (500-е ответы API и необработанные исключения). Открытие страницы отмечает всё
        прочитанным.
      </p>
      <AdminErrors />
    </div>
  );
}
