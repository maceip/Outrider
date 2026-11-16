import type {ComponentType} from "react";

import {
  ArrowRightArrowLeft,
  ArrowRightFromSquare,
  ChartColumn,
  CircleQuestion,
  Gear,
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

export type WorkspaceSegmentId = "/" | "/traffic" | "/orders" | "/analytics";

export const WORKSPACE_SEGMENTS: ReadonlyArray<{
  readonly href: WorkspaceSegmentId;
  readonly label: string;
}> = [
  {href: "/", label: "Transactions"},
  {href: "/traffic", label: "Capture"},
  {href: "/orders", label: "Orders"},
  {href: "/analytics", label: "Overview"},
] as const;

export const NAV_ITEMS: readonly NavItem[] = [
  {href: "/", icon: ArrowRightArrowLeft, label: "Transactions"},
  {href: "/traffic", icon: Terminal, label: "Capture"},
  {href: "/orders", icon: Receipt, label: "Orders"},
  {href: "/analytics", icon: ChartColumn, label: "Overview"},
  {href: "/settings", icon: Gear, label: "Settings"},
] as const;

export const FOOTER_ITEMS: readonly NavItem[] = [
  {href: "/help", icon: CircleQuestion, label: "Help"},
  {external: true, href: GITHUB_REPO_URL, icon: ArrowRightFromSquare, label: "GitHub"},
] as const;
