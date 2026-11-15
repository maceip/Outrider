"use client";

import type {ReactNode} from "react";

import {AppLayout} from "@heroui-pro/react";
import {usePathname, useRouter} from "next/navigation";
import {useCallback, useMemo} from "react";

import {FOOTER_ITEMS, NAV_ITEMS} from "../nav-items";

import {DashboardNavbar} from "./dashboard-navbar";
import {DashboardSidebar} from "./dashboard-sidebar";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";
const HOME_TITLE = IS_WWW ? "Outrider" : "Dashboard";

const ROUTE_LABELS = new Map<string, string>(
  [...NAV_ITEMS, ...FOOTER_ITEMS]
    .filter((item) => !item.external)
    .map((item) => [item.href, item.label]),
);

export interface AppShellProps {
  children: ReactNode;
  /**
   * Prefix used for navigation and active-state matching.
   * Empty in standalone/Next (`basePath: "/__proxyfor__"` is handled by Next's router).
   */
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

      if (href.startsWith("#")) {
        const targetId = href.slice(1);
        const element = document.getElementById(targetId);

        if (element) {
          element.scrollIntoView({behavior: "smooth", block: "start"});
        }
        window.history.replaceState(null, "", href);
        window.dispatchEvent(new HashChangeEvent("hashchange"));

        return;
      }

      const prefixed = basePath + href;
      const route = prefixed.startsWith("/__proxyfor__")
        ? prefixed.slice("/__proxyfor__".length) || "/"
        : prefixed;

      router.push(route);
    },
    [router, basePath],
  );

  const title = useMemo(() => {
    if (IS_WWW) return "Outrider";
    const sliced = pathname.slice(basePath.length) || "/";
    const relative = sliced.length > 1 ? sliced.replace(/\/+$/, "") : sliced;

    if (relative === "/" || relative === "") return HOME_TITLE;

    return ROUTE_LABELS.get(relative) ?? HOME_TITLE;
  }, [pathname, basePath]);

  return (
    <AppLayout
      className="bg-background text-foreground"
      navbar={<DashboardNavbar title={title} />}
      navigate={navigate}
      sidebar={<DashboardSidebar basePath={basePath} pathname={pathname} />}
      sidebarCollapsible="offcanvas"
    >
      {children}
    </AppLayout>
  );
}
