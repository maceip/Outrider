"use client";

import type {ProbePolicy} from "../lib/types";
import type {FormEvent} from "react";

import {Button, Input, Label, Separator, TextField} from "@heroui/react";
import {useState} from "react";

import {useOutrider} from "../lib/outrider-store";
import {formatClefState} from "../lib/types";

export function SettingsPage() {
  const {busy, clefStatus, mutate, probePolicy, publicStatus, snapshot, unlocked} = useOutrider();
  const [draftPolicy, setDraftPolicy] = useState<ProbePolicy | null>(null);
  const [skillsPath, setSkillsPath] = useState("");

  const effectivePolicy = draftPolicy ?? probePolicy;

  const handlePolicySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await mutate("/probe-policy", {probe_policy: effectivePolicy});
    setDraftPolicy(null);
  };

  const handleLoadSkills = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!skillsPath.trim()) return;
    await mutate("/skills/load", {path: skillsPath.trim()});
    setSkillsPath("");
  };

  const disabledReason = !unlocked
    ? "Admin token required"
    : busy
      ? "Backend action in progress"
      : undefined;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-5 pb-10 pt-4">
      <p className="text-muted text-sm text-pretty">
        Configure active MCP probe policy, load skill catalogs, and inspect gateway cryptographic
        state.
      </p>

      <Separator />

      <form
        className="grid grid-cols-1 gap-4 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-10"
        onSubmit={(e) => void handlePolicySubmit(e)}
      >
        <div className="flex flex-col gap-1">
          <span className="text-foreground text-sm font-medium">Active Probe Policy</span>
          <p className="text-muted text-xs leading-snug text-pretty">
            Controls whether sampling-capable MCP sessions are probed automatically, on operator
            request, or disabled.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[220px] flex-col gap-1.5">
            <label className="text-foreground text-xs font-medium" htmlFor="gateway-probe-policy">
              Probe policy
            </label>
            <select
              className="border-border bg-surface text-foreground h-9 rounded-lg border px-3 text-sm"
              disabled={Boolean(disabledReason)}
              id="gateway-probe-policy"
              value={effectivePolicy}
              onChange={(e) => setDraftPolicy(e.target.value as ProbePolicy)}
            >
              <option value="off">off</option>
              <option value="on-request">on-request</option>
              <option value="auto">auto</option>
            </select>
          </div>
          <span title={disabledReason}>
            <Button isDisabled={Boolean(disabledReason)} size="sm" type="submit">
              Save Policy
            </Button>
          </span>
        </div>
      </form>

      <Separator />

      <form
        className="grid grid-cols-1 gap-4 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-10"
        onSubmit={(e) => void handleLoadSkills(e)}
      >
        <div className="flex flex-col gap-1">
          <span className="text-foreground text-sm font-medium">Skill Catalog Directory</span>
          <p className="text-muted text-xs leading-snug text-pretty">
            Load MCP skill descriptors from a local directory into persisted catalog items.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            className="min-w-[260px] flex-1"
            isDisabled={Boolean(disabledReason)}
            name="skills-path"
            value={skillsPath}
            onChange={setSkillsPath}
          >
            <Label>Skills directory path</Label>
            <Input fullWidth placeholder="/path/to/skills" />
          </TextField>
          <span title={disabledReason}>
            <Button
              isDisabled={Boolean(disabledReason) || !skillsPath.trim()}
              size="sm"
              type="submit"
              variant="secondary"
            >
              Load Skills
            </Button>
          </span>
        </div>
      </form>

      <Separator />

      <div className="grid grid-cols-1 gap-4 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-10">
        <div className="flex flex-col gap-1">
          <span className="text-foreground text-sm font-medium">Runtime & Ed25519 Authority</span>
          <p className="text-muted text-xs leading-snug text-pretty">
            Persisted receipt signing key and CLEF LiteRT-LM runtime status.
          </p>
        </div>
        <dl className="grid grid-cols-[140px_1fr] gap-2 text-xs">
          <dt className="text-muted">CLEF Engine</dt>
          <dd className="font-mono">{formatClefState(clefStatus)}</dd>
          <dt className="text-muted">Remote Admin</dt>
          <dd className="font-mono">{publicStatus?.admin_allow_remote ? "enabled" : "loopback-only"}</dd>
          <dt className="text-muted">Ed25519 Public Key</dt>
          <dd className="break-all font-mono">
            {snapshot?.public_key ?? "Unlock session to read public key"}
          </dd>
        </dl>
      </div>
    </div>
  );
}
