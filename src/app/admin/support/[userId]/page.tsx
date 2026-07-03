import AdminSupportThread from "@/components/AdminSupportThread";

export const dynamic = "force-dynamic";

export default async function AdminSupportThreadPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <AdminSupportThread userId={userId} />
    </div>
  );
}
