"use client";

import type {LiveSessionBundle} from "../widgets/www-demo-workbench";

import {ArrowRightFromSquare, FileArrowDown} from "@gravity-ui/icons";
import {Button, Card, Chip, toast} from "@heroui/react";
import {Segment} from "@heroui-pro/react";
import {CodeBlock} from "@heroui-pro/react/code-block";
import {KPI} from "@heroui-pro/react/kpi";
import {useCallback, useEffect, useMemo, useState} from "react";

import {useThemeMode} from "../components/theme-toggle";
import {WWW_BASE_PATH, withWwwBasePath} from "../lib/www-base-path";
import {WwwDemoWorkbench} from "../widgets/www-demo-workbench";
import {WwwReceiptLab} from "../widgets/www-receipt-lab";

type HeroVideoKey = "walkthrough" | "reel" | "mark";

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

const HERO_VIDEOS: ReadonlyArray<{
  file: string;
  id: HeroVideoKey;
  label: string;
}> = [
  {file: "playwright-walkthrough.mp4", id: "walkthrough", label: "Live Walkthrough"},
  {file: "silvector-reel.mp4", id: "reel", label: "Silvector Reel"},
  {file: "outrider-mark.mp4", id: "mark", label: "Outrider Mark"},
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
    title: "Issue Session Receipt",
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

  const [heroVideo, setHeroVideo] = useState<HeroVideoKey>("walkthrough");
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
          throw new Error(`HTTP ${res.status}`);
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
        // GitHub API rate-limit or offline browsing falls back cleanly to releases/latest URL.
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
      tagName: latestRelease?.tag_name ?? null,
    };
  }, [latestRelease]);

  const activeVideoConfig = useMemo(
    () => HERO_VIDEOS.find((item) => item.id === heroVideo) ?? HERO_VIDEOS[0],
    [heroVideo],
  );

  const activeVideoSrc = `${WWW_BASE_PATH}/demo/${activeVideoConfig.file}`;
  const posterSrc = `${WWW_BASE_PATH}/brand/${brandThemeDir}/outrider-logo-512.png`;
  const logoSrc = `${WWW_BASE_PATH}/brand/${brandThemeDir}/outrider-logo-256.png`;

  const kpis = useMemo(
    () => [
      {label: "Captured Packets", value: bundle?.traffics.length ?? 0},
      {
        label: "MCP Frames",
        value: bundle?.commerceSnapshot.mcp_frames.length ?? 0,
      },
      {
        label: "CLEF Evaluations",
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
        className="scroll-mt-20 grid grid-cols-1 items-center gap-6 lg:grid-cols-12"
        id="overview"
      >
        <Card className="h-full justify-between gap-6 p-6 lg:col-span-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- static export resolved via WWW_BASE_PATH */}
              <img
                alt="Outrider mark"
                className="size-12 shrink-0 rounded-lg object-contain"
                height={48}
                src={logoSrc}
                width={48}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Chip color="accent" size="sm" variant="soft">
                  Silvector
                </Chip>
                {releaseLinks.tagName ? (
                  <Chip className="font-mono tabular-nums" size="sm" variant="soft">
                    {releaseLinks.tagName}
                  </Chip>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="text-foreground text-2xl leading-tight font-semibold tracking-tight">
                Inspect traffic, tools, and session receipts in one gateway.
              </h2>
              <p className="text-muted text-sm leading-relaxed">
                Unified HTTP, WebSocket, and MCP workbench with scoped receipt verification.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="primary" onPress={() => scrollToSection("demo")}>
              Explore Live Capture
            </Button>
            <Button variant="secondary" onPress={() => scrollToSection("receipt-lab")}>
              Receipt Lab
            </Button>
          </div>
        </Card>

        <div className="min-w-0 lg:col-span-7">
          <Card className="overflow-hidden p-0">
            <video
              key={activeVideoSrc}
              autoPlay
              controls
              loop
              muted
              playsInline
              className="bg-surface-secondary aspect-video w-full object-cover"
              poster={posterSrc}
              src={activeVideoSrc}
            />
            <Card.Footer className="border-separator flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
              <Segment
                aria-label="Select showcase reel"
                selectedKey={heroVideo}
                size="sm"
                onSelectionChange={(key) => setHeroVideo(String(key) as HeroVideoKey)}
              >
                {HERO_VIDEOS.map((item) => (
                  <Segment.Item key={item.id} id={item.id}>
                    {item.label}
                  </Segment.Item>
                ))}
              </Segment>
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
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-foreground text-base font-semibold">
                Downloads &amp; Quick Start
              </h2>
              {releaseLinks.tagName ? (
                <Chip className="font-mono tabular-nums" color="success" size="sm" variant="soft">
                  {releaseLinks.tagName}
                </Chip>
              ) : null}
            </div>

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
    </div>
  );
}
