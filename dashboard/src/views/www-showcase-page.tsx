"use client";

import type {LiveSessionBundle} from "../widgets/www-demo-workbench";
import type {Selection} from "@heroui/react";

import {ArrowRightFromSquare, FileArrowDown} from "@gravity-ui/icons";
import {Button, Card, Description, Label, ListBox, Popover, toast} from "@heroui/react";
import {Segment} from "@heroui-pro/react";
import {CodeBlock} from "@heroui-pro/react/code-block";
import {KPI} from "@heroui-pro/react/kpi";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {ThemeToggle, useThemeMode} from "../components/theme-toggle";
import walkthroughCuesData from "../lib/walkthrough-cues.json";
import {WWW_BASE_PATH, withWwwBasePath} from "../lib/www-base-path";
import {WwwDemoWorkbench} from "../widgets/www-demo-workbench";
import {WwwReceiptLab} from "../widgets/www-receipt-lab";

type HeroVideoKey = "walkthrough" | "reel" | "mark";

interface VideoSceneCue {
  description: string;
  id: string;
  startSec: number;
  title: string;
}

interface GitHubReleaseAsset {
  browser_download_url: string;
  name: string;
  size: number;
}

interface GitHubLatestRelease {
  assets: GitHubReleaseAsset[];
  html_url: string;
  published_at?: string;
  tag_name: string;
}

const GITHUB_RELEASES_LATEST_URL = "https://github.com/maceip/Outrider/releases/latest";
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/maceip/Outrider/releases/latest";

const WALKTHROUGH_CUES: ReadonlyArray<VideoSceneCue> = walkthroughCuesData;

const REEL_CUES: ReadonlyArray<VideoSceneCue> = [
  {
    description: "Precision dark surfaces and high-contrast lime accents built for dense agent telemetry.",
    id: "reel-surfaces",
    startSec: 0,
    title: "Unified Workbench Design",
  },
  {
    description: "Every table, chart, and inspector shares one cohesive component geometry.",
    id: "reel-system",
    startSec: 15,
    title: "Consistent Controls",
  },
];

const MARK_CUES: ReadonlyArray<VideoSceneCue> = [
  {
    description: "The Outrider compass-star emblem rendered across desktop installers and web surfaces.",
    id: "mark-emblem",
    startSec: 0,
    title: "Outrider Brand Emblem",
  },
];

const HERO_VIDEOS: ReadonlyArray<{
  cues: ReadonlyArray<VideoSceneCue>;
  file: string;
  id: HeroVideoKey;
  label: string;
}> = [
  {
    cues: WALKTHROUGH_CUES,
    file: "playwright-walkthrough.mp4",
    id: "walkthrough",
    label: "Live Walkthrough",
  },
  {
    cues: REEL_CUES,
    file: "silvector-reel.mp4",
    id: "reel",
    label: "Motion Reel",
  },
  {
    cues: MARK_CUES,
    file: "outrider-mark.mp4",
    id: "mark",
    label: "Brand Mark",
  },
];

interface QuickStartCommand {
  command: string;
  id: string;
  title: string;
}

const QUICK_START_COMMANDS: ReadonlyArray<QuickStartCommand> = [
  {
    command: "./outrider --web",
    id: "web",
    title: "Launch Local Web Gateway",
  },
  {
    command:
      "python3 scripts/install_native.py && cargo build --release -p proxyfor --bin outrider",
    id: "cargo",
    title: "Build Release Binary",
  },
  {
    command:
      "./outrider receipt issue --subject <SESSION_ID> --bundle-id outrider_session_evidence --max-calls 10 --expires-at-unix 1893456000",
    id: "receipt",
    title: "Issue Access Pass",
  },
  {
    command: "gh attestation verify Outrider-*.dmg --repo maceip/Outrider",
    id: "attest",
    title: "Verify Release Installer",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLatestRelease(raw: unknown): GitHubLatestRelease | null {
  if (!isRecord(raw) || typeof raw.tag_name !== "string") {
    return null;
  }
  const assets: GitHubReleaseAsset[] = [];

  if (Array.isArray(raw.assets)) {
    for (const item of raw.assets) {
      if (
        isRecord(item) &&
        typeof item.name === "string" &&
        typeof item.browser_download_url === "string"
      ) {
        assets.push({
          browser_download_url: item.browser_download_url,
          name: item.name,
          size: typeof item.size === "number" ? item.size : 0,
        });
      }
    }
  }

  return {
    assets,
    html_url: typeof raw.html_url === "string" ? raw.html_url : GITHUB_RELEASES_LATEST_URL,
    published_at: typeof raw.published_at === "string" ? raw.published_at : undefined,
    tag_name: raw.tag_name,
  };
}

function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function WwwShowcasePage() {
  const mode = useThemeMode();
  const brandThemeDir = mode === "brutalism-light" ? "light" : "dark";
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [heroVideo, setHeroVideo] = useState<HeroVideoKey>("walkthrough");
  const [videoTimeSec, setVideoTimeSec] = useState(0);
  const [cuePopoverOpen, setCuePopoverOpen] = useState(false);
  const [bundle, setBundle] = useState<LiveSessionBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(true);
  const [latestRelease, setLatestRelease] = useState<GitHubLatestRelease | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(withWwwBasePath("/demo/live-session-bundle.json"), {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Status ${res.status}`);
        }
        const parsed = (await res.json()) as LiveSessionBundle;

        if (!controller.signal.aborted) {
          setBundle(parsed);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const msg =
            error instanceof Error ? error.message : "Failed to load recorded capture bundle";

          toast.danger(msg);
        }
      } finally {
        if (!controller.signal.aborted) {
          setBundleLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(GITHUB_RELEASES_API_URL, {
          headers: {Accept: "application/vnd.github+json"},
          signal: controller.signal,
        });

        if (!res.ok) {
          return;
        }
        const json: unknown = await res.json();
        const parsed = parseLatestRelease(json);

        if (parsed && !controller.signal.aborted) {
          setLatestRelease(parsed);
        }
      } catch {
        // GitHub rate-limit or offline browsing falls back cleanly to releases/latest URL.
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  const scrollToSection = useCallback((sectionId: string) => {
    const target = document.getElementById(sectionId);

    if (target) {
      target.scrollIntoView({behavior: "smooth", block: "start"});
      window.history.replaceState(null, "", `#${sectionId}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }, []);

  const releaseLinks = useMemo(() => {
    const latestReleasePageUrl = latestRelease?.html_url ?? GITHUB_RELEASES_LATEST_URL;
    const assets = latestRelease?.assets ?? [];
    const dmg = assets.find((a) => a.name.toLowerCase().endsWith(".dmg"));
    const msi = assets.find((a) => a.name.toLowerCase().endsWith(".msi"));
    const linuxTar = assets.find(
      (a) =>
        a.name.toLowerCase().includes("linux") && a.name.toLowerCase().endsWith(".tar.gz"),
    );

    return {
      dmgUrl: dmg?.browser_download_url ?? latestReleasePageUrl,
      linuxUrl: linuxTar?.browser_download_url ?? latestReleasePageUrl,
      msiUrl: msi?.browser_download_url ?? latestReleasePageUrl,
      releaseUrl: latestReleasePageUrl,
    };
  }, [latestRelease]);

  const activeVideoConfig = useMemo(
    () => HERO_VIDEOS.find((item) => item.id === heroVideo) ?? HERO_VIDEOS[0],
    [heroVideo],
  );

  const activeCueInfo = useMemo(() => {
    const cues = activeVideoConfig.cues;
    let index = 0;

    for (let i = 0; i < cues.length; i += 1) {
      if (videoTimeSec >= cues[i].startSec) {
        index = i;
      }
    }

    return {
      cue: cues[index] ?? cues[0],
      index,
      total: cues.length,
    };
  }, [activeVideoConfig.cues, videoTimeSec]);

  const handleSelectVideo = useCallback((nextKey: HeroVideoKey) => {
    setHeroVideo(nextKey);
    setVideoTimeSec(0);
  }, []);

  const handleJumpToCue = useCallback(
    (keys: Selection) => {
      if (keys === "all") return;
      const pickedId = Array.from(keys)[0];

      if (typeof pickedId !== "string") return;
      const target = activeVideoConfig.cues.find((item) => item.id === pickedId);

      if (!target) return;
      if (videoRef.current) {
        videoRef.current.currentTime = target.startSec;
        void videoRef.current.play().catch(() => {});
      }
      setVideoTimeSec(target.startSec);
      setCuePopoverOpen(false);
    },
    [activeVideoConfig.cues],
  );

  const activeVideoSrc = `${WWW_BASE_PATH}/demo/${activeVideoConfig.file}`;
  const posterSrc = `${WWW_BASE_PATH}/brand/${brandThemeDir}/outrider-logo-512.png`;
  const logoSrc = `${WWW_BASE_PATH}/brand/${brandThemeDir}/outrider-logo-256.png`;

  const kpis = useMemo(
    () => [
      {label: "Captured Exchanges", value: bundle?.traffics.length ?? 0},
      {
        label: "Tool Frames",
        value: bundle?.commerceSnapshot.mcp_frames.length ?? 0,
      },
      {
        label: "Session Checks",
        value: bundle?.commerceSnapshot.clef_evaluations.length ?? 0,
      },
      {label: "Active Bundles", value: bundle?.commerceSnapshot.bundles.length ?? 0},
    ],
    [bundle],
  );

  const firstReceipt = bundle?.commerceSnapshot.capability_receipts[0] ?? null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-10 pt-8">
      <section
        className="scroll-mt-20 grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12"
        id="overview"
      >
        <Card className="h-full justify-between gap-6 p-6 lg:col-span-5">
          <div className="flex flex-col gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- static export resolved via WWW_BASE_PATH */}
            <img
              alt="Outrider mark"
              className="size-12 shrink-0 rounded-lg object-contain"
              height={48}
              src={logoSrc}
              width={48}
            />

            <div className="flex flex-col gap-2.5">
              <h2 className="text-foreground text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-3xl">
                Agentic Commerce Testflight
              </h2>
              <p className="text-muted text-sm leading-relaxed">
                Watch every agent request in real time, test tool calls step by step, and issue
                scoped access passes before going live.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="primary" onPress={() => scrollToSection("demo")}>
              Start
            </Button>
            <Button variant="secondary" onPress={() => scrollToSection("receipt-lab")}>
              Verify a Pass
            </Button>
          </div>
        </Card>

        <div className="min-w-0 lg:col-span-7">
          <Card className="overflow-hidden p-0">
            <div className="relative">
              <video
                key={activeVideoSrc}
                ref={videoRef}
                autoPlay
                controls
                loop
                muted
                playsInline
                className="bg-surface-secondary aspect-video w-full object-cover"
                poster={posterSrc}
                src={activeVideoSrc}
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
                    <span aria-hidden="true" className="bg-accent size-2 shrink-0 rounded-full" />
                    <span className="text-muted shrink-0 font-mono text-[11px] font-medium tracking-[0.06em] uppercase tabular-nums">
                      {`${String(activeCueInfo.index + 1).padStart(2, "0")}/${String(activeCueInfo.total).padStart(2, "0")}`}
                    </span>
                    <span className="truncate text-xs font-semibold">
                      {activeCueInfo.cue.title}
                    </span>
                  </Button>

                  <Popover.Content className="w-80 max-w-[calc(100vw-2rem)]" offset={8} placement="bottom start">
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

                      {activeVideoConfig.cues.length > 1 ? (
                        <ListBox
                          aria-label="Walkthrough scenes"
                          selectedKeys={new Set([activeCueInfo.cue.id])}
                          selectionMode="single"
                          onSelectionChange={handleJumpToCue}
                        >
                          {activeVideoConfig.cues.map((scene, idx) => (
                            <ListBox.Item
                              key={scene.id}
                              id={scene.id}
                              textValue={scene.title}
                            >
                              <Label className="text-xs font-medium">
                                {`${idx + 1}. ${scene.title}`}
                              </Label>
                              <Description className="line-clamp-1 text-xs">
                                {scene.description}
                              </Description>
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      ) : null}
                    </Popover.Dialog>
                  </Popover.Content>
                </Popover>
              </div>
            </div>

            <Card.Footer className="border-separator flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5">
              <Segment
                aria-label="Select showcase reel"
                selectedKey={heroVideo}
                size="sm"
                onSelectionChange={(key) => handleSelectVideo(String(key) as HeroVideoKey)}
              >
                {HERO_VIDEOS.map((item) => (
                  <Segment.Item key={item.id} id={item.id}>
                    {item.label}
                  </Segment.Item>
                ))}
              </Segment>
              <span className="text-muted min-w-0 flex-1 truncate text-right text-xs">
                {activeCueInfo.cue.description}
              </span>
            </Card.Footer>
          </Card>
        </div>
      </section>

      <section aria-label="Recorded session metrics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((stat) => (
            <KPI key={stat.label}>
              <KPI.Header>
                <KPI.Title className="min-w-0 truncate">{stat.label}</KPI.Title>
              </KPI.Header>
              <KPI.Content>
                <KPI.Value
                  className="font-mono tabular-nums"
                  maximumFractionDigits={0}
                  style="decimal"
                  value={stat.value}
                />
              </KPI.Content>
            </KPI>
          ))}
        </div>
      </section>

      <section className="scroll-mt-20" id="demo">
        <WwwDemoWorkbench bundle={bundle} loading={bundleLoading} />
      </section>

      <section className="scroll-mt-20" id="receipt-lab">
        <WwwReceiptLab
          initialPayload={firstReceipt?.payload ?? null}
          initialPublicKey={bundle?.commerceSnapshot.public_key ?? null}
          initialSignature={firstReceipt?.signature ?? null}
        />
      </section>

      <section className="scroll-mt-20" id="downloads">
        <Card className="gap-6 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-foreground text-base font-semibold">
              Downloads &amp; Quick Start
            </h2>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onPress={() => openExternalUrl(releaseLinks.dmgUrl)}
              >
                <FileArrowDown className="size-4" />
                macOS .dmg
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => openExternalUrl(releaseLinks.msiUrl)}
              >
                <FileArrowDown className="size-4" />
                Windows .msi
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => openExternalUrl(releaseLinks.linuxUrl)}
              >
                <FileArrowDown className="size-4" />
                Linux .tar.gz
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => openExternalUrl(releaseLinks.releaseUrl)}
              >
                All Releases
                <ArrowRightFromSquare className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {QUICK_START_COMMANDS.map((item) => (
              <CodeBlock key={item.id} className="my-0 rounded-lg">
                <CodeBlock.Header>
                  <span className="text-foreground text-xs font-medium">{item.title}</span>
                  <CodeBlock.CopyButton aria-label={`Copy ${item.title}`} code={item.command} />
                </CodeBlock.Header>
                <CodeBlock.Code code={item.command} language="bash" />
              </CodeBlock>
            ))}
          </div>
        </Card>
      </section>

      <div className="border-separator flex items-center justify-end border-t pt-4 lg:hidden">
        <ThemeToggle showLabel />
      </div>
    </div>
  );
}
