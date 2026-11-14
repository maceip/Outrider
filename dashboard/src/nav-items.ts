import type {ComponentType} from "react";

import {
  ChartColumn,
  CircleQuestion,
  DisplayPulse,
  Gear,
  House,
  ListCheck,
  Receipt,
} from "@gravity-ui/icons";

export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: ComponentType<{className?: string}>;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {href: "/", icon: House, label: "Overview"},
  {href: "/orders", icon: Receipt, label: "Commerce & Receipts"},
  {href: "/tracker", icon: ListCheck, label: "Sessions & Evidence"},
  {href: "/analytics", icon: ChartColumn, label: "CLEF & Telemetry"},
  {href: "/inspector", icon: DisplayPulse, label: "MCP Inspector"},
  {href: "/settings", icon: Gear, label: "Gateway Settings"},
] as const;

export const FOOTER_ITEMS: readonly NavItem[] = [
  {href: "/help", icon: CircleQuestion, label: "Certificates & Protocol"},
] as const;
