"use client";

import type {DashboardPeriod, DashboardTab} from "../lib/types";
import type {Selection} from "@heroui/react";

import {ArrowsRotateLeft, Calendar, ChevronDown} from "@gravity-ui/icons";
import {Button, ButtonGroup, Dropdown, Label, Tabs} from "@heroui/react";
import {useMemo, useState} from "react";

import {IconButton} from "../components/icon-button";
import {useCoreStore} from "../lib/core-store";

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  daily: "Daily",
  monthly: "Monthly",
  weekly: "Weekly",
  yearly: "Yearly",
};

export function DashboardToolbar() {
  const {
    dashboardPeriod,
    dashboardTab,
    exportHar,
    refresh,
    setDashboardPeriod,
    setDashboardTab,
  } = useCoreStore();
  const [periodOpen, setPeriodOpen] = useState(false);

  const selectedPeriodKeys = useMemo<Selection>(
    () => new Set([dashboardPeriod]),
    [dashboardPeriod],
  );

  const handlePeriodSelectionChange = (keys: Selection) => {
    if (keys === "all") return;
    const next = Array.from(keys)[0];

    if (next) {
      setDashboardPeriod(String(next) as DashboardPeriod);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Tabs
        selectedKey={dashboardTab}
        onSelectionChange={(key) => setDashboardTab(String(key) as DashboardTab)}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Dashboard tabs">
            <Tabs.Tab id="overview">
              Overview
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="traffic">
              Traffic
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="mcp">
              MCP
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="Refresh" size="sm" variant="tertiary" onPress={() => void refresh()}>
          <ArrowsRotateLeft className="size-4" />
        </IconButton>
        <ButtonGroup size="sm" variant="tertiary">
          <Button onPress={() => setPeriodOpen((prev) => !prev)}>
            <Calendar className="size-4" />
            {PERIOD_LABELS[dashboardPeriod]}
          </Button>
          <Dropdown isOpen={periodOpen} onOpenChange={setPeriodOpen}>
            <Button isIconOnly aria-label="Change period" size="sm" variant="tertiary">
              <ChevronDown className="size-4" />
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                disallowEmptySelection
                aria-label="Dashboard period"
                selectedKeys={selectedPeriodKeys}
                selectionMode="single"
                onSelectionChange={handlePeriodSelectionChange}
              >
                <Dropdown.Item id="daily" textValue="Daily">
                  <Label>Daily</Label>
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
                <Dropdown.Item id="weekly" textValue="Weekly">
                  <Label>Weekly</Label>
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
                <Dropdown.Item id="monthly" textValue="Monthly">
                  <Label>Monthly</Label>
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
                <Dropdown.Item id="yearly" textValue="Yearly">
                  <Label>Yearly</Label>
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </ButtonGroup>
        <Button size="sm" variant="secondary" onPress={exportHar}>
          Export HAR
        </Button>
      </div>
    </div>
  );
}
