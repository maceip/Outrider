"use client";

import type {Selection} from "@heroui/react";

import {FileArrowDown, Play} from "@gravity-ui/icons";
import {
  Button,
  Card,
  Dropdown,
  Label,
  Link,
  ListBox,
  Modal,
  Popover,
} from "@heroui/react";
import {Navbar, Segment} from "@heroui-pro/react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {setSilvectorTheme, useThemeMode} from "../components/theme-toggle";
import walkthroughCuesData from "../lib/walkthrough-cues.json";
import {WWW_BASE_PATH} from "../lib/www-base-path";
import {GITHUB_REPO_URL} from "../nav-items";

import {InterceptorSlot} from "./interceptor-slot";

const GITHUB_RELEASES_LATEST_URL = "https://github.com/maceip/Outrider/releases/latest";
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/maceip/Outrider/releases/latest";

interface VideoSceneCue {
  description: string;
  id: string;
  startSec: number;
  title: string;
}

const WALKTHROUGH_CUES: ReadonlyArray<VideoSceneCue> = walkthroughCuesData;

const VALUE_PROPS: ReadonlyArray<{body: string; title: string}> = [
  {
    body: "Hold outbound catalog offers mid-inquiry, verify merchant margin floors, and stage counter-offers without rewriting wire history.",
    title: "Sell-Side Offer Hold Gate",
  },
  {
    body: "Correlate causal buyer-agent negotiation traces, raw HTTP/MCP/WebSocket frames, and session capability passes in one desk.",
    title: "Unified Investigation Desk",
  },
  {
    body: "Runs on your merchant workstation with one binary so catalog rules, session passes, and wire payloads stay on loopback.",
    title: "Local Binary, Zero Cloud",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCueTime(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  const mins = Math.floor(whole / 60);
  const rem = whole % 60;

  return `${mins}:${String(rem).padStart(2, "0")}`;
}

export function WwwLandingPage() {
  const theme = useThemeMode();
  const isDark = theme === "brutalism-dark";

  const [isWalkthroughOpen, setIsWalkthroughOpen] = useState(false);
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
        // Rate-limited or offline falls back cleanly to releases/latest.
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

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

  const openDownload = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const scrollToLiveInterceptor = useCallback(() => {
    document.getElementById("live-interceptor")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const walkthroughSrc = `${WWW_BASE_PATH}/demo/playwright-walkthrough.mp4`;
  const posterSrc = `${WWW_BASE_PATH}/brand/dark/conduit-logo-512.png`;

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <Navbar
        className="border-border bg-background/95 border-b backdrop-blur-md"
        height="3.5rem"
        maxWidth="full"
        size="sm"
      >
        <Navbar.Header className="mx-auto w-full max-w-[1440px] justify-between gap-4 px-4 sm:px-6">
          <Navbar.Brand className="gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- static export served under basePath */}
            <img
              alt="Conduit"
              className="size-7 shrink-0 rounded-md object-contain"
              height={28}
              src={`${WWW_BASE_PATH}/brand/${isDark ? "dark" : "light"}/conduit-icon-64.png`}
              width={28}
            />
            <span className="text-foreground text-base font-semibold tracking-[-0.02em]">
              Conduit
            </span>
          </Navbar.Brand>

          <Navbar.Content className="gap-2">
            <Modal isOpen={isWalkthroughOpen} onOpenChange={setIsWalkthroughOpen}>
              <Button size="sm" variant="ghost">
                <Play className="size-3.5" />
                Walkthrough
              </Button>
              <Modal.Backdrop>
                <Modal.Container>
                  <Modal.Dialog className="sm:max-w-4xl">
                    <Modal.CloseTrigger />
                    <Modal.Header>
                      <Modal.Heading>Conduit Walkthrough</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body className="flex flex-col gap-3 p-0 pb-4 sm:px-6">
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
                      <p className="text-muted px-4 text-xs leading-relaxed sm:px-0">
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
                <Dropdown.Menu aria-label="Download Conduit">
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
          </Navbar.Content>
        </Navbar.Header>
      </Navbar>

      <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-4 px-6 pt-12 pb-8 text-center">
        <h1 className="text-foreground max-w-3xl text-3xl font-semibold tracking-[-0.02em] sm:text-5xl sm:leading-[1.08]">
          Sell-side commerce investigation and offer mediation in real time.
        </h1>
        <p className="text-muted max-w-2xl font-sans text-base font-normal leading-relaxed sm:text-lg">
          Inspect live buyer-agent inquiries on the wire, enforce merchant floor policies before
          offers clear, and govern session capability passes from one desk.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button variant="primary" onPress={scrollToLiveInterceptor}>
            Open Investigation Desk
          </Button>
          <Button variant="outline" onPress={() => setIsWalkthroughOpen(true)}>
            Watch Walkthrough
          </Button>
        </div>
      </section>

      <section
        className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 pb-10 sm:px-6"
        id="live-interceptor"
      >
        <InterceptorSlot embedded />
      </section>

      <section className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-4 px-4 pb-12 sm:px-6 md:grid-cols-3">
        {VALUE_PROPS.map((prop) => (
          <Card key={prop.title} className="gap-2 p-6">
            <Card.Header className="p-0">
              <Card.Title className="text-base">{prop.title}</Card.Title>
            </Card.Header>
            <Card.Content className="p-0">
              <p className="text-muted line-clamp-2 text-sm leading-relaxed">{prop.body}</p>
            </Card.Content>
          </Card>
        ))}
      </section>

      <div className="border-border mt-auto border-t" data-slot="page-footer">
        <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Segment
            aria-label="Color theme"
            selectedKey={isDark ? "dark" : "light"}
            size="sm"
            onSelectionChange={(key) => {
              setSilvectorTheme(key === "light" ? "brutalism-light" : "brutalism-dark");
            }}
          >
            <Segment.Item id="dark">Dark</Segment.Item>
            <Segment.Item id="light">Light</Segment.Item>
          </Segment>

          <Link
            className="text-muted hover:text-foreground text-xs font-medium no-underline"
            href={GITHUB_REPO_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            GitHub
          </Link>
        </div>
      </div>
    </div>
  );
}
