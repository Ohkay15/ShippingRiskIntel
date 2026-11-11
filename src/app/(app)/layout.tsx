import { requireUser } from "@/auth/session";
import { integrationStatusReport, processEnv, statusCounts } from "@/integrations/status";
import { AppSidebar } from "@/ui/app-sidebar";

/** Every page in this group requires a signed-in user. */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const connected = statusCounts(integrationStatusReport(processEnv())).connected;
  return (
    <div className="app-shell">
      <AppSidebar connectedCount={connected} user={{ name: user.name, email: user.email }} />
      <div className="app-main">{children}</div>
    </div>
  );
}
