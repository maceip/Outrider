"use client";

import type {LiveSessionBundle} from "../widgets/www-demo-workbench";

import {ArrowRightFromSquare} from "@gravity-ui/icons";
import {Button, Card, Chip, Link, toast} from "@heroui/react";
import {Navbar, Segment} from "@heroui-pro/react";
import {KPI} from "@heroui-pro/react/kpi";
import {useCallback, useEffect, useMemo, useState} from "react";

import {ThemeToggle, useThemeMode} from "../components/theme-toggle";
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
const GITHUB_REPO_URL = "https://github.com/maceip/Outrider";

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
  description: string;
  id: string;
  title: string;
}

const QUICK_START_COMMANDS: ReadonlyArray<QuickStartCommand> = [
  {
    command: "./outrider --web",
    description: "Start the local HTTP/HTTPS proxy, MCP 2026-07-28 gateway, and embedded dashboard.",
    id: "web",
    title: "Launch Local Web Gateway",
  },
  {
    command:
      "python3 scripts/install_native.py && cargo build --release -p proxyfor --bin outrider",
    description:
      "Verify SHA-256-pinned LiteRT-LM runtime libraries and compile the standalone release binary.",
    id: "cargo",
    title: "Build Release Binary From Source",
  },
  {
    command:
      "./outrider receipt issue --subject <SESSION_UUID> --bundle-id outrider_session_evidence --max-calls 10 --expires-at-unix 1893456000",
    description:
      "Mint an operator-signed Ed25519 capability receipt over RFC 8785 JCS canonical JSON.",
    id: "receipt",
    title: "Issue Operator Capability Receipt",
  },
  {
    command: "gh attestation verify Outrider-*.dmg --repo maceip/Outrider",
    description:
      "Verify SLSA build provenance and PURL-tagged SPDX 2.3 SBOM attestations on release installers.",
    id: "attest",
    title: "Verify Cryptographic Attestation",
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

  const [menuOpen, setMenuOpen] = useState(false);
  const [heroVideo, setHeroVideo] = useState<HeroVideoKey>("walkthrough");
  const [bundle, setBundle] = useState<LiveSessionBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(true);
  const [latestRelease, setLatestRelease] = useState<GitHubLatestRelease | null>(null);
  const [checkingLocal, setCheckingLocal] = useState(false);

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
    setMenuOpen(false);
    const target = document.getElementById(sectionId);

    if (target) {
      target.scrollIntoView({behavior: "smooth", block: "start"});
      window.history.replaceState(null, "", `#${sectionId}`);
    }
  }, []);

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

  const handleCopyCommand = useCallback(async (cmd: string, title: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      toast.success(`Copied ${title}`);
    } catch {
      toast.danger("Clipboard write failed");
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
  const iconSrc = `${WWW_BASE_PATH}/brand/${brandThemeDir}/outrider-icon-64.png`;

  const kpis = useMemo(
    () => [
      {label: "Captured Packets", value: bundle?.traffics.length ?? 0},
      {
        label: "Recorded MCP Frames",
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
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <Navbar
        isMenuOpen={menuOpen}
        maxWidth="full"
        position="sticky"
        onMenuOpenChange={setMenuOpen}
      >
        <Navbar.Header className="mx-auto w-full max-w-7xl px-6">
          <Navbar.MenuToggle className="md:hidden" />

          <Navbar.Brand className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- static export resolved via WWW_BASE_PATH */}
            <img
              alt="Outrider"
              className="size-8 shrink-0 rounded-md object-contain"
              height={32}
              src={iconSrc}
              width={32}
            />
            <span className="text-foreground truncate font-mono text-sm font-semibold tracking-wider">
              Outrider
            </span>
          </Navbar.Brand>

          <Navbar.Content className="hidden items-center gap-1 md:flex">
            <Button size="sm" variant="ghost" onPress={() => scrollToSection("demo")}>
              Interactive Demo
            </Button>
            <Button size="sm" variant="ghost" onPress={() => scrollToSection("receipt-lab")}>
              Receipt Lab
            </Button>
            <Button size="sm" variant="ghost" onPress={() => scrollToSection("downloads")}>
              Downloads
            </Button>
          </Navbar.Content>

          <Navbar.Spacer />

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              className="hidden sm:inline-flex"
              isPending={checkingLocal}
              size="sm"
              variant="secondary"
              onPress={() => void handleOpenLocal()}
            >
              Open Local (:8080)
            </Button>
            <Button size="sm" variant="primary" onPress={() => scrollToSection("downloads")}>
              Download
            </Button>
          </div>
        </Navbar.Header>

        <Navbar.Menu className="px-6 py-4 md:hidden">
          <div className="flex flex-col gap-2">
            <Button
              className="justify-start"
              size="sm"
              variant="ghost"
              onPress={() => scrollToSection("demo")}
            >
              Interactive Demo
            </Button>
            <Button
              className="justify-start"
              size="sm"
              variant="ghost"
              onPress={() => scrollToSection("receipt-lab")}
            >
              Receipt Lab
            </Button>
            <Button
              className="justify-start"
              size="sm"
              variant="ghost"
              onPress={() => scrollToSection("downloads")}
            >
              Downloads
            </Button>
            <Button
              className="justify-start sm:hidden"
              isPending={checkingLocal}
              size="sm"
              variant="secondary"
              onPress={() => void handleOpenLocal()}
            >
              Open Local (:8080)
            </Button>
          </div>
        </Navbar.Menu>
      </Navbar>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-8 px-6 pt-10 pb-8 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <Chip color="accent" size="sm" variant="soft">
                Silvector
              </Chip>
              {releaseLinks.tagName ? (
                <Chip className="font-mono tabular-nums" size="sm" variant="soft">
                  {releaseLinks.tagName}
                </Chip>
              ) : null}
            </div>

            <div className="flex flex-col gap-3">
              <h1 className="text-foreground text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
                Outrider
              </h1>
              <p className="text-foreground text-base leading-snug font-medium sm:text-lg">
                Commerce at the speed of intent, built for autonomous agents.
              </p>
              <p className="text-muted text-sm leading-relaxed">
                Inspecting HTTP/HTTPS/WebSocket proxy and MCP 2026-07-28 gateway with native
                on-device LiteRT-LM CLEF evaluation and Ed25519 JCS capability receipts.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="primary" onPress={() => scrollToSection("demo")}>
                Explore Live Capture
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => openExternalUrl(releaseLinks.dmgUrl)}
              >
                macOS .dmg
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => openExternalUrl(releaseLinks.msiUrl)}
              >
                Windows .msi
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => openExternalUrl(releaseLinks.linuxUrl)}
              >
                Linux .tar.gz
              </Button>
            </div>
          </div>

          <div className="min-w-0 lg:col-span-6">
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
                <span className="text-muted font-mono text-xs tabular-nums">
                  {activeVideoConfig.file}
                </span>
              </Card.Footer>
            </Card>
          </div>
        </section>

        <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 pb-14">
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-foreground text-lg font-semibold">
                      Install &amp; CLI Quick Start
                    </h2>
                    {releaseLinks.tagName ? (
                      <Chip className="font-mono tabular-nums" color="success" size="sm" variant="soft">
                        {releaseLinks.tagName}
                      </Chip>
                    ) : null}
                  </div>
                  <p className="text-muted text-sm leading-relaxed">
                    Download SLSA-attested platform installers or launch the gateway directly from
                    your terminal.
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onPress={() => openExternalUrl(releaseLinks.dmgUrl)}
                  >
                    macOS .dmg
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => openExternalUrl(releaseLinks.msiUrl)}
                  >
                    Windows .msi
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => openExternalUrl(releaseLinks.linuxUrl)}
                  >
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
                  <div
                    key={item.id}
                    className="bg-surface-secondary flex flex-col justify-between gap-3 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-foreground text-sm font-medium">{item.title}</span>
                        <span className="text-muted text-xs leading-relaxed">
                          {item.description}
                        </span>
                      </div>
                      <Button
                        className="shrink-0"
                        size="sm"
                        variant="secondary"
                        onPress={() => void handleCopyCommand(item.command, item.title)}
                      >
                        Copy
                      </Button>
                    </div>
                    <code className="bg-surface border-border text-foreground block overflow-x-auto rounded-lg border px-3 py-2 font-mono text-xs whitespace-nowrap tabular-nums">
                      {item.command}
                    </code>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        </div>
      </main>

      <footer className="border-separator border-t py-6">
        <div className="text-muted mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-6 text-xs">
          <span className="font-mono tabular-nums">
            Outrider · MCP 2026-07-28 · Ed25519 JCS (RFC 8785)
          </span>
          <Link
            className="text-accent-soft-foreground inline-flex items-center gap-1.5 no-underline hover:underline"
            href={GITHUB_REPO_URL}
            rel="noreferrer"
            target="_blank"
          >
            Source &amp; Attested Releases on GitHub
            <ArrowRightFromSquare className="size-3.5" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
