import type { DaemonClient, FileReadResult } from "@getpaseo/client/internal/daemon-client";
import { describe, expect, it } from "vitest";
import { readWorkspaceBrowserDefaultUrl } from "./default-url";

function createFileResult(contents: string): FileReadResult {
  return {
    bytes: new TextEncoder().encode(contents),
    mime: "application/json",
    size: 0,
    path: "paseo.json",
    kind: "text",
    modifiedAt: "2026-09-21T00:00:00.000Z",
  };
}

function createFileReader(contents: string): Pick<DaemonClient, "readFile"> {
  return {
    async readFile(cwd, path) {
      if (cwd !== "/repo/worktree" || path !== "paseo.json") {
        throw new Error("Unexpected config path");
      }
      return createFileResult(contents);
    },
  };
}

function createConfigReader(config: unknown): Pick<DaemonClient, "readFile"> {
  return createFileReader(JSON.stringify(config));
}

describe("readWorkspaceBrowserDefaultUrl", () => {
  it("reads the browser default URL from the workspace paseo.json", async () => {
    const defaultUrl = await readWorkspaceBrowserDefaultUrl({
      client: createConfigReader({ browser: { defaultUrl: "https://app.example.test" } }),
      workspaceDirectory: "/repo/worktree",
    });

    expect(defaultUrl).toBe("https://app.example.test");
  });

  it("uses no custom default when paseo.json has no browser default", async () => {
    const defaultUrl = await readWorkspaceBrowserDefaultUrl({
      client: createConfigReader({ scripts: {} }),
      workspaceDirectory: "/repo/worktree",
    });

    expect(defaultUrl).toBeNull();
  });

  it("uses no custom default when the configured URL is invalid", async () => {
    const defaultUrl = await readWorkspaceBrowserDefaultUrl({
      client: createConfigReader({ browser: { defaultUrl: "file:///tmp/app.html" } }),
      workspaceDirectory: "/repo/worktree",
    });

    expect(defaultUrl).toBeNull();
  });

  it("uses no custom default when paseo.json is malformed", async () => {
    const defaultUrl = await readWorkspaceBrowserDefaultUrl({
      client: createFileReader("{"),
      workspaceDirectory: "/repo/worktree",
    });

    expect(defaultUrl).toBeNull();
  });

  it("uses no custom default when paseo.json cannot be read", async () => {
    const defaultUrl = await readWorkspaceBrowserDefaultUrl({
      client: {
        async readFile() {
          throw new Error("File unavailable");
        },
      },
      workspaceDirectory: "/repo/worktree",
    });

    expect(defaultUrl).toBeNull();
  });
});
