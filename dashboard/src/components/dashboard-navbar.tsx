"use client";

import {ArrowsRotateLeft, FileArrowDown} from "@gravity-ui/icons";
import {Button, toast} from "@heroui/react";
import {AppLayout, Navbar, Sidebar} from "@heroui-pro/react";
import {useCallback, useState} from "react";

import {useCoreStore} from "../lib/core-store";

import {IconButton} from "./icon-button";
import {ThemeToggle} from "./theme-toggle";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";

export interface DashboardNavbarProps {
  /** Title rendered in the navbar. */
  title?: string;
}

export function DashboardNavbar({
  title = IS_WWW ? "Outrider" : "Dashboard",
}: DashboardNavbarProps) {
  const {exportHar, refresh} = useCoreStore();
  const [checkingLocal, setCheckingLocal] = useState(false);

  const handleOpenLocal = useCallback(async () => {
    setCheckingLocal(true);
    try {
      const response = await fetch("http://127.0.0.1:8080/__proxyfor__/commerce/status", {
        cache: "no-store",
        signal: AbortSignal.timeout(1_200),
      });

      if (response.ok) {
        window.location.assign("http://localhost:8080/__proxyfor__/");

        return;
      }
      toast.info("Local gateway not reachable on :8080 — start with ./outrider --web");
    } catch {
      toast.info("Local gateway not running on :8080 — start with ./outrider --web");
    } finally {
      setCheckingLocal(false);
    }
  }, []);

  const handleScrollToDownloads = useCallback(() => {
    const target = document.getElementById("downloads");

    if (target) {
      target.scrollIntoView({behavior: "smooth", block: "start"});
    }
    window.history.replaceState(null, "", "#downloads");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <AppLayout.MenuToggle />
        <Sidebar.Trigger aria-label="Toggle sidebar" />
        <h1 className="text-foreground truncate text-lg font-semibold tracking-tight">{title}</h1>
        <Navbar.Spacer />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {IS_WWW ? (
            <>
              <Button
                className="hidden sm:inline-flex"
                isPending={checkingLocal}
                size="sm"
                variant="secondary"
                onPress={() => void handleOpenLocal()}
              >
                Open Local (:8080)
              </Button>
              <Button size="sm" variant="primary" onPress={handleScrollToDownloads}>
                <FileArrowDown className="size-4" />
                Download
              </Button>
            </>
          ) : (
            <>
              <IconButton label="Refresh" size="sm" variant="tertiary" onPress={() => void refresh()}>
                <ArrowsRotateLeft className="size-4" />
              </IconButton>
              <Button size="sm" variant="primary" onPress={exportHar}>
                Export HAR
              </Button>
            </>
          )}
        </div>
      </Navbar.Header>
    </Navbar>
  );
}
