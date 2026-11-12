import { requireUser } from "@/auth/session";
import { AssistantChat } from "@/ui/assistant-chat";

export const dynamic = "force-dynamic";

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 500) : undefined;
  return (
    <main className="page page-chat">
      <AssistantChat initialQuestion={q} />
    </main>
  );
}
