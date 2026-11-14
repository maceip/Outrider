"use client";

import {ArrowDownToLine, Book, CurlyBracketsLock} from "@gravity-ui/icons";
import {Accordion, Card, Link} from "@heroui/react";

import {useOutrider} from "../lib/outrider-store";

const PROTOCOL_ITEMS = [
  {
    body: "Outrider mediates MCP 2026-07-28 multi-round-trip (MRTR) quotes and input-required capability probes without heuristic client-side scoring.",
    id: "mcp-2026",
    title: "MCP 2026-07-28 & MRTR Quotes",
  },
  {
    body: "Capability receipts are signed over RFC 8785 canonical JSON (JCS) with the gateway's Ed25519 signing key and verified atomically before quota redemption.",
    id: "ed25519-receipts",
    title: "Ed25519 Capability Receipts",
  },
  {
    body: "CLEF runs schema-constrained LiteRT-LM evaluations over persisted session handshakes and probe runs. Option probability distributions are null on litert-lm-rust 0.2.4.",
    id: "clef-litert",
    title: "CLEF Constrained Decoding",
  },
] as const;

export function HelpPage() {
  const {snapshot} = useOutrider();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm text-pretty">
        Download the proxy root CA certificate and review Outrider protocol invariants.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="rounded-2xl">
          <Card.Header>
            <div className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-xl">
              <ArrowDownToLine aria-hidden="true" className="size-5" />
            </div>
            <Card.Title className="text-base text-balance">Proxy Root CA Certificate</Card.Title>
            <Card.Description>
              Download the generated root CA certificate to inspect TLS traffic through Outrider.
            </Card.Description>
          </Card.Header>
          <Card.Footer>
            <Link
              className="text-accent inline-flex items-center gap-1 text-sm"
              href="/__proxyfor__/certificate/ca.crt"
            >
              Download ca.crt
            </Link>
          </Card.Footer>
        </Card>

        <Card className="rounded-2xl">
          <Card.Header>
            <div className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-xl">
              <CurlyBracketsLock aria-hidden="true" className="size-5" />
            </div>
            <Card.Title className="text-base text-balance">Ed25519 Verifying Key</Card.Title>
            <Card.Description className="break-all font-mono text-xs">
              {snapshot?.public_key ?? "Unlock with admin token to read verifying key."}
            </Card.Description>
          </Card.Header>
        </Card>

        <Card className="rounded-2xl">
          <Card.Header>
            <div className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-xl">
              <Book aria-hidden="true" className="size-5" />
            </div>
            <Card.Title className="text-base text-balance">Commerce Status API</Card.Title>
            <Card.Description>
              Inspect unauthenticated gateway readiness at /__proxyfor__/commerce/status.
            </Card.Description>
          </Card.Header>
          <Card.Footer>
            <Link
              className="text-accent inline-flex items-center gap-1 font-mono text-xs"
              href="/__proxyfor__/commerce/status"
            >
              /__proxyfor__/commerce/status
            </Link>
          </Card.Footer>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-foreground text-base font-semibold text-balance">
          Protocol Reference
        </h2>
        <Accordion className="w-full">
          {PROTOCOL_ITEMS.map((item) => (
            <Accordion.Item key={item.id} id={item.id}>
              <Accordion.Heading>
                <Accordion.Trigger>
                  {item.title}
                  <Accordion.Indicator />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="text-muted text-sm text-pretty">
                  {item.body}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </section>
    </div>
  );
}
