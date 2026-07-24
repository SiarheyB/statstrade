import AdminAnnouncements from "@/components/AdminAnnouncements";

export const dynamic = "force-dynamic";

export default function AdminAnnouncementsPage() {
  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Объявления</h1>
      <p className="mt-1 text-sm text-muted">
        Управление объявлениями для пользователей. Созданные объявления отображаются
        у всех пользователей в виде колокольчика в сайдбаре.
      </p>
      <AdminAnnouncements />
    </div>
  );
}