import type {ComponentType} from "react";

import {
  ArrowRightArrowLeft,
  ArrowRightFromSquare,
  ChartColumn,
  CircleQuestion,
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
