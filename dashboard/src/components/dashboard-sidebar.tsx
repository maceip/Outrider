"use client";

import type {NavItem} from "../nav-items";

import {Chip} from "@heroui/react";
import {Sidebar} from "@heroui-pro/react";
import {useEffect, useState} from "react";

import {useCoreStore} from "../lib/core-store";
import {withWwwBasePath} from "../lib/www-base-path";
import {FOOTER_ITEMS, NAV_ITEMS, WWW_FOOTER_ITEMS, WWW_NAV_ITEMS} from "../nav-items";

import {useThemeMode} from "./theme-toggle";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";

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
  const [activeHash, setActiveHash] = useState("#overview");

  useEffect(() => {
    if (!IS_WWW || typeof window === "undefined") return;

    const syncHash = () => {
      setActiveHash(window.location.hash || "#overview");
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);

    return () => {
      window.removeEventListener("hashchange", syncHash);
    };
  }, []);

  const navItems = IS_WWW ? WWW_NAV_ITEMS : NAV_ITEMS;
  const footerItems = IS_WWW ? WWW_FOOTER_ITEMS : FOOTER_ITEMS;
  const subtitle = IS_WWW ? "Interactive Demo" : (status?.listen_addr ?? "Local Gateway");

  return (
    <>
      <Sidebar.Header>
        <div className="flex items-center gap-3 px-1 py-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export served under basePath */}
          <img
            alt="Outrider"
            className="size-8 shrink-0 rounded-md object-contain"
            height={32}
            src={
              mode === "brutalism-light"
                ? withWwwBasePath("/brand/light/outrider-icon-64.png")
                : withWwwBasePath("/brand/dark/outrider-icon-64.png")
            }
            width={32}
          />
          <div className="flex min-w-0 flex-col gap-0.5" data-sidebar="label">
            <span className="text-foreground truncate font-mono text-sm font-semibold leading-tight tracking-wider">
              Outrider
            </span>
            <span className="text-muted truncate font-mono text-xs leading-tight">{subtitle}</span>
          </div>
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.Menu aria-label="Dashboard navigation">
            {navItems.map((item) => (
              <SidebarNavItem
                key={item.href}
                activeHash={activeHash}
                basePath={basePath}
                disableNavigation={disableNavigation}
                idPrefix={idPrefix}
                item={item}
                pathname={pathname}
                onSelectHash={setActiveHash}
              />
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      <Sidebar.Footer>
        <Sidebar.Menu aria-label="Support">
          {footerItems.map((item) => (
            <SidebarNavItem
              key={item.href}
              activeHash={activeHash}
              basePath={basePath}
              disableNavigation={disableNavigation}
              idPrefix={idPrefix}
              item={item}
              pathname={pathname}
              onSelectHash={setActiveHash}
            />
          ))}
        </Sidebar.Menu>
      </Sidebar.Footer>
    </>
  );
}

interface SidebarNavItemProps {
  activeHash: string;
  basePath: string;
  disableNavigation: boolean;
  idPrefix: string;
  item: NavItem;
  pathname: string;
  onSelectHash: (hash: string) => void;
}

function SidebarNavItem({
  activeHash,
  basePath,
  disableNavigation,
  idPrefix,
  item,
  onSelectHash,
  pathname,
}: SidebarNavItemProps) {
  const Icon = item.icon;
  const isHashLink = item.href.startsWith("#");
  const isExternal = Boolean(item.external);
  const fullHref = isHashLink || isExternal ? item.href : basePath + item.href;

  const isCurrent = isExternal
    ? false
    : isHashLink
      ? activeHash === item.href
      : item.href === "/"
        ? pathname === fullHref || pathname === basePath || pathname === `${basePath}/`
        : pathname === fullHref || pathname.startsWith(`${fullHref}/`);

  return (
    <Sidebar.MenuItem
      href={disableNavigation ? undefined : fullHref}
      id={`${idPrefix}${item.href}`}
      isCurrent={isCurrent}
      rel={isExternal ? "noreferrer" : undefined}
      target={isExternal ? "_blank" : undefined}
      textValue={item.label}
      onAction={() => {
        if (isHashLink) {
          onSelectHash(item.href);
        }
      }}
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
