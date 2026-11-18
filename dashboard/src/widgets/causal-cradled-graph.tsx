"use client";

import type {
  CommercialOffer,
  InterceptionDraft,
  InterceptionEvent,
} from "../lib/interceptor-types";

import {ScrollShadow} from "@heroui/react";
import {useMemo} from "react";

import {formatMoneyCompact} from "../lib/interceptor-types";

export interface CausalCradledGraphProps {
  events: InterceptionEvent[];
  offers: CommercialOffer[];
  draft: InterceptionDraft | null;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}

const NODE_W = 116;
const COL_GAP = 10;
const PAD_X = 8;
const SPINE_TOP = 8;
const SPINE_H = 54;
const SPINE_CY = SPINE_TOP + SPINE_H / 2;
const CRADLE_TOP = 86;

function nodeX(index: number): number {
  return PAD_X + index * (NODE_W + COL_GAP);
}

function nodeCenterX(index: number): number {
  return nodeX(index) + NODE_W / 2;
}

function formatSpineStatus(event: InterceptionEvent): string {
  if (event.hold_state === "held" || event.epistemic_kind === "held") {
    return "HELD";
  }
  if (event.epistemic_kind === "pending") {
    return "PENDING";
  }
  if (event.status_code !== null) {
    return String(event.status_code);
  }

  return event.status_label || "OK";
}

export function CausalCradledGraph({
  draft,
  events,
  offers,
  onSelectEvent,
  selectedEventId,
}: CausalCradledGraphProps) {
  const spineEvents = useMemo(
    () => [...events].sort((a, b) => a.seq - b.seq),
    [events],
  );

  const regularOffers = useMemo(
    () =>
      offers.filter(
        (offer) => !offer.is_draft && offer.offer_id !== draft?.promo_offer_id,
      ),
    [draft?.promo_offer_id, offers],
  );

  const promoOffer = useMemo(
    () =>
      offers.find(
        (offer) =>
          (draft ? offer.offer_id === draft.promo_offer_id : false) || offer.is_draft,
      ) ?? null,
    [draft, offers],
  );

  const showPromoLane = Boolean(
    promoOffer && (promoOffer.committed || (draft && draft.enabled && draft.delivery_state !== "discarded")),
  );

  const c02Index = useMemo(() => {
    const explicitIdx = spineEvents.findIndex(
      (ev) => ev.event_id === "C02" || ev.event_name === "get_offers",
    );

    if (explicitIdx >= 0) return explicitIdx;
    const parentId = regularOffers[0]?.parent_event_id;

    if (parentId) {
      const parentIdx = spineEvents.findIndex((ev) => ev.event_id === parentId);

      if (parentIdx >= 0) return parentIdx;
    }

    return Math.min(1, Math.max(0, spineEvents.length - 1));
  }, [regularOffers, spineEvents]);

  const r02Index = useMemo(() => {
    const targetId = draft?.target_event_id ?? "R02";
    const idx = spineEvents.findIndex(
      (ev) => ev.event_id === targetId || ev.event_name === "return_offers",
    );

    if (idx >= 0) return idx;

    return Math.min(2, Math.max(0, spineEvents.length - 1));
  }, [draft?.target_event_id, spineEvents]);

  const c03Index = useMemo(() => {
    const idx = spineEvents.findIndex(
      (ev) => ev.event_id === "C03" || ev.event_name === "select_product",
    );

    return idx >= 0 ? idx : Math.min(r02Index + 1, Math.max(0, spineEvents.length - 1));
  }, [r02Index, spineEvents]);

  const canvasWidth = Math.max(
    620,
    PAD_X * 2 +
      spineEvents.length * NODE_W +
      Math.max(0, spineEvents.length - 1) * COL_GAP,
  );

  const hasAnyCradle = regularOffers.length > 0 || showPromoLane;
  const canvasHeight = hasAnyCradle ? 166 : 72;

  const sellerCradleWidth = 188;
  const sellerCradleLeft = Math.max(
    PAD_X,
    Math.min(
      canvasWidth - sellerCradleWidth - PAD_X,
      Math.round(nodeCenterX(c02Index) - sellerCradleWidth / 2),
    ),
  );
  const sellerCradleCenterX = sellerCradleLeft + sellerCradleWidth / 2;

  const proxyLaneWidth = 228;
  const proxyLaneLeft = Math.max(
    regularOffers.length > 0 ? sellerCradleLeft + sellerCradleWidth + 14 : PAD_X,
    Math.min(
      canvasWidth - proxyLaneWidth - PAD_X,
      Math.round(nodeX(r02Index) - 8),
    ),
  );
  const proxyLaneCenterX = proxyLaneLeft + proxyLaneWidth / 2;

  if (spineEvents.length === 0) {
    return null;
  }

  const c02EventId = spineEvents[c02Index]?.event_id ?? spineEvents[0].event_id;
  const r02EventId = spineEvents[r02Index]?.event_id ?? spineEvents[0].event_id;
  const isPromoCommitted = Boolean(promoOffer?.committed || draft?.delivery_state === "committed");

  return (
    <div
      aria-label="Causal execution graph"
      className="border-border bg-surface rounded-lg border px-2.5 py-2"
      data-slot="causal-cradled-graph"
      role="region"
    >
      <ScrollShadow className="w-full overflow-x-auto" orientation="horizontal">
        <div
          className="relative select-none"
          style={{height: `${canvasHeight}px`, minWidth: `${canvasWidth}px`, width: "100%"}}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
          >
            <defs>
              <marker
                id="conduit-arrow-solid"
                markerHeight="6"
                markerWidth="6"
                orient="auto-start-reverse"
                refX="5"
                refY="3"
              >
                <path d="M 0 0.5 L 5.5 3 L 0 5.5 z" fill="var(--border-tertiary)" />
              </marker>
              <marker
                id="conduit-arrow-warning"
                markerHeight="6"
                markerWidth="6"
                orient="auto-start-reverse"
                refX="5"
                refY="3"
              >
                <path d="M 0 0.5 L 5.5 3 L 0 5.5 z" fill="var(--warning)" />
              </marker>
              <marker
                id="conduit-arrow-muted"
                markerHeight="6"
                markerWidth="6"
                orient="auto-start-reverse"
                refX="5"
                refY="3"
              >
                <path d="M 0 0.5 L 5.5 3 L 0 5.5 z" fill="var(--muted)" />
              </marker>
            </defs>

            {spineEvents.slice(0, -1).map((ev, idx) => {
              const nextEv = spineEvents[idx + 1];
              const x1 = nodeX(idx) + NODE_W + 2;
              const x2 = nodeX(idx + 1) - 3;
              const isHeldEdge =
                ev.hold_state === "held" ||
                nextEv.hold_state === "held" ||
                ev.epistemic_kind === "held";
              const isPendingEdge =
                ev.epistemic_kind === "pending" || nextEv.epistemic_kind === "pending";

              return (
                <line
                  key={`${ev.event_id}-${nextEv.event_id}`}
                  markerEnd={
                    isHeldEdge
                      ? "url(#conduit-arrow-warning)"
                      : isPendingEdge
                        ? "url(#conduit-arrow-muted)"
                        : "url(#conduit-arrow-solid)"
                  }
                  stroke={
                    isHeldEdge
                      ? "var(--warning)"
                      : isPendingEdge
                        ? "var(--border-secondary)"
                        : "var(--border-tertiary)"
                  }
                  strokeDasharray={isPendingEdge ? "4 3" : undefined}
                  strokeWidth={isHeldEdge ? 1.5 : 1.25}
                  x1={x1}
                  x2={x2}
                  y1={SPINE_CY}
                  y2={SPINE_CY}
                />
              );
            })}

            {regularOffers.length > 0 ? (
              <>
                <path
                  d={`M ${nodeCenterX(c02Index)} ${SPINE_TOP + SPINE_H} C ${nodeCenterX(c02Index)} ${CRADLE_TOP - 8}, ${sellerCradleCenterX} ${SPINE_TOP + SPINE_H + 8}, ${sellerCradleCenterX} ${CRADLE_TOP}`}
                  fill="none"
                  stroke="var(--border-tertiary)"
                  strokeWidth="1.2"
                />
                {r02Index !== c02Index ? (
                  <path
                    d={`M ${sellerCradleLeft + sellerCradleWidth - 18} ${CRADLE_TOP} C ${sellerCradleLeft + sellerCradleWidth - 8} ${CRADLE_TOP - 14}, ${nodeCenterX(r02Index) - 16} ${SPINE_TOP + SPINE_H + 14}, ${nodeCenterX(r02Index) - 14} ${SPINE_TOP + SPINE_H + 2}`}
                    fill="none"
                    markerEnd="url(#conduit-arrow-solid)"
                    stroke="var(--border-secondary)"
                    strokeWidth="1.15"
                  />
                ) : null}
              </>
            ) : null}

            {showPromoLane ? (
              <>
                <path
                  d={`M ${nodeCenterX(r02Index)} ${SPINE_TOP + SPINE_H} C ${nodeCenterX(r02Index)} ${CRADLE_TOP - 8}, ${proxyLaneCenterX - 24} ${SPINE_TOP + SPINE_H + 8}, ${proxyLaneCenterX - 24} ${CRADLE_TOP}`}
                  fill="none"
                  stroke={isPromoCommitted ? "var(--success)" : "var(--warning)"}
                  strokeDasharray={isPromoCommitted ? undefined : "4 3"}
                  strokeWidth="1.35"
                />
                {c03Index > r02Index ? (
                  <path
                    d={`M ${proxyLaneCenterX + 34} ${CRADLE_TOP} C ${proxyLaneCenterX + 42} ${CRADLE_TOP - 14}, ${nodeCenterX(c03Index)} ${SPINE_TOP + SPINE_H + 14}, ${nodeCenterX(c03Index)} ${SPINE_TOP + SPINE_H + 2}`}
                    fill="none"
                    markerEnd={
                      isPromoCommitted
                        ? "url(#conduit-arrow-solid)"
                        : "url(#conduit-arrow-warning)"
                    }
                    stroke={isPromoCommitted ? "var(--success)" : "var(--warning)"}
                    strokeDasharray={isPromoCommitted ? undefined : "4 3"}
                    strokeWidth="1.2"
                  />
                ) : null}
              </>
            ) : null}
          </svg>

          {spineEvents.map((ev, idx) => {
            const isSelected = selectedEventId === ev.event_id;
            const isHeld = ev.hold_state === "held" || ev.epistemic_kind === "held";
            const isPending = ev.epistemic_kind === "pending";
            const statusText = formatSpineStatus(ev);

            let surfaceClasses = "border border-border bg-surface text-foreground hover:bg-surface-hover";

            if (isHeld) {
              surfaceClasses =
                "border border-warning/50 bg-warning-soft text-foreground hover:bg-warning-soft-hover";
            } else if (isPending) {
              surfaceClasses = isSelected
                ? "border border-dashed border-border-tertiary bg-surface-secondary text-foreground"
                : "border border-dashed border-border bg-surface-secondary/40 text-muted opacity-75 hover:opacity-100";
            } else if (isSelected) {
              surfaceClasses =
                "border border-accent bg-accent-soft text-foreground hover:bg-accent-soft-hover";
            }

            const ringClass =
              isSelected && isHeld ? "ring-1 ring-warning/60" : "";

            return (
              <button
                key={ev.event_id}
                aria-label={`${ev.event_id} ${ev.event_name} (${statusText})`}
                aria-pressed={isSelected}
                className={`absolute flex flex-col justify-between rounded-lg px-2 py-1.5 text-left cursor-[var(--cursor-interactive)] ${surfaceClasses} ${ringClass}`}
                data-slot="graph-node"
                style={{
                  height: `${SPINE_H}px`,
                  left: `${nodeX(idx)}px`,
                  top: `${SPINE_TOP}px`,
                  width: `${NODE_W}px`,
                }}
                title={`${ev.event_id} · ${ev.event_name} — ${ev.observation}`}
                type="button"
                onClick={() => onSelectEvent(ev.event_id)}
              >
                <div className="flex w-full items-center justify-between gap-1">
                  <span className="font-mono text-[11px] font-semibold tabular-nums">
                    {ev.event_id}
                  </span>
                  <span
                    className={`font-mono text-[10px] font-medium tabular-nums ${
                      isHeld
                        ? "text-warning-soft-foreground"
                        : isPending
                          ? "text-muted"
                          : "text-success"
                    }`}
                  >
                    {statusText}
                  </span>
                </div>
                <span className="w-full truncate font-mono text-[11px] leading-tight">
                  {ev.event_name}
                </span>
              </button>
            );
          })}

          {regularOffers.length > 0 ? (
            <div
              className="border-border bg-surface-secondary/60 absolute flex flex-col gap-1 rounded-lg border px-2 py-1.5"
              style={{
                left: `${sellerCradleLeft}px`,
                top: `${CRADLE_TOP}px`,
                width: `${sellerCradleWidth}px`,
              }}
            >
              <span className="text-muted font-mono text-[10px] font-medium">
                Seller offers
              </span>
              <div className="flex items-center gap-1.5">
                {regularOffers.map((offer) => (
                  <button
                    key={offer.offer_id}
                    className="border-border bg-surface text-foreground hover:bg-surface-hover flex min-w-0 flex-1 items-center justify-between gap-1 rounded-md border px-1.5 py-1 font-mono text-[11px] tabular-nums cursor-[var(--cursor-interactive)]"
                    data-slot="graph-node"
                    title={`${offer.offer_id} · ${offer.sku_title} (${formatMoneyCompact(offer.price_cents, offer.currency)})`}
                    type="button"
                    onClick={() => onSelectEvent(offer.parent_event_id || c02EventId)}
                  >
                    <span className="font-semibold">{offer.offer_id}</span>
                    <span className="text-muted">
                      {formatMoneyCompact(offer.price_cents, offer.currency)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {showPromoLane && promoOffer ? (
            <div
              className={`absolute flex flex-col gap-1 rounded-lg px-2.5 py-1.5 ${
                isPromoCommitted
                  ? "border border-success/50 bg-success-soft"
                  : "border border-dashed border-warning/60 bg-warning-soft"
              }`}
              style={{
                left: `${proxyLaneLeft}px`,
                top: `${CRADLE_TOP}px`,
                width: `${proxyLaneWidth}px`,
              }}
            >
              <span
                className={`font-mono text-[10px] font-medium ${
                  isPromoCommitted
                    ? "text-success-soft-foreground"
                    : "text-warning-soft-foreground"
                }`}
              >
                {isPromoCommitted ? "Proxy Lane · Committed" : "Proxy Lane"}
              </span>
              <button
                className={`flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] tabular-nums cursor-[var(--cursor-interactive)] ${
                  isPromoCommitted
                    ? "border border-success/40 bg-surface text-foreground"
                    : "border border-dashed border-warning/50 bg-surface/90 text-foreground"
                }`}
                data-slot="graph-node"
                type="button"
                onClick={() => onSelectEvent(r02EventId)}
              >
                <span className="truncate font-semibold">
                  {`${promoOffer.offer_id} ${
                    promoOffer.is_draft && !isPromoCommitted
                      ? promoOffer.label || "Offer C (draft)"
                      : promoOffer.label.replace(/\s*\(draft\)/i, "") || "Offer C"
                  }`}
                </span>
                <span className="shrink-0 font-semibold">
                  {formatMoneyCompact(promoOffer.price_cents, promoOffer.currency)}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </ScrollShadow>
    </div>
  );
}
