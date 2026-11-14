"use client";

import type {NavItem} from "../nav-items";

import {CurlyBracketsLock} from "@gravity-ui/icons";
import {Avatar} from "@heroui/react";
import {Sidebar} from "@heroui-pro/react";

import {useOutrider} from "../lib/outrider-store";
import {formatClefState} from "../lib/types";
import {FOOTER_ITEMS, NAV_ITEMS} from "../nav-items";

export interface DashboardSidebarProps {
  basePath: string;
  currentRoute: string;
  disableNavigation?: boolean;
}

export function DashboardSidebar({
  basePath,
  currentRoute,
  disableNavigation = false,
}: DashboardSidebarProps) {
  return (
    <>
      <Sidebar>
        <SidebarContents
          basePath={basePath}
          currentRoute={currentRoute}
          disableNavigation={disableNavigation}
          isPrimaryBrand
        />
      </Sidebar>
      <Sidebar.Mobile>
        <SidebarContents
          basePath={basePath}
          currentRoute={currentRoute}
          disableNavigation={disableNavigation}
          idPrefix="mobile-"
          isPrimaryBrand={false}
        />
      </Sidebar.Mobile>
    </>
  );
}

interface SidebarContentsProps {
  basePath: string;
  currentRoute: string;
  disableNavigation: boolean;
  idPrefix?: string;
  isPrimaryBrand: boolean;
}

function SidebarContents({
  basePath,
  currentRoute,
  disableNavigation,
  idPrefix = "",
  isPrimaryBrand,
}: SidebarContentsProps) {
  const {clefStatus, lock, snapshot, unlocked} = useOutrider();

  const subtitle =
    unlocked && snapshot?.public_key
      ? `Ed25519 ${snapshot.public_key.slice(0, 10)}…`
      : `CLEF ${formatClefState(clefStatus)}`;

  return (
    <>
      <Sidebar.Header>
        <div className="flex items-center gap-3 px-1 py-1">
          <Avatar className="bg-accent-soft text-accent size-9">
            <Avatar.Fallback className="font-mono text-xs font-semibold">OR</Avatar.Fallback>
          </Avatar>
          <div className="flex min-w-0 flex-col" data-sidebar="label">
            <span
              className={
                isPrimaryBrand
                  ? "brand text-foreground font-mono text-sm font-semibold leading-tight"
                  : "text-foreground font-mono text-sm font-semibold leading-tight"
              }
            >
              OUTRIDER
            </span>
            <span className="text-muted truncate font-mono text-xs leading-tight tabular-nums">
              {subtitle}
            </span>
          </div>
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.Menu aria-label="Gateway navigation">
            {NAV_ITEMS.map((item) => (
              <SidebarNavItem
                key={item.href}
                basePath={basePath}
                currentRoute={currentRoute}
                disableNavigation={disableNavigation}
                idPrefix={idPrefix}
                item={item}
              />
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      <Sidebar.Footer>
        <Sidebar.Menu aria-label="Protocol and session">
          {FOOTER_ITEMS.map((item) => (
            <SidebarNavItem
              key={item.href}
              basePath={basePath}
              currentRoute={currentRoute}
              disableNavigation={disableNavigation}
              idPrefix={idPrefix}
              item={item}
            />
          ))}
          {unlocked ? (
            <Sidebar.MenuItem
              id={`${idPrefix}lock-session`}
              textValue="Lock Session"
              onAction={lock}
            >
              <Sidebar.MenuIcon>
                <CurlyBracketsLock aria-hidden="true" className="size-4" />
              </Sidebar.MenuIcon>
              <Sidebar.MenuLabel>Lock Session</Sidebar.MenuLabel>
            </Sidebar.MenuItem>
          ) : null}
        </Sidebar.Menu>
      </Sidebar.Footer>
    </>
  );
}

interface SidebarNavItemProps {
  basePath: string;
  currentRoute: string;
  disableNavigation: boolean;
  idPrefix: string;
  item: NavItem;
}

function SidebarNavItem({
  basePath,
  currentRoute,
  disableNavigation,
  idPrefix,
  item,
}: SidebarNavItemProps) {
  const Icon = item.icon;
  const fullHref = item.href === "/" ? `${basePath}/` : `${basePath}${item.href}/`;
  const isCurrent = currentRoute === item.href;

  return (
    <Sidebar.MenuItem
      href={disableNavigation ? undefined : fullHref}
      id={`${idPrefix}${item.href}`}
      isCurrent={isCurrent}
      textValue={item.label}
    >
      <Sidebar.MenuIcon>
        <Icon aria-hidden="true" className="size-4" />
      </Sidebar.MenuIcon>
      <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
    </Sidebar.MenuItem>
  );
}
