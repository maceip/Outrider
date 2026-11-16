"use client";

import type {
  Bundle,
  CapabilityReceiptRow,
  CommerceSnapshot,
  TrafficDetail,
  TrafficHead,
} from "../lib/types";
import type {Selection} from "@heroui/react";
import type {DataGridColumn} from "@heroui-pro/react";

import {FileArrowDown, Play} from "@gravity-ui/icons";
import {
  Button,
  Card,
  Chip,
  Drawer,
  Dropdown,
  Label,
  Link,
  ListBox,
  Modal,
  Popover,
} from "@heroui/react";
import {DataGrid, EmptyState, Navbar, Segment} from "@heroui-pro/react";
import {CodeBlock} from "@heroui-pro/react/code-block";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {setSilvectorTheme, useThemeMode} from "../components/theme-toggle";
import walkthroughCuesData from "../lib/walkthrough-cues.json";
import {WWW_BASE_PATH, withWwwBasePath} from "../lib/www-base-path";
import {GITHUB_REPO_URL} from "../nav-items";
import {formatTrafficBytes, renderTrafficStatusChip} from "../widgets/traffic-detail-pane";

import {InterceptorSlot} from "./interceptor-slot";

const GITHUB_RELEASES_LATEST_URL = "https://github.com/maceip/Outrider/releases/latest";
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/maceip/Outrider/releases/latest";

type EmbeddedSurface = "transactions" | "capture" | "orders";

interface VideoSceneCue {
  description: string;
  id: string;
  startSec: number;
  title: string;
}

interface LiveSessionBundlePayload {
  commerceSnapshot: CommerceSnapshot;
  trafficDetailsById: Record<string, TrafficDetail>;
  traffics: TrafficHead[];
}

interface DrawerInspection {
  json: string;
  subtitle: string;
  title: string;
}

const WALKTHROUGH_CUES: ReadonlyArray<VideoSceneCue> = walkthroughCuesData;

const VALUE_PROPS: ReadonlyArray<{body: string; title: string}> = [
  {
    body: "Pause seller offers mid-transaction and test promotional replacements safely without rewriting history.",
    title: "In-Flight Hold Gate",
  },
  {
    body: "Verify payload structure, seller floor policy, operator approval, and cryptographic receipts independently.",
    title: "Decoupled Verification",
  },
  {
    body: "Runs on your machine with one binary so raw credentials and session traffic never leave loopback.",
    title: "Local Binary, Zero Cloud",
  },
];

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function formatCueTime(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  const mins = Math.floor(whole / 60);
  const rem = whole % 60;

  return `${mins}:${String(rem).padStart(2, "0")}`;
}

function getPacketProtocol(item: TrafficHead): "HTTP" | "HTTPS" | "MCP" | "WS" {
  try {
    const parsed = item.uri.startsWith("/")
      ? new URL(item.uri, "http://localhost")
      : new URL(item.uri);

    if (parsed.pathname === "/mcp" || parsed.pathname === "/mcp/") {
      return "MCP";
    }
  } catch {
    if (item.uri === "/mcp" || item.uri === "/mcp/") {
      return "MCP";
    }
  }
  if (item.websocket_id != null) {
    return "WS";
  }
  if (item.uri.startsWith("https:")) {
    return "HTTPS";
  }

  return "HTTP";
}

function getOrderPassStatus(row: CapabilityReceiptRow): "Active" | "Revoked" | "Exhausted" {
  if (row.revoked !== 0) return "Revoked";
  if (row.remaining_calls <= 0) return "Exhausted";

  return "Active";
}

function tryParseEmbeddedJson(raw: string | undefined | null): unknown {
  if (!raw) return null;
  const trimmed = raw.trim();

  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function formatPacketInspectionJson(
  head: TrafficHead,
  detail: TrafficDetail | undefined,
): string {
  if (!detail) {
    return JSON.stringify(head, null, 2);
  }

  return JSON.stringify(
    {
      end_time: detail.end_time,
      gid: detail.gid,
      http_version: detail.http_version,
      method: detail.method,
      req_body: detail.req_body ? tryParseEmbeddedJson(detail.req_body.value) : null,
      req_headers: detail.req_headers?.items ?? [],
      res_body: detail.res_body ? tryParseEmbeddedJson(detail.res_body.value) : null,
      res_body_size: detail.res_body_size,
      res_headers: detail.res_headers?.items ?? [],
      start_time: detail.start_time,
      status: detail.status,
      uri: detail.uri,
    },
    null,
    2,
  );
}

export function WwwLandingPage() {
  const theme = useThemeMode();
  const isDark = theme === "brutalism-dark";

  const [isWalkthroughOpen, setIsWalkthroughOpen] = useState(false);
  const [videoTimeSec, setVideoTimeSec] = useState(0);
  const [cuePopoverOpen, setCuePopoverOpen] = useState(false);
  const [workspaceSurface, setWorkspaceSurface] = useState<EmbeddedSurface>("transactions");
  const [sessionBundle, setSessionBundle] = useState<LiveSessionBundlePayload | null>(null);
  const [drawerInspection, setDrawerInspection] = useState<DrawerInspection | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(withWwwBasePath("/demo/live-session-bundle.json"), {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) return;
        const parsed = (await res.json()) as LiveSessionBundlePayload;

        if (!controller.signal.aborted) {
          setSessionBundle(parsed);
        }
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error)) {
          // Static bundle load failure leaves empty states intact.
        }
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

  const capturedPackets = useMemo<TrafficHead[]>(() => {
    if (!sessionBundle?.traffics) return [];

    return [...sessionBundle.traffics].sort((a, b) => a.id - b.id);
  }, [sessionBundle]);

  const signedOrders = useMemo<CapabilityReceiptRow[]>(
    () => sessionBundle?.commerceSnapshot?.capability_receipts ?? [],
    [sessionBundle],
  );

  const bundlesById = useMemo(() => {
    const map = new Map<string, Bundle>();

    for (const bundle of sessionBundle?.commerceSnapshot?.bundles ?? []) {
      map.set(bundle.bundle_id, bundle);
    }

    return map;
  }, [sessionBundle]);

  const openPacketDrawer = useCallback(
    (item: TrafficHead) => {
      const detail = sessionBundle?.trafficDetailsById?.[String(item.id)];

      setDrawerInspection({
        json: formatPacketInspectionJson(item, detail),
        subtitle: `${item.method} ${item.uri}`,
        title: `Packet #${item.id}`,
      });
    },
    [sessionBundle],
  );

  const openOrderDrawer = useCallback((order: CapabilityReceiptRow) => {
    setDrawerInspection({
      json: JSON.stringify(order, null, 2),
      subtitle: `Subject ${order.subject}`,
      title: `Session Pass ${order.receipt_id.slice(0, 8)}`,
    });
  }, []);

  const captureColumns = useMemo<DataGridColumn<TrafficHead>[]>(
    () => [
      {
        accessorKey: "id",
        allowsSorting: true,
        cell: (item) => (
          <span className="font-mono text-xs font-medium tabular-nums">#{item.id}</span>
        ),
        header: "ID",
        id: "id",
        isRowHeader: true,
        minWidth: 72,
      },
      {
        cell: (item) => (
          <span className="text-muted font-mono text-xs font-semibold">
            {getPacketProtocol(item)}
          </span>
        ),
        header: "Protocol",
        id: "protocol",
        minWidth: 90,
      },
      {
        accessorKey: "method",
        allowsSorting: true,
        cell: (item) => <span className="font-mono text-xs font-semibold">{item.method}</span>,
        header: "Method",
        id: "method",
        minWidth: 88,
      },
      {
        accessorKey: "uri",
        allowsSorting: true,
        cell: (item) => (
          <span
            className="block max-w-[440px] truncate font-mono text-xs font-medium"
            title={item.uri}
          >
            {item.uri}
          </span>
        ),
        header: "URL",
        id: "uri",
        minWidth: 260,
      },
      {
        accessorKey: "status",
        allowsSorting: true,
        cell: (item) => renderTrafficStatusChip(item.status),
        header: "Status",
        id: "status",
        minWidth: 100,
      },
      {
        accessorKey: "time",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {item.time !== null ? `${item.time} ms` : "—"}
          </span>
        ),
        header: "Latency",
        id: "time",
        minWidth: 100,
      },
      {
        accessorKey: "size",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatTrafficBytes(item.size)}
          </span>
        ),
        header: "Size",
        id: "size",
        minWidth: 100,
      },
      {
        align: "end",
        cell: (item) => (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onPress={() => openPacketDrawer(item)}>
              Inspect
            </Button>
          </div>
        ),
        header: "Payload",
        id: "inspect",
        minWidth: 100,
      },
    ],
    [openPacketDrawer],
  );

  const orderColumns = useMemo<DataGridColumn<CapabilityReceiptRow>[]>(
    () => [
      {
        accessorKey: "receipt_id",
        allowsSorting: true,
        cell: (item) => (
          <span
            className="block max-w-[220px] truncate font-mono text-xs font-medium tabular-nums"
            title={item.receipt_id}
          >
            {item.receipt_id}
          </span>
        ),
        header: "Pass ID",
        id: "receipt_id",
        isRowHeader: true,
        minWidth: 180,
      },
      {
        cell: (item) => {
          const bundleTitle = bundlesById.get(item.bundle_id)?.title ?? "Session Pass";

          return <span className="text-foreground truncate text-xs font-medium">{bundleTitle}</span>;
        },
        header: "Bundle",
        id: "bundle",
        minWidth: 180,
      },
      {
        accessorKey: "subject",
        allowsSorting: true,
        cell: (item) => (
          <span
            className="text-muted block max-w-[220px] truncate font-mono text-xs tabular-nums"
            title={item.subject}
          >
            {item.subject}
          </span>
        ),
        header: "Subject",
        id: "subject",
        minWidth: 180,
      },
      {
        cell: (item) => {
          const status = getOrderPassStatus(item);
          const color =
            status === "Active" ? "success" : status === "Revoked" ? "danger" : "default";

          return (
            <Chip color={color} size="sm" variant="soft">
              {status}
            </Chip>
          );
        },
        header: "Status",
        id: "status",
        minWidth: 110,
      },
      {
        cell: (item) => (
          <span className="font-mono text-xs tabular-nums">
            {item.remaining_calls} / {item.max_calls}
          </span>
        ),
        header: "Calls",
        id: "calls",
        minWidth: 100,
      },
      {
        accessorKey: "created_at",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {new Date(item.created_at * 1000).toLocaleDateString("en-US", DATE_FORMAT_OPTIONS)}
          </span>
        ),
        header: "Issued",
        id: "created_at",
        minWidth: 130,
      },
      {
        align: "end",
        cell: (item) => (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onPress={() => openOrderDrawer(item)}>
              Inspect
            </Button>
          </div>
        ),
        header: "Payload",
        id: "inspect",
        minWidth: 100,
      },
    ],
    [bundlesById, openOrderDrawer],
  );

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
          Intercept, verify, and mediate agent commerce in real time.
        </h1>
        <p className="text-muted max-w-2xl font-sans text-base font-normal leading-relaxed sm:text-lg">
          Hold live buyer-to-seller offers in flight, validate policy and schema gates, and approve
          session orders before a single transaction clears.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button variant="primary" onPress={scrollToLiveInterceptor}>
            Launch Live Interceptor
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
        <div className="flex items-center justify-between gap-3">
          <Segment
            aria-label="Live workspace view"
            selectedKey={workspaceSurface}
            size="sm"
            onSelectionChange={(key) => setWorkspaceSurface(String(key) as EmbeddedSurface)}
          >
            <Segment.Item id="transactions">Transactions</Segment.Item>
            <Segment.Item id="capture">Capture</Segment.Item>
            <Segment.Item id="orders">Orders</Segment.Item>
          </Segment>
        </div>

        {workspaceSurface === "transactions" ? (
          <InterceptorSlot embedded />
        ) : workspaceSurface === "capture" ? (
          <Card className="overflow-hidden p-0">
            <DataGrid
              aria-label="Captured session packets"
              className="[&_.table__column]:rounded-none! [&_.table__row]:cursor-[var(--cursor-interactive)]"
              columns={captureColumns}
              contentClassName="min-w-[820px]"
              data={capturedPackets}
              getRowId={(item) => String(item.id)}
              renderEmptyState={() => (
                <div className="py-8">
                  <EmptyState size="sm">
                    <EmptyState.Header>
                      <EmptyState.Title>No Captured Packets</EmptyState.Title>
                      <EmptyState.Description>
                        Session packets from the recorded capture appear here.
                      </EmptyState.Description>
                    </EmptyState.Header>
                  </EmptyState>
                </div>
              )}
              selectionBehavior="replace"
              selectedKeys={new Set()}
              selectionMode="single"
              onRowAction={(key) => {
                const match = capturedPackets.find((item) => String(item.id) === String(key));

                if (match) openPacketDrawer(match);
              }}
              onSelectionChange={(keys) => {
                if (keys === "all") return;
                const picked = Array.from(keys)[0];
                const match = capturedPackets.find((item) => String(item.id) === String(picked));

                if (match) openPacketDrawer(match);
              }}
            />
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <DataGrid
              aria-label="Signed session orders"
              className="[&_.table__column]:rounded-none! [&_.table__row]:cursor-[var(--cursor-interactive)]"
              columns={orderColumns}
              contentClassName="min-w-[820px]"
              data={signedOrders}
              getRowId={(item) => item.receipt_id}
              renderEmptyState={() => (
                <div className="py-8">
                  <EmptyState size="sm">
                    <EmptyState.Header>
                      <EmptyState.Title>No Session Orders</EmptyState.Title>
                      <EmptyState.Description>
                        Signed session passes from the recorded capture appear here.
                      </EmptyState.Description>
                    </EmptyState.Header>
                  </EmptyState>
                </div>
              )}
              selectionBehavior="replace"
              selectedKeys={new Set()}
              selectionMode="single"
              onRowAction={(key) => {
                const match = signedOrders.find((item) => item.receipt_id === String(key));

                if (match) openOrderDrawer(match);
              }}
              onSelectionChange={(keys) => {
                if (keys === "all") return;
                const picked = Array.from(keys)[0];
                const match = signedOrders.find((item) => item.receipt_id === String(picked));

                if (match) openOrderDrawer(match);
              }}
            />
          </Card>
        )}
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

      <Drawer
        isOpen={drawerInspection !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerInspection(null);
        }}
      >
        <Drawer.Backdrop>
          <Drawer.Content placement="right">
            <Drawer.Dialog aria-label={drawerInspection?.title ?? "Payload Inspector"}>
              <Drawer.CloseTrigger />
              <Drawer.Header className="flex-col items-start gap-1">
                <Drawer.Heading className="text-foreground text-base font-semibold">
                  {drawerInspection?.title ?? "Payload Inspector"}
                </Drawer.Heading>
                {drawerInspection?.subtitle ? (
                  <span className="text-muted max-w-full truncate font-mono text-xs">
                    {drawerInspection.subtitle}
                  </span>
                ) : null}
              </Drawer.Header>
              <Drawer.Body>
                <CodeBlock className="my-0 rounded-lg">
                  <CodeBlock.Header>
                    <span className="text-muted font-mono text-xs">JSON</span>
                    <CodeBlock.CopyButton code={drawerInspection?.json ?? "{}"} />
                  </CodeBlock.Header>
                  <CodeBlock.Code code={drawerInspection?.json ?? "{}"} language="json" />
                </CodeBlock>
              </Drawer.Body>
              <Drawer.Footer className="justify-end">
                <Button slot="close" type="button" variant="ghost">
                  Close
                </Button>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}
