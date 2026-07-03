import AdminDonate from "@/components/AdminDonate";

export const dynamic = "force-dynamic";

export default function AdminDonatePage() {
  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Кошельки для донатов</h1>
      <p className="mt-1 text-sm text-muted">
        Адреса, которые пользователь видит в кнопке «Донат» в меню. Можно отключить кошелёк без удаления
        или добавить новую сеть.
      </p>
      <AdminDonate />
    </div>
  );
}
