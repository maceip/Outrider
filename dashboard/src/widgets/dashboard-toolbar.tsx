"use client";

import type {OverviewFilterTab} from "../lib/types";
import type {Key} from "react";

import {ArrowDownToLine, ArrowsRotateLeft} from "@gravity-ui/icons";
import {Button, Tabs} from "@heroui/react";

import {IconButton} from "../components/icon-button";
import {useOutrider} from "../lib/outrider-store";

export function DashboardToolbar() {
  const {busy, exportSnapshot, overviewTab, refresh, setOverviewTab, snapshot, unlocked} =
    useOutrider();

  const refreshReason = !unlocked
    ? "Admin token required"
    : busy
      ? "Backend action in progress"
      : undefined;

  const exportReason = !unlocked || !snapshot ? "Admin token required to export snapshot" : undefined;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Tabs
        selectedKey={overviewTab}
        onSelectionChange={(key: Key) => setOverviewTab(String(key) as OverviewFilterTab)}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Overview workspace filter">
            <Tabs.Tab id="overview">
              Overview
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="commerce">
              Commerce
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="evidence">
              Evidence
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <span title={refreshReason}>
          <IconButton
            isDisabled={Boolean(refreshReason)}
            label="Refresh snapshot"
            size="sm"
            tooltip={refreshReason ?? "Reload persisted commerce snapshot"}
            variant="tertiary"
            onPress={() => void refresh()}
          >
            <ArrowsRotateLeft aria-hidden="true" className="size-4" />
          </IconButton>
        </span>

        <span title={exportReason}>
          <Button
            isDisabled={Boolean(exportReason)}
            size="sm"
            variant="secondary"
            onPress={exportSnapshot}
          >
            <ArrowDownToLine aria-hidden="true" className="size-4" />
            Export Snapshot
          </Button>
        </span>
      </div>
    </div>
  );
}
