import { signInRequired } from "@/auth/mode";
import { requireUser } from "@/auth/session";
import { processEnv, statusCounts, visibleIntegrationReport } from "@/integrations/status";
import { AppSidebar } from "@/ui/app-sidebar";

/** Every page in this group requires a signed-in user. */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const connected = statusCounts(visibleIntegrationReport(processEnv())).connected;
  return (
    <div className="app-shell">
      <AppSidebar connectedCount={connected} user={signInRequired() ? { name: user.name, email: user.email } : null} />
      <div className="app-main">{children}</div>
    </div>
  );
}
