import type {ComponentType} from "react";

import {
  ArrowRightArrowLeft,
  ArrowRightFromSquare,
  ChartColumn,
  CircleQuestion,
  FileArrowDown,
  Gear,
  House,
  Receipt,
  Terminal,
} from "@gravity-ui/icons";

export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: ComponentType<{className?: string}>;
  readonly badge?: string;
  readonly external?: boolean;
};

export const GITHUB_REPO_URL = "https://github.com/maceip/Outrider";

export const NAV_ITEMS: readonly NavItem[] = [
  {href: "/", icon: House, label: "Dashboard"},
  {href: "/traffic", icon: ArrowRightArrowLeft, label: "Traffic"},
  {href: "/inspector", icon: Terminal, label: "Inspector"},
  {href: "/analytics", icon: ChartColumn, label: "Analytics"},
  {href: "/orders", icon: Receipt, label: "Receipts"},
  {href: "/settings", icon: Gear, label: "Settings"},
] as const;

export const FOOTER_ITEMS: readonly NavItem[] = [
  {href: "/help", icon: CircleQuestion, label: "Help"},
  {external: true, href: GITHUB_REPO_URL, icon: ArrowRightFromSquare, label: "GitHub"},
] as const;

export const WWW_NAV_ITEMS: readonly NavItem[] = [
  {href: "#overview", icon: House, label: "Overview"},
  {href: "#demo", icon: ArrowRightArrowLeft, label: "Live Traffic"},
  {href: "#receipt-lab", icon: Receipt, label: "Access Passes"},
  {href: "#downloads", icon: FileArrowDown, label: "Downloads"},
] as const;

export const WWW_FOOTER_ITEMS: readonly NavItem[] = [
  {external: true, href: GITHUB_REPO_URL, icon: ArrowRightFromSquare, label: "GitHub"},
] as const;
