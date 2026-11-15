import type {ComponentType} from "react";

import {
  ArrowRightArrowLeft,
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
};

export const NAV_ITEMS: readonly NavItem[] = [
  {href: "/", icon: House, label: "Dashboard"},
  {href: "/traffic", icon: ArrowRightArrowLeft, label: "Traffic"},
  {href: "/inspector", icon: Terminal, label: "Inspector"},
  {href: "/analytics", icon: ChartColumn, label: "Analytics"},
  {href: "/orders", icon: Receipt, label: "Orders"},
  {href: "/settings", icon: Gear, label: "Settings"},
] as const;

export const FOOTER_ITEMS: readonly NavItem[] = [
  {href: "/help", icon: CircleQuestion, label: "Help"},
] as const;
