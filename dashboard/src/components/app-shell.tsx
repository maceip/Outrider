"use client";

import type {ReactNode} from "react";

import {AppLayout} from "@heroui-pro/react";
import {usePathname, useRouter} from "next/navigation";
import {useCallback, useMemo} from "react";

import {FOOTER_ITEMS, NAV_ITEMS} from "../nav-items";

import {DashboardNavbar} from "./dashboard-navbar";
import {DashboardSidebar} from "./dashboard-sidebar";

export const GATEWAY_BASE_PATH = "/__proxyfor__";

const ROUTE_LABELS = new Map<string, string>(
  [...NAV_ITEMS, ...FOOTER_ITEMS].map((item) => [item.href, item.label]),
);

export function normalizeRoutePath(rawPath: string, basePath = GATEWAY_BASE_PATH): string {
  let path = rawPath || "/";

  if (basePath && path.startsWith(basePath)) {
    path = path.slice(basePath.length) || "/";
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.length > 1 && path.endsWith("/")) {
    path = path.replace(/\/+$/, "");
  }

  return path || "/";
}

export interface AppShellProps {
  children: ReactNode;
  basePath?: string;
}

export function AppShell({basePath = GATEWAY_BASE_PATH, children}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  const currentRoute = useMemo(() => normalizeRoutePath(pathname, basePath), [pathname, basePath]);

  const navigate = useCallback(
    (href: string) => {
      const target = normalizeRoutePath(href, basePath);

      router.push(target === "/" ? "/" : `${target}/`);
    },
    [router, basePath],
  );

  const title = ROUTE_LABELS.get(currentRoute) ?? "Overview";

  return (
    <AppLayout
      navbar={<DashboardNavbar currentRoute={currentRoute} title={title} />}
      navigate={navigate}
      scrollMode="content"
      sidebar={<DashboardSidebar basePath={basePath} currentRoute={currentRoute} />}
      sidebarCollapsible="offcanvas"
    >
      {children}
    </AppLayout>
  );
}
