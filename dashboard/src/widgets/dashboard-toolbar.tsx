"use client";

import type {DashboardPeriod, DashboardTab} from "../lib/types";
import type {Selection} from "@heroui/react";

import {Calendar, ChevronDown, FileArrowDown, Play} from "@gravity-ui/icons";
import {
  Button,
  ButtonGroup,
  Dropdown,
  Label,
  ListBox,
  Modal,
  Popover,
  Tabs,
  Tooltip,
} from "@heroui/react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {useCoreStore} from "../lib/core-store";
import walkthroughCuesData from "../lib/walkthrough-cues.json";
import {WWW_BASE_PATH} from "../lib/www-base-path";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";
const GITHUB_RELEASES_LATEST_URL = "https://github.com/maceip/Outrider/releases/latest";
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/maceip/Outrider/releases/latest";

interface VideoSceneCue {
  description: string;
  id: string;
  startSec: number;
  title: string;
}

const WALKTHROUGH_CUES: ReadonlyArray<VideoSceneCue> = walkthroughCuesData;

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  daily: "Daily",
  monthly: "Monthly",
  weekly: "Weekly",
  yearly: "Yearly",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCueTime(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  const mins = Math.floor(whole / 60);
  const rem = whole % 60;

  return `${mins}:${String(rem).padStart(2, "0")}`;
}

export function DashboardToolbar() {
  const {dashboardPeriod, dashboardTab, setDashboardPeriod, setDashboardTab} = useCoreStore();
  const [periodOpen, setPeriodOpen] = useState(false);
  const [videoTimeSec, setVideoTimeSec] = useState(0);
  const [cuePopoverOpen, setCuePopoverOpen] = useState(false);
  const [releaseUrls, setReleaseUrls] = useState<{
    all: string;
    dmg: string;
    linux: string;
    msi: string;
  }>({
    all: GITHUB_RELEASES_LATEST_URL,
    dmg: GITHUB_RELEASES_LATEST_URL,
    linux: GITHUB_RELEASES_LATEST_URL,
    msi: GITHUB_RELEASES_LATEST_URL,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!IS_WWW) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(GITHUB_RELEASES_API_URL, {
          headers: {Accept: "application/vnd.github+json"},
          signal: controller.signal,
        });

        if (!res.ok) return;
        const json: unknown = await res.json();

        if (!isRecord(json) || !Array.isArray(json.assets)) return;
        const all = typeof json.html_url === "string" ? json.html_url : GITHUB_RELEASES_LATEST_URL;
        let dmg = all;
        let msi = all;
        let linux = all;

        for (const item of json.assets) {
          if (
            isRecord(item) &&
            typeof item.name === "string" &&
            typeof item.browser_download_url === "string"
          ) {
            const lower = item.name.toLowerCase();

            if (lower.endsWith(".dmg")) dmg = item.browser_download_url;
            else if (lower.endsWith(".msi")) msi = item.browser_download_url;
            else if (lower.includes("linux") && lower.endsWith(".tar.gz")) {
              linux = item.browser_download_url;
            }
          }
        }
        if (!controller.signal.aborted) {
          setReleaseUrls({all, dmg, linux, msi});
        }
      } catch {
        // Offline or rate-limited falls back cleanly to releases/latest.
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

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

  const activeCueInfo = useMemo(() => {
    let index = 0;

    for (let i = 0; i < WALKTHROUGH_CUES.length; i += 1) {
      if (videoTimeSec >= WALKTHROUGH_CUES[i].startSec) {
        index = i;
      }
    }

    return {
      cue: WALKTHROUGH_CUES[index] ?? WALKTHROUGH_CUES[0],
      index,
      total: WALKTHROUGH_CUES.length,
    };
  }, [videoTimeSec]);

  const handleJumpToCue = useCallback((keys: Selection) => {
    if (keys === "all") return;
    const pickedId = Array.from(keys)[0];

    if (typeof pickedId !== "string") return;
    const target = WALKTHROUGH_CUES.find((item) => item.id === pickedId);

    if (!target) return;
    if (videoRef.current) {
      videoRef.current.currentTime = target.startSec;
      void videoRef.current.play().catch(() => {});
    }
    setVideoTimeSec(target.startSec);
    setCuePopoverOpen(false);
  }, []);

  const openDownload = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const walkthroughSrc = `${WWW_BASE_PATH}/demo/playwright-walkthrough.mp4`;
  const posterSrc = `${WWW_BASE_PATH}/brand/dark/outrider-logo-512.png`;

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
        <ButtonGroup size="sm" variant="tertiary">
          <Button onPress={() => setPeriodOpen((prev) => !prev)}>
            <Calendar className="size-4" />
            {PERIOD_LABELS[dashboardPeriod]}
          </Button>
          <Dropdown isOpen={periodOpen} onOpenChange={setPeriodOpen}>
            <Tooltip delay={0}>
              <Button isIconOnly aria-label="Change period" size="sm" variant="tertiary">
                <ChevronDown className="size-4" />
              </Button>
              <Tooltip.Content>Change period</Tooltip.Content>
            </Tooltip>
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

        {IS_WWW ? (
          <>
            <Modal>
              <Button size="sm" variant="secondary">
                <Play className="size-3.5" />
                Walkthrough
              </Button>
              <Modal.Backdrop>
                <Modal.Container>
                  <Modal.Dialog className="sm:max-w-4xl">
                    <Modal.CloseTrigger />
                    <Modal.Header>
                      <Modal.Heading>Agentic Commerce Testflight</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body className="flex flex-col gap-3 p-0 sm:px-6">
                      <div className="border-border relative overflow-hidden rounded-lg border">
                        <video
                          ref={videoRef}
                          autoPlay
                          controls
                          loop
                          muted
                          playsInline
                          className="bg-surface-secondary aspect-video w-full object-cover"
                          poster={posterSrc}
                          src={walkthroughSrc}
                          onLoadedMetadata={(event) => {
                            setVideoTimeSec(event.currentTarget.currentTime);
                          }}
                          onTimeUpdate={(event) => {
                            setVideoTimeSec(event.currentTarget.currentTime);
                          }}
                        />

                        <div className="absolute top-3 left-3 z-10 max-w-[calc(100%-1.5rem)]">
                          <Popover isOpen={cuePopoverOpen} onOpenChange={setCuePopoverOpen}>
                            <Button
                              aria-label={`Scene ${activeCueInfo.index + 1} of ${activeCueInfo.total}: ${activeCueInfo.cue.title}`}
                              className="border-border bg-background/90 text-foreground h-auto max-w-full gap-2 px-3 py-1.5 backdrop-blur-md"
                              size="sm"
                              variant="secondary"
                            >
                              <span
                                aria-hidden="true"
                                className="bg-accent size-2 shrink-0 rounded-full"
                              />
                              <span className="text-muted shrink-0 font-mono text-[11px] font-medium tracking-[0.06em] uppercase tabular-nums">
                                {`${String(activeCueInfo.index + 1).padStart(2, "0")}/${String(activeCueInfo.total).padStart(2, "0")}`}
                              </span>
                              <span className="truncate text-xs font-semibold">
                                {activeCueInfo.cue.title}
                              </span>
                            </Button>

                            <Popover.Content
                              className="w-80 max-w-[calc(100vw-2rem)]"
                              offset={8}
                              placement="bottom start"
                            >
                              <Popover.Dialog className="flex flex-col gap-3">
                                <Popover.Arrow />
                                <div className="flex flex-col gap-1">
                                  <Popover.Heading className="text-sm">
                                    {activeCueInfo.cue.title}
                                  </Popover.Heading>
                                  <p className="text-muted text-xs leading-relaxed">
                                    {activeCueInfo.cue.description}
                                  </p>
                                </div>

                                <ListBox
                                  aria-label="Walkthrough scenes"
                                  selectedKeys={new Set([activeCueInfo.cue.id])}
                                  selectionMode="single"
                                  onSelectionChange={handleJumpToCue}
                                >
                                  {WALKTHROUGH_CUES.map((scene, idx) => (
                                    <ListBox.Item
                                      key={scene.id}
                                      className="items-center justify-between gap-3"
                                      id={scene.id}
                                      textValue={scene.title}
                                    >
                                      <Label className="min-w-0 flex-1 truncate text-xs font-medium">
                                        {`${idx + 1}. ${scene.title}`}
                                      </Label>
                                      <span className="text-muted shrink-0 font-mono text-[11px] font-medium tracking-[0.06em] tabular-nums">
                                        {formatCueTime(scene.startSec)}
                                      </span>
                                      <ListBox.ItemIndicator />
                                    </ListBox.Item>
                                  ))}
                                </ListBox>
                              </Popover.Dialog>
                            </Popover.Content>
                          </Popover>
                        </div>
                      </div>
                      <p className="text-muted px-4 pb-2 text-xs leading-relaxed sm:px-0">
                        {activeCueInfo.cue.description}
                      </p>
                    </Modal.Body>
                  </Modal.Dialog>
                </Modal.Container>
              </Modal.Backdrop>
            </Modal>

            <Dropdown>
              <Button size="sm" variant="primary">
                <FileArrowDown className="size-3.5" />
                Download
              </Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu aria-label="Download Outrider">
                  <Dropdown.Item
                    id="dmg"
                    textValue="macOS (.dmg)"
                    onAction={() => openDownload(releaseUrls.dmg)}
                  >
                    <Label>macOS (.dmg)</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="msi"
                    textValue="Windows (.msi)"
                    onAction={() => openDownload(releaseUrls.msi)}
                  >
                    <Label>Windows (.msi)</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="linux"
                    textValue="Linux (.tar.gz)"
                    onAction={() => openDownload(releaseUrls.linux)}
                  >
                    <Label>Linux (.tar.gz)</Label>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="all"
                    textValue="All Releases"
                    onAction={() => openDownload(releaseUrls.all)}
                  >
                    <Label>All Releases</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </>
        ) : null}
      </div>
    </div>
  );
}
