import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PaseoConfigSchema } from "@getpaseo/protocol/paseo-config-schema";
import { useFetchQuery } from "@/data/query";
import { useStableEvent } from "@/hooks/use-stable-event";

interface WorkspaceBrowserDefaultUrlInput {
  client: Pick<DaemonClient, "readFile"> | null;
  enabled: boolean;
  serverId: string;
  workspaceDirectory: string | null;
}

export async function readWorkspaceBrowserDefaultUrl(input: {
  client: Pick<DaemonClient, "readFile">;
  workspaceDirectory: string;
}): Promise<string | null> {
  try {
    const file = await input.client.readFile(input.workspaceDirectory, "paseo.json");
    const json: unknown = JSON.parse(new TextDecoder().decode(file.bytes));
    const config = PaseoConfigSchema.parse(json);
    return config.browser?.defaultUrl ?? null;
  } catch (error) {
    if (error instanceof Error) {
      return null;
    }
    throw error;
  }
}

export function useWorkspaceBrowserDefaultUrlResolver(
  input: WorkspaceBrowserDefaultUrlInput,
): () => Promise<string | undefined> {
  const query = useFetchQuery({
    queryKey: ["workspace-browser-default-url", input.serverId, input.workspaceDirectory ?? ""],
    queryFn: () => {
      if (!input.client || !input.workspaceDirectory) {
        return null;
      }
      return readWorkspaceBrowserDefaultUrl({
        client: input.client,
        workspaceDirectory: input.workspaceDirectory,
      });
    },
    enabled: input.enabled && Boolean(input.client && input.workspaceDirectory),
    retry: false,
    dataShape: "value",
    staleTimeMs: 0,
  });

  return useStableEvent(async () => {
    if (!input.client || !input.workspaceDirectory) {
      return undefined;
    }
    const result = await query.refetch({ cancelRefetch: false });
    return result.data ?? undefined;
  });
}
