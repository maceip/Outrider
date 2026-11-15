"use client";

import {ArrowsRotateLeft} from "@gravity-ui/icons";
import {Button} from "@heroui/react";
import {AppLayout, Navbar, Sidebar} from "@heroui-pro/react";

import {useCoreStore} from "../lib/core-store";

import {IconButton} from "./icon-button";

export interface DashboardNavbarProps {
  /** Title rendered in the navbar. */
  title?: string;
}

export function DashboardNavbar({title = "Dashboard"}: DashboardNavbarProps) {
  const {exportHar, refresh} = useCoreStore();

  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <AppLayout.MenuToggle />
        <Sidebar.Trigger aria-label="Toggle sidebar" />
        <h1 className="text-foreground truncate text-xl font-semibold">{title}</h1>
        <Navbar.Spacer />
        <div className="flex items-center gap-2">
          <IconButton label="Refresh" size="sm" variant="tertiary" onPress={() => void refresh()}>
            <ArrowsRotateLeft className="size-4" />
          </IconButton>
          <Button size="sm" onPress={exportHar}>
            Export HAR
          </Button>
        </div>
      </Navbar.Header>
    </Navbar>
  );
}
