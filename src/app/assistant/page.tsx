import { getModelClient } from "@/llm/model-client";
import { processEnv } from "@/integrations/status";
import { AssistantChat } from "@/ui/assistant-chat";

export const dynamic = "force-dynamic";

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 500) : undefined;
  let modeLabel = "Offline mode";
  try {
    const model = getModelClient(processEnv());
    if (model) modeLabel = `${model.provider}:${model.model}`;
  } catch {
    modeLabel = "Model misconfigured";
  }
  return (
    <main className="page page-chat">
      <AssistantChat initialQuestion={q} modeLabel={modeLabel} />
    </main>
  );
}
