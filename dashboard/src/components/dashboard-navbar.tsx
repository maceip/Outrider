"use client";

import {Button, Chip} from "@heroui/react";
import {Navbar} from "@heroui-pro/react";

import {useCoreStore} from "../lib/core-store";
import {withWwwBasePath} from "../lib/www-base-path";

import {useThemeMode} from "./theme-toggle";

export interface DashboardNavbarProps {
  normalizedPathname?: string;
  onNavigate?: (href: string) => void;
}

export function DashboardNavbar({
  normalizedPathname = "/",
  onNavigate,
}: DashboardNavbarProps) {
  const {connected, exportHar, snapshot, traffics} = useCoreStore();
  const theme = useThemeMode();
  const isDark = theme === "brutalism-dark";

  const activePassCount = (snapshot?.capability_receipts ?? []).filter(
    (row) => row.revoked === 0 && row.remaining_calls > 0,
  ).length;

  const handleNavigate = (href: string) => {
    onNavigate?.(href);
  };

  const isOnDesk = normalizedPathname === "/";

  return (
    <Navbar
      className="border-border bg-background border-b"
      height="3rem"
      maxWidth="full"
      size="sm"
    >
      <Navbar.Header className="justify-between gap-3">
        <Navbar.Brand className="gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export served under basePath */}
          <img
            alt="Conduit"
            className="size-6 shrink-0 rounded-sm object-contain"
            height={24}
            src={withWwwBasePath(`/brand/${isDark ? "dark" : "light"}/conduit-icon-64.png`)}
            width={24}
          />
          <span className="text-foreground text-sm font-semibold tracking-[-0.02em]">
            Conduit
          </span>
          <Chip
            className="hidden font-mono tabular-nums sm:inline-flex"
            color={connected ? "success" : "default"}
            size="sm"
            variant="soft"
          >
            {connected ? "Sell-Side Desk · Live" : "Sell-Side Desk"}
          </Chip>
        </Navbar.Brand>

        <Navbar.Content className="shrink-0 gap-1.5">
          {!isOnDesk ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={() => handleNavigate("/")}
            >
              Investigation Desk
            </Button>
          ) : (
            <span className="text-muted hidden pr-2 font-mono text-xs tabular-nums md:inline">
              {`${traffics.length} frames · ${activePassCount} active passes`}
            </span>
          )}

          <Button size="sm" variant="tertiary" onPress={exportHar}>
            Export HAR
          </Button>
          <Button
            size="sm"
            variant={normalizedPathname === "/settings" ? "secondary" : "ghost"}
            onPress={() => handleNavigate("/settings")}
          >
            Settings
          </Button>
          <Button
            size="sm"
            variant={normalizedPathname === "/help" ? "secondary" : "ghost"}
            onPress={() => handleNavigate("/help")}
          >
            Help
          </Button>
        </Navbar.Content>
      </Navbar.Header>
    </Navbar>
  );
}
