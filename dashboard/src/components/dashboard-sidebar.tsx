"use client";

import type {NavItem} from "../nav-items";

import {Chip} from "@heroui/react";
import {Sidebar} from "@heroui-pro/react";

import {useCoreStore} from "../lib/core-store";
import {FOOTER_ITEMS, NAV_ITEMS} from "../nav-items";
import {useThemeMode} from "./theme-toggle";

interface DashboardSidebarProps {
  pathname: string;
  basePath: string;
  disableNavigation?: boolean;
}

export function DashboardSidebar({
  basePath,
  disableNavigation = false,
  pathname,
}: DashboardSidebarProps) {
  return (
    <>
      <Sidebar>
        <SidebarContents
          basePath={basePath}
          disableNavigation={disableNavigation}
          pathname={pathname}
        />
      </Sidebar>
      <Sidebar.Mobile>
        <SidebarContents
          basePath={basePath}
          disableNavigation={disableNavigation}
          idPrefix="mobile-"
          pathname={pathname}
        />
      </Sidebar.Mobile>
    </>
  );
}

interface SidebarContentsProps {
  basePath: string;
  disableNavigation: boolean;
  pathname: string;
  idPrefix?: string;
}

function SidebarContents({
  basePath,
  disableNavigation,
  idPrefix = "",
  pathname,
}: SidebarContentsProps) {
  const {status} = useCoreStore();
  const mode = useThemeMode();

  return (
    <>
      <Sidebar.Header>
        <div className="flex items-center gap-3 px-1 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export served under /__proxyfor__ basePath */}
          <img
            alt="Outrider"
            className="size-8 shrink-0 rounded-md object-contain"
            height={32}
            src={
              mode === "brutalism-light"
                ? "/__proxyfor__/brand/light/outrider-icon-64.png"
                : "/__proxyfor__/brand/dark/outrider-icon-64.png"
            }
            width={32}
          />
          <div className="flex min-w-0 flex-col gap-0.5" data-sidebar="label">
            <span className="text-foreground truncate font-mono text-sm font-semibold leading-tight tracking-wider">
              Outrider
            </span>
            <span className="text-muted truncate font-mono text-xs leading-tight">
              {status?.listen_addr ?? "Local Gateway"}
            </span>
          </div>
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.Menu aria-label="Dashboard navigation">
            {NAV_ITEMS.map((item) => (
              <SidebarNavItem
                key={item.href}
                basePath={basePath}
                disableNavigation={disableNavigation}
                idPrefix={idPrefix}
                item={item}
                pathname={pathname}
              />
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      <Sidebar.Footer>
        <Sidebar.Menu aria-label="Support">
          {FOOTER_ITEMS.map((item) => (
            <SidebarNavItem
              key={item.href}
              basePath={basePath}
              disableNavigation={disableNavigation}
              idPrefix={idPrefix}
              item={item}
              pathname={pathname}
            />
          ))}
        </Sidebar.Menu>
      </Sidebar.Footer>
    </>
  );
}

interface SidebarNavItemProps {
  basePath: string;
  disableNavigation: boolean;
  idPrefix: string;
  item: NavItem;
  pathname: string;
}

function SidebarNavItem({
  basePath,
  disableNavigation,
  idPrefix,
  item,
  pathname,
}: SidebarNavItemProps) {
  const Icon = item.icon;
  const fullHref = basePath + item.href;
  const isCurrent =
    item.href === "/"
      ? pathname === fullHref || pathname === basePath || pathname === `${basePath}/`
      : pathname === fullHref || pathname.startsWith(`${fullHref}/`);

  return (
    <Sidebar.MenuItem
      href={disableNavigation ? undefined : fullHref}
      id={`${idPrefix}${item.href}`}
      isCurrent={isCurrent}
      textValue={item.label}
    >
      <Sidebar.MenuIcon>
        <Icon className="size-4" />
      </Sidebar.MenuIcon>
      <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
      {item.badge ? (
        <Sidebar.MenuChip>
          <Chip color="success" size="sm" variant="soft">
            {item.badge}
          </Chip>
        </Sidebar.MenuChip>
      ) : null}
    </Sidebar.MenuItem>
  );
}
