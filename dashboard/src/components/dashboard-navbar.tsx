"use client";

import type {WorkspaceSegmentId} from "../nav-items";

import {Button} from "@heroui/react";
import {Navbar, Segment} from "@heroui-pro/react";
import {useMemo} from "react";

import {useCoreStore} from "../lib/core-store";
import {withWwwBasePath} from "../lib/www-base-path";
import {WORKSPACE_SEGMENTS} from "../nav-items";

import {useThemeMode} from "./theme-toggle";

export interface DashboardNavbarProps {
  normalizedPathname?: string;
  onNavigate?: (href: string) => void;
}

export function DashboardNavbar({
  normalizedPathname = "/",
  onNavigate,
}: DashboardNavbarProps) {
  const {exportHar} = useCoreStore();
  const theme = useThemeMode();
  const isDark = theme === "brutalism-dark";

  const activeSegment = useMemo<WorkspaceSegmentId | "">(() => {
    if (normalizedPathname === "/" || normalizedPathname === "/inspector") {
      return "/";
    }
    if (
      normalizedPathname === "/traffic" ||
      normalizedPathname === "/orders" ||
      normalizedPathname === "/analytics"
    ) {
      return normalizedPathname;
    }

    return "";
  }, [normalizedPathname]);

  const handleNavigate = (href: string) => {
    onNavigate?.(href);
  };

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
        </Navbar.Brand>

        <Segment
          aria-label="Workspace navigation"
          className="shrink-0"
          selectedKey={activeSegment}
          size="sm"
          onSelectionChange={(key) => handleNavigate(String(key))}
        >
          {WORKSPACE_SEGMENTS.map((segment) => (
            <Segment.Item key={segment.href} id={segment.href}>
              {segment.label}
            </Segment.Item>
          ))}
        </Segment>

        <Navbar.Content className="shrink-0 gap-1.5">
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
