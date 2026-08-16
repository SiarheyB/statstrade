import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import DashboardNav from "@/components/DashboardNav";
import SyncProvider from "@/components/SyncProvider";
import { SidebarProvider } from "@/lib/sidebar/provider";
import DemoBanner from "@/components/landing/DemoBanner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <SyncProvider>
      <SidebarProvider>
        <div className="md:flex min-h-screen">
          <DashboardNav email={session.email} isAdmin={isAdminSession(session)} demo={session.demo === true} />
          <main className="flex-1 min-w-0 overflow-x-hidden">
            {session.demo && <DemoBanner />}
            {children}
          </main>
        </div>
      </SidebarProvider>
    </SyncProvider>
  );
}
