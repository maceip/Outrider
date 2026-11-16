"use client";

import type {ReactNode} from "react";

import {Link} from "@heroui/react";
import {AppLayout, Segment} from "@heroui-pro/react";
import {usePathname, useRouter} from "next/navigation";
import {useCallback, useMemo} from "react";

import {WWW_BASE_PATH} from "../lib/www-base-path";
import {GITHUB_REPO_URL} from "../nav-items";

import {DashboardNavbar} from "./dashboard-navbar";
import {setSilvectorTheme, useThemeMode} from "./theme-toggle";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";

function normalizeRoutePath(rawPathname: string, basePath: string): string {
  let clean = rawPathname;

  if (basePath && clean.startsWith(basePath)) {
    clean = clean.slice(basePath.length);
  }
  if (clean.startsWith("/__proxyfor__")) {
    clean = clean.slice("/__proxyfor__".length);
  }
  if (WWW_BASE_PATH && clean.startsWith(WWW_BASE_PATH)) {
    clean = clean.slice(WWW_BASE_PATH.length);
  }
  if (!clean || clean === "/") return "/";

  return clean.replace(/\/+$/, "") || "/";
}

function ConduitFooter() {
  const theme = useThemeMode();
  const isDark = theme === "brutalism-dark";

  return (
    <div className="border-border bg-background flex items-center justify-between gap-4 border-t px-6 py-2">
      <Segment
        aria-label="Color theme"
        selectedKey={isDark ? "dark" : "light"}
        size="sm"
        onSelectionChange={(key) => {
          setSilvectorTheme(key === "light" ? "brutalism-light" : "brutalism-dark");
        }}
      >
        <Segment.Item id="dark">Dark</Segment.Item>
        <Segment.Item id="light">Light</Segment.Item>
      </Segment>

      <Link
        className="text-muted hover:text-foreground text-xs font-medium no-underline"
        href={GITHUB_REPO_URL}
        rel="noopener noreferrer"
        target="_blank"
      >
        GitHub
      </Link>
    </div>
  );
}

export interface AppShellProps {
  children: ReactNode;
  basePath?: string;
}

export function AppShell({basePath = "", children}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  const navigate = useCallback(
    (href: string) => {
      if (href.startsWith("http://") || href.startsWith("https://")) {
        window.open(href, "_blank", "noopener,noreferrer");

        return;
      }

      const route = normalizeRoutePath(basePath + href, "");

      router.push(route);
    },
    [router, basePath],
  );

  const normalizedPathname = useMemo(
    () => normalizeRoutePath(pathname, basePath),
    [pathname, basePath],
  );

  if (IS_WWW) {
    return <main className="bg-background text-foreground min-h-dvh">{children}</main>;
  }

  return (
    <AppLayout
      className="bg-background text-foreground"
      footer={<ConduitFooter />}
      navbar={<DashboardNavbar normalizedPathname={normalizedPathname} onNavigate={navigate} />}
      navigate={navigate}
      toggleShortcut={false}
    >
      {children}
    </AppLayout>
  );
}
