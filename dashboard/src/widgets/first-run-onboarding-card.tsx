"use client";

import {PlugConnection, Rocket, ShieldCheck} from "@gravity-ui/icons";
import {Button} from "@heroui/react";
import {useRouter} from "next/navigation";
import {useState} from "react";

import {useOutrider} from "../lib/outrider-store";

export function FirstRunOnboardingCard() {
  const router = useRouter();
  const {busy, openDialog, publicStatus, runLoopbackSortie, snapshot, unlocked} = useOutrider();
  const [sortieRunning, setSortieRunning] = useState(false);
  const [sortieError, setSortieError] = useState<string | null>(null);

  if (!unlocked || !snapshot || snapshot.agent_sessions.length > 0) {
    return null;
  }

  const mcpEndpoint = publicStatus?.mcp_endpoint ?? "http://127.0.0.1:8080/mcp";

  const handleSortie = async () => {
    setSortieError(null);
    setSortieRunning(true);
    try {
      await runLoopbackSortie("Outrider Panel-1 Sortie Agent");
    } catch (error) {
      setSortieError(error instanceof Error ? error.message : "Loopback TLS sortie failed.");
    } finally {
      setSortieRunning(false);
    }
  };

  return (
    <section
      aria-label="First-run agent onboarding"
      className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4"
      id="first-run-onboarding"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-foreground text-sm font-semibold">
              No Agent Sessions Recorded Yet
            </h2>
            <span className="border-border bg-background text-muted rounded-md border px-2 py-0.5 font-mono text-xs">
              {mcpEndpoint}
            </span>
          </div>
          <p className="text-muted text-xs">
            Pair Claude or Codex locally, play the buyer agent in the built-in WebMCP Command
            Center, or execute a real loopback TLS 1.3 + MCP 2026-07-28 sortie to populate live
            evidence immediately in any browser.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          isDisabled={busy || sortieRunning}
          size="sm"
          onPress={() => router.push("/zim/")}
        >
          <Rocket aria-hidden="true" className="size-3.5" />
          Open Command Center
        </Button>

        <Button
          isDisabled={busy || sortieRunning}
          size="sm"
          variant="secondary"
          onPress={() => void handleSortie()}
        >
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          {sortieRunning ? "Running TLS Sortie..." : "Launch 1-Click TLS Sortie"}
        </Button>

        <Button
          isDisabled={busy || sortieRunning}
          size="sm"
          variant="secondary"
          onPress={() => openDialog("connect-local-agents")}
        >
          <PlugConnection aria-hidden="true" className="size-3.5" />
          Scan Claude &amp; Codex
        </Button>
      </div>

      {sortieError ? (
        <div
          className="border-danger/40 bg-danger/10 text-danger rounded-lg border p-2 text-xs"
          role="alert"
        >
          {sortieError}
        </div>
      ) : null}
    </section>
  );
}
