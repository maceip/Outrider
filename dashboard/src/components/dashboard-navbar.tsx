"use client";

import type {FormEvent} from "react";

import {ArrowsRotateLeft} from "@gravity-ui/icons";
import {Button, Tooltip} from "@heroui/react";
import {AppLayout, Navbar, Sidebar} from "@heroui-pro/react";
import {useState} from "react";

import {useOutrider} from "../lib/outrider-store";

import {IconButton} from "./icon-button";

export interface DashboardNavbarProps {
  currentRoute?: string;
  title?: string;
}

export function DashboardNavbar({
  currentRoute = "/",
  title = "Overview",
}: DashboardNavbarProps) {
  const {busy, openDialog, refresh, snapshot, statusError, statusMessage, unlock, unlocked} =
    useOutrider();
  const [tokenInput, setTokenInput] = useState("");

  const handleUnlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ok = await unlock(tokenInput);

    if (ok) {
      setTokenInput("");
    }
  };

  const disabledReason = !unlocked
    ? "Admin token required"
    : busy
      ? "Backend action in progress"
      : undefined;

  const hasBundles = (snapshot?.bundles.length ?? 0) > 0;
  const issueDisabledReason = disabledReason ?? (!hasBundles ? "Configure at least one bundle" : undefined);

  return (
    <Navbar maxWidth="full">
      <Navbar.Header className="flex-wrap gap-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <AppLayout.MenuToggle tooltip="Open navigation" />
          <Tooltip>
            <Sidebar.Trigger aria-label="Toggle sidebar" />
            <Tooltip.Content>Toggle sidebar</Tooltip.Content>
          </Tooltip>
          <h1 className="text-foreground truncate text-base font-semibold text-balance">{title}</h1>
          <span
            className={
              unlocked
                ? "border-success/40 bg-success/15 text-success inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs font-medium"
                : "border-border bg-surface text-muted inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs font-medium"
            }
            id="live"
          >
            {unlocked ? "Live" : "Locked"}
          </span>
        </div>

        <span
          aria-live="polite"
          className={
            statusError
              ? "text-danger min-w-0 flex-1 truncate text-xs"
              : "text-muted min-w-0 flex-1 truncate text-xs"
          }
          id="status"
          role="status"
        >
          {statusMessage}
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {!unlocked ? (
            <form className="flex items-center gap-1.5" onSubmit={(e) => void handleUnlock(e)}>
              <input
                aria-label="Admin token"
                autoComplete="off"
                className="border-border bg-surface text-foreground placeholder:text-muted h-8 w-40 rounded-lg border px-2.5 font-mono text-xs focus:outline-2"
                placeholder="Admin token"
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
              <Button isDisabled={busy} size="sm" type="submit">
                Unlock
              </Button>
            </form>
          ) : null}

          {currentRoute !== "/inspector" ? (
            <>
              <span title={disabledReason}>
                <Button
                  isDisabled={Boolean(disabledReason)}
                  size="sm"
                  variant="secondary"
                  onPress={() => openDialog("connect-upstream")}
                >
                  Connect Upstream
                </Button>
              </span>

              <span title={disabledReason}>
                <Button
                  isDisabled={Boolean(disabledReason)}
                  size="sm"
                  variant="secondary"
                  onPress={() => openDialog("put-bundle")}
                >
                  Put Bundle
                </Button>
              </span>

              {currentRoute !== "/" ? (
                <span title={issueDisabledReason}>
                  <Button
                    isDisabled={Boolean(issueDisabledReason)}
                    size="sm"
                    variant="secondary"
                    onPress={() => openDialog("issue-receipt")}
                  >
                    Issue Receipt
                  </Button>
                </span>
              ) : null}
            </>
          ) : null}

          <span title={disabledReason}>
            <IconButton
              isDisabled={Boolean(disabledReason)}
              label="Refresh"
              size="sm"
              tooltip={disabledReason ?? "Refresh commerce snapshot"}
              variant="tertiary"
              onPress={() => void refresh()}
            >
              <ArrowsRotateLeft aria-hidden="true" className="size-4" />
            </IconButton>
          </span>
        </div>
      </Navbar.Header>
    </Navbar>
  );
}
