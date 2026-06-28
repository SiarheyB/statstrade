import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import DashboardNav from "@/components/DashboardNav";
import SyncProvider from "@/components/SyncProvider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <SyncProvider>
      <div className="md:flex min-h-screen">
        <DashboardNav email={session.email} isAdmin={isAdminSession(session)} />
        <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
      </div>
    </SyncProvider>
  );
}
