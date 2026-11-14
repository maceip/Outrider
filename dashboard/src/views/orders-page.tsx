"use client";

import type {
  Bundle,
  CapabilityReceiptRow,
  CatalogItem,
  MrtrQuote,
  ReceiptRedemption,
  SessionOffer,
} from "../lib/types";
import type {InspectedCommercePayload} from "../widgets/orders-row-actions";
import type {DataGridColumn, DataGridSelection} from "@heroui-pro/react";
import type {
  CSSProperties,
  Key,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import {CircleCheck, Copy, Funnel, TrashBin} from "@gravity-ui/icons";
import {Button, Chip, Dropdown, Label, SearchField} from "@heroui/react";
import {DataGrid, KPIGroup, Segment} from "@heroui-pro/react";
import {KPI} from "@heroui-pro/react/kpi";
import {Fragment, useCallback, useMemo, useRef, useState} from "react";

import {IconButton} from "../components/icon-button";
import {useOutrider} from "../lib/outrider-store";
import {OrdersRowActions, encodeSignedReceiptToken} from "../widgets/orders-row-actions";

type CommerceSegment = "receipts" | "bundles" | "offers" | "redemptions";

interface StatusOption {
  id: string;
  label: string;
}

interface CatalogOrBundleRow {
  rowKey: string;
  id: string;
  entryType: "bundle" | "catalog";
  kind: string;
  titleOrScope: string;
  contentsOrDigest: string;
  itemCount: number;
  ruleSummary: string;
  raw: Bundle | CatalogItem;
}

interface OfferOrQuoteRow {
  rowKey: string;
  id: string;
  entryType: "offer" | "quote";
  bundle_id: string;
  session_id: string;
  sourceOrSubject: string;
  statusLabel: string;
  statusColor: "success" | "warning" | "accent" | "default";
  timestamp: number;
  raw: SessionOffer | MrtrQuote;
}

const DEFAULT_INSPECTOR_WIDTH = 380;
const MIN_INSPECTOR_WIDTH = 280;
const MAX_INSPECTOR_WIDTH = 580;

const SEGMENT_STATUS_OPTIONS: Record<CommerceSegment, StatusOption[]> = {
  bundles: [
    {id: "all", label: "All"},
    {id: "bundle", label: "Bundles"},
    {id: "tool", label: "Catalog · Tools"},
    {id: "skill", label: "Catalog · Skills"},
    {id: "resource", label: "Catalog · Resources & Prompts"},
  ],
  offers: [
    {id: "all", label: "All"},
    {id: "offer", label: "Session Offers"},
    {id: "quote_active", label: "Active Quotes"},
    {id: "quote_consumed", label: "Consumed Quotes"},
  ],
  receipts: [
    {id: "all", label: "All"},
    {id: "verified", label: "Ed25519 verified"},
    {id: "revoked", label: "Revoked"},
    {id: "exhausted", label: "Exhausted"},
    {id: "invalid", label: "Invalid signature"},
  ],
  redemptions: [
    {id: "all", label: "All"},
    {id: "quoted", label: "With MRTR Quote"},
    {id: "direct", label: "Direct Receipt"},
  ],
};

function formatUtcTimestamp(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "—";

  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function getReceiptStatus(
  row: CapabilityReceiptRow,
  nowUnix: number,
): {
  key: "revoked" | "invalid" | "exhausted" | "verified";
  label: string;
  color: "danger" | "warning" | "success";
} {
  if (row.revoked) {
    return {color: "danger", key: "revoked", label: "Revoked"};
  }
  if (!row.signature_verified) {
    return {color: "danger", key: "invalid", label: "Invalid signature"};
  }
  if (row.remaining_calls <= 0) {
    return {color: "warning", key: "exhausted", label: "Exhausted"};
  }
  if (nowUnix > 0 && row.expires_at_unix <= nowUnix) {
    return {color: "warning", key: "exhausted", label: "Expired"};
  }

  return {color: "success", key: "verified", label: "Ed25519 verified"};
}

export function OrdersPage() {
  const {
    busy,
    lastUpdatedAt,
    mutate,
    openDialog,
    selectedEvidence,
    selectedReceiptId,
    selectedSessionId,
    setSelectedEvidence,
    setSelectedReceiptId,
    snapshot,
    unlocked,
  } = useOutrider();

  const [segment, setSegment] = useState<CommerceSegment>("receipts");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const inspectorRef = useRef<HTMLElement | null>(null);

  const nowUnix = useMemo(
    () => (lastUpdatedAt ? Math.floor(lastUpdatedAt / 1000) : 0),
    [lastUpdatedAt],
  );

  const kpiMetrics = useMemo(() => {
    const bundles = snapshot?.bundles.length ?? 0;
    const offers = snapshot?.session_offers.length ?? 0;
    const quotes = snapshot?.mrtr_quotes.length ?? 0;
    const allReceipts = snapshot?.capability_receipts ?? [];
    const unrevokedReceipts = allReceipts.filter((r) => !r.revoked).length;
    const redemptions = snapshot?.receipt_redemptions.length ?? 0;

    return [
      {id: "bundles", title: "Bundles", value: bundles},
      {id: "offers", title: "Session Offers", value: offers},
      {id: "quotes", title: "MRTR Quotes", value: quotes},
      {id: "receipts", title: "Capability Receipts", value: unrevokedReceipts},
      {id: "redemptions", title: "Redemptions", value: redemptions},
    ];
  }, [snapshot]);

  const statusOptions = SEGMENT_STATUS_OPTIONS[segment];
  const effectiveStatus = useMemo(
    () =>
      statusOptions.some((opt) => opt.id === statusFilter) ? statusFilter : "all",
    [statusFilter, statusOptions],
  );
  const activeStatusLabel = useMemo(
    () => statusOptions.find((opt) => opt.id === effectiveStatus)?.label ?? "All",
    [effectiveStatus, statusOptions],
  );

  const putBundleReason = !unlocked
    ? "Admin token required"
    : busy
      ? "Backend action in progress"
      : undefined;

  const hasBundles = (snapshot?.bundles.length ?? 0) > 0;
  const issueReceiptReason =
    putBundleReason ?? (!hasBundles ? "Configure at least one bundle first" : undefined);

  const synthesizeReason =
    putBundleReason ??
    (!selectedSessionId
      ? "Record an agent session before synthesizing offers"
      : !hasBundles
        ? "Configure at least one bundle first"
        : undefined);

  // 1. Filtered Capability Receipts
  const filteredReceipts = useMemo<CapabilityReceiptRow[]>(() => {
    const rows = snapshot?.capability_receipts ?? [];
    const q = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (effectiveStatus !== "all") {
        const status = getReceiptStatus(row, nowUnix);

        if (status.key !== effectiveStatus) return false;
      }
      if (!q) return true;

      return (
        row.receipt_id.toLowerCase().includes(q) ||
        row.subject.toLowerCase().includes(q) ||
        row.bundle_id.toLowerCase().includes(q) ||
        row.signature.toLowerCase().includes(q)
      );
    });
  }, [effectiveStatus, nowUnix, search, snapshot?.capability_receipts]);

  // 2. Filtered Bundles & Catalog Items
  const filteredBundlesAndCatalog = useMemo<CatalogOrBundleRow[]>(() => {
    const bundleRows: CatalogOrBundleRow[] = (snapshot?.bundles ?? []).map((b) => ({
      contentsOrDigest: b.items.join(", "),
      entryType: "bundle",
      id: b.bundle_id,
      itemCount: b.items.length,
      kind: "bundle",
      raw: b,
      rowKey: `bundle:${b.bundle_id}`,
      ruleSummary:
        b.rules.required_pick !== undefined
          ? `required_pick=${String(b.rules.required_pick)}`
          : "Unrestricted",
      titleOrScope: b.title,
    }));

    const catalogRows: CatalogOrBundleRow[] = (snapshot?.catalog_items ?? []).map((c) => ({
      contentsOrDigest: c.digest,
      entryType: "catalog",
      id: c.item_id,
      itemCount: 1,
      kind: c.kind,
      raw: c,
      rowKey: `catalog:${c.item_id}`,
      ruleSummary: c.upstream_name ? `upstream:${c.upstream_name}` : "local",
      titleOrScope: c.upstream_name ? `Upstream · ${c.upstream_name}` : "Local gateway",
    }));

    const combined = [...bundleRows, ...catalogRows];
    const q = search.trim().toLowerCase();

    return combined.filter((row) => {
      if (effectiveStatus === "bundle" && row.entryType !== "bundle") return false;
      if (effectiveStatus === "tool" && row.kind !== "tool") return false;
      if (effectiveStatus === "skill" && row.kind !== "skill") return false;
      if (
        effectiveStatus === "resource" &&
        (row.entryType !== "catalog" || row.kind === "tool" || row.kind === "skill")
      ) {
        return false;
      }
      if (!q) return true;

      return (
        row.id.toLowerCase().includes(q) ||
        row.kind.toLowerCase().includes(q) ||
        row.titleOrScope.toLowerCase().includes(q) ||
        row.contentsOrDigest.toLowerCase().includes(q) ||
        row.ruleSummary.toLowerCase().includes(q)
      );
    });
  }, [effectiveStatus, search, snapshot?.bundles, snapshot?.catalog_items]);

  // 3. Filtered Session Offers & MRTR Quotes
  const filteredOffersAndQuotes = useMemo<OfferOrQuoteRow[]>(() => {
    const offerRows: OfferOrQuoteRow[] = (snapshot?.session_offers ?? []).map((offer) => ({
      bundle_id: offer.bundle_id,
      entryType: "offer",
      id: offer.offer_id,
      raw: offer,
      rowKey: `offer:${offer.offer_id}`,
      session_id: offer.session_id,
      sourceOrSubject: offer.source,
      statusColor: offer.evaluation_id ? "accent" : "default",
      statusLabel: offer.evaluation_id ? "CLEF-gated offer" : "Session offer",
      timestamp: offer.created_at,
    }));

    const quoteRows: OfferOrQuoteRow[] = (snapshot?.mrtr_quotes ?? []).map((quote) => {
      const expired = !quote.consumed && nowUnix > 0 && quote.expires_at_unix <= nowUnix;

      return {
        bundle_id: quote.bundle_id,
        entryType: "quote",
        id: quote.quote_id,
        raw: quote,
        rowKey: `quote:${quote.quote_id}`,
        session_id: quote.session_id,
        sourceOrSubject: quote.subject,
        statusColor: quote.consumed ? "success" : expired ? "warning" : "accent",
        statusLabel: quote.consumed ? "Consumed" : expired ? "Expired quote" : "Active quote",
        timestamp: quote.expires_at_unix,
      };
    });

    const combined = [...offerRows, ...quoteRows];
    const q = search.trim().toLowerCase();

    return combined.filter((row) => {
      if (effectiveStatus === "offer" && row.entryType !== "offer") return false;
      if (effectiveStatus === "quote_active") {
        if (row.entryType !== "quote") return false;
        const rawQuote = row.raw as MrtrQuote;

        if (rawQuote.consumed) return false;
      }
      if (effectiveStatus === "quote_consumed") {
        if (row.entryType !== "quote") return false;
        const rawQuote = row.raw as MrtrQuote;

        if (!rawQuote.consumed) return false;
      }
      if (!q) return true;

      return (
        row.id.toLowerCase().includes(q) ||
        row.bundle_id.toLowerCase().includes(q) ||
        row.session_id.toLowerCase().includes(q) ||
        row.sourceOrSubject.toLowerCase().includes(q) ||
        row.statusLabel.toLowerCase().includes(q)
      );
    });
  }, [effectiveStatus, nowUnix, search, snapshot?.mrtr_quotes, snapshot?.session_offers]);

  // 4. Filtered Redemptions
  const filteredRedemptions = useMemo<ReceiptRedemption[]>(() => {
    const rows = snapshot?.receipt_redemptions ?? [];
    const q = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (effectiveStatus === "quoted" && row.quote_id === null) return false;
      if (effectiveStatus === "direct" && row.quote_id !== null) return false;
      if (!q) return true;

      return (
        row.redemption_id.toLowerCase().includes(q) ||
        row.receipt_id.toLowerCase().includes(q) ||
        row.session_id.toLowerCase().includes(q) ||
        row.tool_name.toLowerCase().includes(q) ||
        (row.quote_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [effectiveStatus, search, snapshot?.receipt_redemptions]);

  // Derive active inspected record directly from live snapshot state
  const activeInspected = useMemo<InspectedCommercePayload | null>(() => {
    if (segment === "receipts") {
      const targetId = selectedRowKey ?? selectedReceiptId;
      const found =
        (targetId
          ? (snapshot?.capability_receipts ?? []).find((r) => r.receipt_id === targetId)
          : undefined) ?? filteredReceipts[0];

      if (found) {
        const isIssuedTokenMatch =
          selectedEvidence &&
          typeof selectedEvidence.record === "object" &&
          selectedEvidence.record !== null &&
          "signed_receipt" in selectedEvidence.record &&
          (selectedEvidence.record as {signed_receipt?: {receipt?: {receipt_id?: string}}})
            .signed_receipt?.receipt?.receipt_id === found.receipt_id;

        return {
          id: found.receipt_id,
          label: isIssuedTokenMatch
            ? selectedEvidence.label
            : `R-${found.receipt_id.slice(0, 8)}`,
          receipt: found,
          record: isIssuedTokenMatch ? selectedEvidence.record : found,
        };
      }

      return null;
    }

    if (segment === "bundles") {
      const found =
        (selectedRowKey
          ? filteredBundlesAndCatalog.find((r) => r.rowKey === selectedRowKey)
          : undefined) ?? filteredBundlesAndCatalog[0];

      if (!found) return null;

      return {
        id: found.id,
        label: `${found.entryType === "bundle" ? "B" : "C"}-${found.id.slice(0, 14)}`,
        record: found.raw,
      };
    }

    if (segment === "offers") {
      const found =
        (selectedRowKey
          ? filteredOffersAndQuotes.find((r) => r.rowKey === selectedRowKey)
          : undefined) ?? filteredOffersAndQuotes[0];

      if (!found) return null;

      return {
        id: found.id,
        label: `${found.entryType === "offer" ? "O" : "Q"}-${found.id.slice(0, 8)}`,
        record: found.raw,
      };
    }

    const found =
      (selectedRowKey
        ? filteredRedemptions.find((r) => r.redemption_id === selectedRowKey)
        : undefined) ?? filteredRedemptions[0];

    if (!found) return null;

    return {
      id: found.redemption_id,
      label: `D-${found.redemption_id.slice(0, 8)}`,
      record: found,
    };
  }, [
    filteredBundlesAndCatalog,
    filteredOffersAndQuotes,
    filteredReceipts,
    filteredRedemptions,
    segment,
    selectedEvidence,
    selectedReceiptId,
    selectedRowKey,
    snapshot?.capability_receipts,
  ]);

  const activeGridKey = useMemo(() => {
    if (!activeInspected) return null;
    if (segment === "receipts" || segment === "redemptions") {
      return activeInspected.id;
    }
    if (segment === "bundles") {
      const match = filteredBundlesAndCatalog.find((r) => r.id === activeInspected.id);

      return match?.rowKey ?? null;
    }
    const match = filteredOffersAndQuotes.find((r) => r.id === activeInspected.id);

    return match?.rowKey ?? null;
  }, [activeInspected, filteredBundlesAndCatalog, filteredOffersAndQuotes, segment]);

  const handleSelectPayload = useCallback(
    (payload: InspectedCommercePayload, rowKey?: string) => {
      setSelectedRowKey(rowKey ?? payload.id);
      if (payload.receipt) {
        setSelectedReceiptId(payload.receipt.receipt_id);
      }
      setSelectedEvidence({
        label: payload.label,
        record: payload.record,
      });
    },
    [setSelectedEvidence, setSelectedReceiptId],
  );

  const handleGridSelectionChange = useCallback(
    (keys: DataGridSelection) => {
      if (keys === "all") return;
      const firstKey = keys.values().next().value;

      if (firstKey === undefined) return;
      const keyStr = String(firstKey);

      setSelectedRowKey(keyStr);

      if (segment === "receipts") {
        const found = (snapshot?.capability_receipts ?? []).find((r) => r.receipt_id === keyStr);

        if (found) {
          setSelectedReceiptId(found.receipt_id);
          setSelectedEvidence({label: `R-${found.receipt_id.slice(0, 8)}`, record: found});
        }
      } else if (segment === "bundles") {
        const found = filteredBundlesAndCatalog.find((r) => r.rowKey === keyStr);

        if (found) {
          setSelectedEvidence({
            label: `${found.entryType === "bundle" ? "B" : "C"}-${found.id.slice(0, 14)}`,
            record: found.raw,
          });
        }
      } else if (segment === "offers") {
        const found = filteredOffersAndQuotes.find((r) => r.rowKey === keyStr);

        if (found) {
          setSelectedEvidence({
            label: `${found.entryType === "offer" ? "O" : "Q"}-${found.id.slice(0, 8)}`,
            record: found.raw,
          });
        }
      } else {
        const found = filteredRedemptions.find((r) => r.redemption_id === keyStr);

        if (found) {
          setSelectedEvidence({
            label: `D-${found.redemption_id.slice(0, 8)}`,
            record: found,
          });
        }
      }
    },
    [
      filteredBundlesAndCatalog,
      filteredOffersAndQuotes,
      filteredRedemptions,
      segment,
      setSelectedEvidence,
      setSelectedReceiptId,
      snapshot?.capability_receipts,
    ],
  );

  const copyText = useCallback(async (key: string, text: string) => {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      setActionError("Clipboard write blocked by browser permissions.");
    }
  }, []);

  const handleResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth =
      inspectorRef.current?.getBoundingClientRect().width ?? DEFAULT_INSPECTOR_WIDTH;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const clamped = Math.max(
        MIN_INSPECTOR_WIDTH,
        Math.min(MAX_INSPECTOR_WIDTH, Math.round(startWidth + delta)),
      );

      setInspectorWidth(clamped);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setInspectorWidth((w) => Math.min(MAX_INSPECTOR_WIDTH, w + 16));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setInspectorWidth((w) => Math.max(MIN_INSPECTOR_WIDTH, w - 16));
    } else if (event.key === "Home") {
      event.preventDefault();
      setInspectorWidth(DEFAULT_INSPECTOR_WIDTH);
    }
  }, []);

  // DataGrid Columns: 1. Receipts
  const receiptColumns = useMemo<DataGridColumn<CapabilityReceiptRow>[]>(
    () => [
      {
        accessorKey: "receipt_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">
            {row.receipt_id.slice(0, 14)}
          </span>
        ),
        header: "Receipt ID",
        id: "receipt_id",
        isRowHeader: true,
        minWidth: 140,
      },
      {
        accessorKey: "subject",
        allowsSorting: true,
        cell: (row) => (
          <span className="block max-w-[200px] truncate font-mono text-xs">{row.subject}</span>
        ),
        header: "Subject",
        id: "subject",
        minWidth: 180,
      },
      {
        accessorKey: "bundle_id",
        allowsSorting: true,
        cell: (row) => <span className="font-mono text-xs">{row.bundle_id}</span>,
        header: "Bundle",
        id: "bundle_id",
        minWidth: 120,
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">
            {row.remaining_calls} / {row.max_calls}
          </span>
        ),
        header: "Remaining",
        id: "remaining_calls",
        minWidth: 110,
        sortFn: (a, b) => a.remaining_calls - b.remaining_calls,
      },
      {
        accessorKey: "expires_at_unix",
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatUtcTimestamp(row.expires_at_unix)}
          </span>
        ),
        header: "Expires (UTC)",
        id: "expires_at_unix",
        minWidth: 155,
      },
      {
        allowsSorting: true,
        cell: (row) => {
          const status = getReceiptStatus(row, nowUnix);

          return (
            <Chip color={status.color} size="sm" variant="soft">
              {status.label}
            </Chip>
          );
        },
        header: "Status",
        id: "status",
        minWidth: 145,
        sortFn: (a, b) =>
          getReceiptStatus(a, nowUnix).label.localeCompare(getReceiptStatus(b, nowUnix).label),
      },
      {
        align: "end",
        cell: (row) => (
          <OrdersRowActions
            id={row.receipt_id}
            isSelected={activeGridKey === row.receipt_id}
            label={`R-${row.receipt_id.slice(0, 8)}`}
            receipt={row}
            record={row}
            onActionError={setActionError}
            onInspect={(payload) => handleSelectPayload(payload, row.receipt_id)}
          />
        ),
        header: "Actions",
        id: "actions",
        minWidth: 120,
      },
    ],
    [activeGridKey, handleSelectPayload, nowUnix],
  );

  // DataGrid Columns: 2. Bundles & Catalog
  const bundleCatalogColumns = useMemo<DataGridColumn<CatalogOrBundleRow>[]>(
    () => [
      {
        accessorKey: "id",
        allowsSorting: true,
        cell: (row) => (
          <span className="block max-w-[200px] truncate font-mono text-xs font-medium">
            {row.id}
          </span>
        ),
        header: "ID",
        id: "id",
        isRowHeader: true,
        minWidth: 165,
      },
      {
        accessorKey: "kind",
        allowsSorting: true,
        cell: (row) => (
          <Chip
            color={row.entryType === "bundle" ? "accent" : "default"}
            size="sm"
            variant="soft"
          >
            {row.entryType === "bundle" ? "bundle" : row.kind}
          </Chip>
        ),
        header: "Kind",
        id: "kind",
        minWidth: 105,
      },
      {
        accessorKey: "titleOrScope",
        allowsSorting: true,
        cell: (row) => <span className="block max-w-[200px] truncate text-xs">{row.titleOrScope}</span>,
        header: "Title / Scope",
        id: "titleOrScope",
        minWidth: 165,
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted block max-w-[220px] truncate font-mono text-xs tabular-nums">
            {row.entryType === "bundle"
              ? `${row.itemCount} items · ${row.contentsOrDigest}`
              : row.contentsOrDigest.slice(0, 20)}
          </span>
        ),
        header: "Items / Digest",
        id: "contents",
        minWidth: 185,
        sortFn: (a, b) => a.itemCount - b.itemCount,
      },
      {
        accessorKey: "ruleSummary",
        allowsSorting: true,
        cell: (row) => <span className="font-mono text-xs">{row.ruleSummary}</span>,
        header: "Policy",
        id: "ruleSummary",
        minWidth: 130,
      },
      {
        align: "end",
        cell: (row) => (
          <OrdersRowActions
            id={row.id}
            isSelected={activeGridKey === row.rowKey}
            label={`${row.entryType === "bundle" ? "B" : "C"}-${row.id.slice(0, 14)}`}
            record={row.raw}
            onActionError={setActionError}
            onInspect={(payload) => handleSelectPayload(payload, row.rowKey)}
          />
        ),
        header: "Actions",
        id: "actions",
        minWidth: 96,
      },
    ],
    [activeGridKey, handleSelectPayload],
  );

  // DataGrid Columns: 3. Offers & Quotes
  const offerQuoteColumns = useMemo<DataGridColumn<OfferOrQuoteRow>[]>(
    () => [
      {
        accessorKey: "id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">{row.id.slice(0, 14)}</span>
        ),
        header: "Offer / Quote ID",
        id: "id",
        isRowHeader: true,
        minWidth: 145,
      },
      {
        accessorKey: "bundle_id",
        allowsSorting: true,
        cell: (row) => <span className="font-mono text-xs">{row.bundle_id}</span>,
        header: "Bundle",
        id: "bundle_id",
        minWidth: 120,
      },
      {
        accessorKey: "session_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">{row.session_id.slice(0, 12)}</span>
        ),
        header: "Session",
        id: "session_id",
        minWidth: 125,
      },
      {
        accessorKey: "sourceOrSubject",
        allowsSorting: true,
        cell: (row) => (
          <span className="block max-w-[180px] truncate font-mono text-xs">
            {row.sourceOrSubject}
          </span>
        ),
        header: "Source / Subject",
        id: "sourceOrSubject",
        minWidth: 155,
      },
      {
        accessorKey: "statusLabel",
        allowsSorting: true,
        cell: (row) => (
          <Chip color={row.statusColor} size="sm" variant="soft">
            {row.statusLabel}
          </Chip>
        ),
        header: "Status",
        id: "statusLabel",
        minWidth: 140,
      },
      {
        accessorKey: "timestamp",
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatUtcTimestamp(row.timestamp)}
          </span>
        ),
        header: "Timestamp (UTC)",
        id: "timestamp",
        minWidth: 155,
      },
      {
        align: "end",
        cell: (row) => (
          <OrdersRowActions
            id={row.id}
            isSelected={activeGridKey === row.rowKey}
            label={`${row.entryType === "offer" ? "O" : "Q"}-${row.id.slice(0, 8)}`}
            record={row.raw}
            onActionError={setActionError}
            onInspect={(payload) => handleSelectPayload(payload, row.rowKey)}
          />
        ),
        header: "Actions",
        id: "actions",
        minWidth: 96,
      },
    ],
    [activeGridKey, handleSelectPayload],
  );

  // DataGrid Columns: 4. Redemptions
  const redemptionColumns = useMemo<DataGridColumn<ReceiptRedemption>[]>(
    () => [
      {
        accessorKey: "redemption_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">
            {row.redemption_id.slice(0, 14)}
          </span>
        ),
        header: "Redemption ID",
        id: "redemption_id",
        isRowHeader: true,
        minWidth: 145,
      },
      {
        accessorKey: "tool_name",
        allowsSorting: true,
        cell: (row) => <span className="font-mono text-xs font-medium">{row.tool_name}</span>,
        header: "Tool",
        id: "tool_name",
        minWidth: 160,
      },
      {
        accessorKey: "receipt_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">{row.receipt_id.slice(0, 12)}</span>
        ),
        header: "Receipt",
        id: "receipt_id",
        minWidth: 125,
      },
      {
        accessorKey: "session_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">{row.session_id.slice(0, 12)}</span>
        ),
        header: "Session",
        id: "session_id",
        minWidth: 125,
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <Chip color={row.quote_id ? "accent" : "default"} size="sm" variant="soft">
            {row.quote_id ? `Quote ${row.quote_id.slice(0, 8)}` : "Direct"}
          </Chip>
        ),
        header: "MRTR Quote",
        id: "quote_id",
        minWidth: 135,
        sortFn: (a, b) => (a.quote_id ?? "").localeCompare(b.quote_id ?? ""),
      },
      {
        accessorKey: "created_at",
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatUtcTimestamp(row.created_at)}
          </span>
        ),
        header: "Redeemed (UTC)",
        id: "created_at",
        minWidth: 155,
      },
      {
        align: "end",
        cell: (row) => (
          <OrdersRowActions
            id={row.redemption_id}
            isSelected={activeGridKey === row.redemption_id}
            label={`D-${row.redemption_id.slice(0, 8)}`}
            record={row}
            onActionError={setActionError}
            onInspect={(payload) => handleSelectPayload(payload, row.redemption_id)}
          />
        ),
        header: "Actions",
        id: "actions",
        minWidth: 96,
      },
    ],
    [activeGridKey, handleSelectPayload],
  );

  const selectedReceiptRevokeReason = !activeInspected?.receipt
    ? undefined
    : !unlocked
      ? "Admin token required"
      : busy
        ? "Backend action in progress"
        : activeInspected.receipt.revoked
          ? "Receipt already revoked"
          : undefined;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      {/* Page Summary + Primary Commerce Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-sm text-pretty">
          Persisted capability bundles, catalog digests, session offers, MRTR quotes, Ed25519
          receipts, and redemptions.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex" title={putBundleReason ?? "Create or update a bundle"}>
            <Button
              isDisabled={Boolean(putBundleReason)}
              size="sm"
              variant="secondary"
              onPress={() => openDialog("put-bundle")}
            >
              Put Bundle
            </Button>
          </span>

          <span
            className="inline-flex"
            title={issueReceiptReason ?? "Issue an Ed25519 capability receipt"}
          >
            <Button
              isDisabled={Boolean(issueReceiptReason)}
              size="sm"
              variant="primary"
              onPress={() => openDialog("issue-receipt")}
            >
              Issue Receipt
            </Button>
          </span>
        </div>
      </div>

      {/* Real Persisted Commerce KPIs */}
      <KPIGroup>
        {kpiMetrics.map((metric, index) => (
          <Fragment key={metric.id}>
            {index > 0 ? <KPIGroup.Separator /> : null}
            <KPI>
              <KPI.Header>
                <KPI.Title>{metric.title}</KPI.Title>
              </KPI.Header>
              <KPI.Content>
                <KPI.Value
                  className="tabular-nums"
                  maximumFractionDigits={0}
                  value={metric.value}
                />
              </KPI.Content>
            </KPI>
          </Fragment>
        ))}
      </KPIGroup>

      {actionError ? (
        <div
          aria-live="assertive"
          className="border-danger/40 bg-danger/10 text-danger flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
          role="alert"
        >
          <span>{actionError}</span>
          <Button size="sm" variant="tertiary" onPress={() => setActionError(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {/* Unified Commerce Ledger + Payload Inspector Workbench */}
      <section
        aria-label="Commerce ledger and payload inspector"
        className="border-border bg-surface flex flex-col overflow-hidden rounded-2xl border"
      >
        {/* Fixed-Coordinate Segment, Search, and Status Filter Rail */}
        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <Segment
            aria-label="Commerce record segment"
            selectedKey={segment}
            size="sm"
            onSelectionChange={(key: Key) => {
              setSegment(String(key) as CommerceSegment);
              setStatusFilter("all");
              setSelectedRowKey(null);
            }}
          >
            <Segment.Item id="receipts">Receipts</Segment.Item>
            <Segment.Item id="bundles">Bundles &amp; Catalog</Segment.Item>
            <Segment.Item id="offers">Offers &amp; Quotes</Segment.Item>
            <Segment.Item id="redemptions">Redemptions</Segment.Item>
          </Segment>

          <div className="flex flex-wrap items-center gap-2">
            <SearchField
              aria-label="Search commerce records"
              className="w-full sm:w-[240px]"
              name="commerce-search"
              value={search}
              variant="secondary"
              onChange={setSearch}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search ID, bundle, subject..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <Dropdown>
              <Button aria-label="Filter commerce status" size="sm" variant="secondary">
                <Funnel aria-hidden="true" className="size-4" />
                {activeStatusLabel}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="Status filter options"
                  onAction={(key: Key) => setStatusFilter(String(key))}
                >
                  {statusOptions.map((opt) => (
                    <Dropdown.Item key={opt.id} id={opt.id} textValue={opt.label}>
                      <Label>{opt.label}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>

        {/* Split Master-Detail Body */}
        <div className="flex min-w-0 flex-col lg:flex-row">
          <div className="min-w-0 flex-1 p-3">
            {segment === "receipts" ? (
              <DataGrid
                aria-label="Capability receipts"
                className="[&_[aria-selected=true]]:shadow-none [&_[data-selected=true]]:shadow-none"
                columns={receiptColumns}
                contentClassName="min-w-[780px]"
                data={filteredReceipts}
                getRowId={(item) => item.receipt_id}
                selectedKeys={activeGridKey ? new Set([activeGridKey]) : new Set()}
                selectionBehavior="replace"
                selectionMode="single"
                onSelectionChange={handleGridSelectionChange}
                renderEmptyState={() => (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <span className="text-muted text-xs text-pretty">
                      {!unlocked
                        ? "Unlock with the admin token in the top bar to inspect capability receipts."
                        : search.trim() || effectiveStatus !== "all"
                          ? "No capability receipts match the active search or status filter."
                          : "No capability receipts have been issued in this runtime yet."}
                    </span>
                    {unlocked ? (
                      search.trim() || effectiveStatus !== "all" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            setSearch("");
                            setStatusFilter("all");
                          }}
                        >
                          Clear Filters
                        </Button>
                      ) : hasBundles ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => openDialog("issue-receipt")}
                        >
                          Issue Receipt
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => openDialog("put-bundle")}
                        >
                          Put Bundle
                        </Button>
                      )
                    ) : null}
                  </div>
                )}
              />
            ) : null}

            {segment === "bundles" ? (
              <DataGrid
                aria-label="Bundles and catalog items"
                className="[&_[aria-selected=true]]:shadow-none [&_[data-selected=true]]:shadow-none"
                columns={bundleCatalogColumns}
                contentClassName="min-w-[760px]"
                data={filteredBundlesAndCatalog}
                getRowId={(item) => item.rowKey}
                selectedKeys={activeGridKey ? new Set([activeGridKey]) : new Set()}
                selectionBehavior="replace"
                selectionMode="single"
                onSelectionChange={handleGridSelectionChange}
                renderEmptyState={() => (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <span className="text-muted text-xs text-pretty">
                      {!unlocked
                        ? "Unlock with the admin token in the top bar to inspect bundles and catalog items."
                        : search.trim() || effectiveStatus !== "all"
                          ? "No bundles or catalog items match the active filter."
                          : "No capability bundles configured yet."}
                    </span>
                    {unlocked ? (
                      search.trim() || effectiveStatus !== "all" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            setSearch("");
                            setStatusFilter("all");
                          }}
                        >
                          Clear Filters
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => openDialog("put-bundle")}
                        >
                          Put Bundle
                        </Button>
                      )
                    ) : null}
                  </div>
                )}
              />
            ) : null}

            {segment === "offers" ? (
              <DataGrid
                aria-label="Session offers and MRTR quotes"
                className="[&_[aria-selected=true]]:shadow-none [&_[data-selected=true]]:shadow-none"
                columns={offerQuoteColumns}
                contentClassName="min-w-[760px]"
                data={filteredOffersAndQuotes}
                getRowId={(item) => item.rowKey}
                selectedKeys={activeGridKey ? new Set([activeGridKey]) : new Set()}
                selectionBehavior="replace"
                selectionMode="single"
                onSelectionChange={handleGridSelectionChange}
                renderEmptyState={() => (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <span className="text-muted text-xs text-pretty">
                      {!unlocked
                        ? "Unlock with the admin token in the top bar to inspect offers and MRTR quotes."
                        : search.trim() || effectiveStatus !== "all"
                          ? "No session offers or MRTR quotes match the active filter."
                          : "No session offers or MRTR quotes persisted yet."}
                    </span>
                    {unlocked ? (
                      search.trim() || effectiveStatus !== "all" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            setSearch("");
                            setStatusFilter("all");
                          }}
                        >
                          Clear Filters
                        </Button>
                      ) : !synthesizeReason && selectedSessionId ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            void mutate("/offers/synthesize", {session_id: selectedSessionId}).catch(
                              (err: unknown) =>
                                setActionError(
                                  err instanceof Error ? err.message : "Failed to synthesize offer.",
                                ),
                            );
                          }}
                        >
                          Synthesize Offer
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => openDialog("put-bundle")}
                        >
                          Put Bundle
                        </Button>
                      )
                    ) : null}
                  </div>
                )}
              />
            ) : null}

            {segment === "redemptions" ? (
              <DataGrid
                aria-label="Receipt redemptions"
                className="[&_[aria-selected=true]]:shadow-none [&_[data-selected=true]]:shadow-none"
                columns={redemptionColumns}
                contentClassName="min-w-[760px]"
                data={filteredRedemptions}
                getRowId={(item) => item.redemption_id}
                selectedKeys={activeGridKey ? new Set([activeGridKey]) : new Set()}
                selectionBehavior="replace"
                selectionMode="single"
                onSelectionChange={handleGridSelectionChange}
                renderEmptyState={() => (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <span className="text-muted text-xs text-pretty">
                      {!unlocked
                        ? "Unlock with the admin token in the top bar to inspect receipt redemptions."
                        : search.trim() || effectiveStatus !== "all"
                          ? "No receipt redemptions match the active filter."
                          : "No capability receipt redemptions recorded yet."}
                    </span>
                    {unlocked && (search.trim() || effectiveStatus !== "all") ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          setSearch("");
                          setStatusFilter("all");
                        }}
                      >
                        Clear Filters
                      </Button>
                    ) : unlocked && hasBundles ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => openDialog("issue-receipt")}
                      >
                        Issue Receipt
                      </Button>
                    ) : null}
                  </div>
                )}
              />
            ) : null}
          </div>

          {/* Draggable Split-Pane Resize Handle */}
          <div
            aria-label="Resize payload inspector"
            aria-orientation="vertical"
            aria-valuemax={MAX_INSPECTOR_WIDTH}
            aria-valuemin={MIN_INSPECTOR_WIDTH}
            aria-valuenow={inspectorWidth}
            className="bg-border/60 hover:bg-accent/50 hidden min-h-[360px] w-1.5 shrink-0 select-none lg:block"
            role="separator"
            style={{cursor: "ew-resize", touchAction: "none"}}
            tabIndex={0}
            onDoubleClick={() => setInspectorWidth(DEFAULT_INSPECTOR_WIDTH)}
            onKeyDown={handleResizeKeyDown}
            onMouseDown={handleResizeMouseDown}
          />

          {/* Right Persisted Payload Inspector */}
          <aside
            ref={inspectorRef}
            aria-label="Selected commerce payload"
            className="border-border flex w-full shrink-0 flex-col gap-3 border-t p-3 lg:w-[var(--inspector-w)] lg:border-t-0"
            style={{"--inspector-w": `${inspectorWidth}px`} as CSSProperties}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-foreground text-sm font-semibold text-balance">
                Payload Inspector
              </h2>
              {activeInspected ? (
                <div className="flex items-center gap-1">
                  <IconButton
                    label={`Copy ID ${activeInspected.id.slice(0, 8)}`}
                    size="sm"
                    tooltip={copiedKey === "id" ? "Copied ID" : "Copy ID"}
                    variant="tertiary"
                    onPress={() => void copyText("id", activeInspected.id)}
                  >
                    {copiedKey === "id" ? (
                      <CircleCheck aria-hidden="true" className="text-success size-4" />
                    ) : (
                      <Copy aria-hidden="true" className="size-4" />
                    )}
                  </IconButton>

                  {activeInspected.receipt ? (
                    <span
                      className="inline-flex"
                      title={selectedReceiptRevokeReason ?? "Revoke capability receipt"}
                    >
                      <IconButton
                        isDisabled={Boolean(selectedReceiptRevokeReason)}
                        label={`Revoke inspected receipt ${activeInspected.receipt.receipt_id.slice(0, 8)}`}
                        size="sm"
                        tooltip={selectedReceiptRevokeReason ?? "Revoke capability receipt"}
                        variant="danger-soft"
                        onPress={() => {
                          const targetReceipt = activeInspected.receipt;

                          if (!targetReceipt) return;
                          setActionError(null);
                          void mutate("/receipts/revoke", {
                            receipt_id: targetReceipt.receipt_id,
                          }).catch((err: unknown) =>
                            setActionError(
                              err instanceof Error ? err.message : "Failed to revoke receipt.",
                            ),
                          );
                        }}
                      >
                        <TrashBin aria-hidden="true" className="size-4" />
                      </IconButton>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            {activeInspected ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-accent truncate font-mono text-xs font-medium tabular-nums">
                    {activeInspected.label}
                  </span>
                  {activeInspected.receipt ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() =>
                        void copyText(
                          "token",
                          encodeSignedReceiptToken(activeInspected.receipt!),
                        )
                      }
                    >
                      {copiedKey === "token" ? "Copied Token" : "Copy Signed Receipt"}
                    </Button>
                  ) : null}
                </div>

                {activeInspected.receipt ? (
                  <dl className="border-border bg-background grid grid-cols-[96px_1fr] gap-x-2 gap-y-1 rounded-lg border p-2.5 text-xs">
                    <dt className="text-muted">Verification</dt>
                    <dd className="font-medium">
                      {activeInspected.receipt.signature_verified
                        ? "Ed25519 verified"
                        : "Invalid signature"}
                    </dd>
                    <dt className="text-muted">Quota</dt>
                    <dd className="font-mono tabular-nums">
                      {activeInspected.receipt.remaining_calls} /{" "}
                      {activeInspected.receipt.max_calls}
                    </dd>
                    <dt className="text-muted">Revoked</dt>
                    <dd className="font-mono">{activeInspected.receipt.revoked ? "yes" : "no"}</dd>
                  </dl>
                ) : null}

                <pre className="border-border bg-background max-h-[420px] flex-1 overflow-auto rounded-lg border p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                  {JSON.stringify(activeInspected.record, null, 2)}
                </pre>
              </>
            ) : (
              <p className="text-muted text-xs text-pretty">
                {unlocked
                  ? "Select a commerce row to inspect its exact persisted SQLite JSON payload."
                  : "Unlock with the admin token to inspect persisted commerce records."}
              </p>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
