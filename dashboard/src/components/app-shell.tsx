"use client";

import type {ReactNode} from "react";

import {AppLayout} from "@heroui-pro/react";
import {usePathname, useRouter} from "next/navigation";
import {useCallback, useMemo} from "react";

import {WWW_BASE_PATH} from "../lib/www-base-path";
import {FOOTER_ITEMS, NAV_ITEMS} from "../nav-items";

import {DashboardNavbar} from "./dashboard-navbar";
import {DashboardSidebar} from "./dashboard-sidebar";

const HOME_TITLE = "Dashboard";

const ROUTE_LABELS = new Map<string, string>(
  [...NAV_ITEMS, ...FOOTER_ITEMS]
    .filter((item) => !item.external)
    .map((item) => [item.href, item.label]),
);

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

  const title = useMemo(() => {
    if (normalizedPathname === "/") return HOME_TITLE;

    return ROUTE_LABELS.get(normalizedPathname) ?? HOME_TITLE;
  }, [normalizedPathname]);

  return (
    <AppLayout
      className="bg-background text-foreground"
      navbar={<DashboardNavbar title={title} />}
      navigate={navigate}
      sidebar={<DashboardSidebar basePath="" pathname={normalizedPathname} />}
      sidebarCollapsible="offcanvas"
    >
      {children}
    </AppLayout>
  );
}
