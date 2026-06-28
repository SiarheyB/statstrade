import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/admin";
import AdminNav from "@/components/AdminNav";

// Гард админ-раздела: не-админу отдаём 404 (а не 403), чтобы не раскрывать
// существование раздела. Сессия уже гарантирована middleware (валидный JWT) —
// здесь проверяется только принадлежность к ADMIN_EMAILS.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) notFound();

  return (
    <div className="md:flex min-h-screen">
      <AdminNav email={session.email} />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
