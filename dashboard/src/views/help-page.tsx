"use client";

import {
  ArrowDownToLine,
  ArrowRightFromSquare,
  Book,
  CircleCheck,
  Copy,
  CurlyBracketsLock,
} from "@gravity-ui/icons";
import {Accordion, Card} from "@heroui/react";
import {useState} from "react";

import {IconButton} from "../components/icon-button";
import {useOutrider} from "../lib/outrider-store";
import {formatClefState} from "../lib/types";

const PROTOCOL_ACCORDION_ITEMS = [
  {
    body: "Outrider speaks MCP protocol revision 2026-07-28 alongside legacy initialize handshakes on /mcp. Multi-round-trip (MRTR) quotes bind a session subject, bundle_id, and SHA-256 catalog item digests to a single-use quote_id with a Unix expiry, while authenticated RequestStateCodec tokens carry input_required capability probes and elicitation continuations without unverified client state.",
    id: "mcp-2026-mrtr",
    title: "MCP 2026-07-28 & Multi-Round-Trip (MRTR) Quotes",
  },
  {
    body: "Capability receipts ({receipt_id, subject, bundle_id, item_digests, max_calls, expires_at_unix}) are canonicalized with RFC 8785 JSON Canonicalization Scheme (JCS) and signed with the gateway's Ed25519 key (outrider-ed25519.pem), then encoded as URL-safe unpadded Base64 tokens. On tool invocation, Outrider verifies the Ed25519 signature strictly, checks bundle digest integrity and non-revocation, and decrements remaining_calls inside an atomic SQLite IMMEDIATE transaction.",
    id: "ed25519-jcs-receipts",
    title: "Ed25519 Capability Receipts & RFC 8785 JCS Verification",
  },
  {
    body: "CLEF evaluates persisted session handshakes and active probe runs through LiteRT-LM (litert-lm-rust 0.2.4) using JSON-schema constrained decoding across three question kinds: noul (boolean), choice (finite string options), and score (bounded integer min..max). Every evaluation records exact pick, input_tokens, output_tokens, latency_ms, and backend; option_scores is explicitly null because litert-lm-rust 0.2.4 does not expose option probability distributions.",
    id: "clef-constrained-decoding",
    title: "CLEF Constrained Decoding & litert-lm-rust 0.2.4 Invariants",
  },
  {
    body: "On inbound proxy and gateway sockets, Outrider passively records TLS ClientHello bytes (client_hello), negotiated TLS parameters (negotiated_tls), raw HTTP header ordering (http_header_order), and MCP client capability configurations (mcp_request) in fingerprint_observations. Active sampling probes follow the operator's probe_policy (off, on-request, or auto) and store measured latency and structural compliance in probe_runs.",
    id: "fingerprints-and-probes",
    title: "Passive TLS / HTTP Fingerprinting & Active Probe Policy",
  },
  {
    body: "To inspect HTTPS traffic through Outrider, install the generated root CA in your platform trust store: on macOS run `sudo security add-trusted-cert -d -p ssl -p basic -k /Library/Keychains/System.keychain proxyfor-ca-cert.pem`; on Ubuntu/Debian copy proxyfor-ca-cert.pem to `/usr/local/share/ca-certificates/proxyfor.crt` and run `sudo update-ca-certificates`; on Windows run `certutil.exe -addstore root proxyfor-ca-cert.cer`. Full step-by-step instructions for macOS, Linux, Windows, iOS, Android, and Firefox are served at `/__proxyfor__/certificate/`.",
    id: "ca-trust-installation",
    title: "Root CA Certificate Trust Store Installation",
  },
] as const;

export function HelpPage() {
  const {clefStatus, publicStatus, snapshot} = useOutrider();
  const [copiedKey, setCopiedKey] = useState(false);

  const observedPolicy = snapshot?.probe_policy ?? publicStatus?.probe_policy ?? null;
  const observedClef = clefStatus ? formatClefState(clefStatus) : "—";
  const observedRemote =
    publicStatus === null ? "—" : String(publicStatus.admin_allow_remote);

  const handleCopyKey = async () => {
    if (!snapshot?.public_key) return;
    try {
      await navigator.clipboard.writeText(snapshot.public_key);
      setCopiedKey(true);
      window.setTimeout(() => setCopiedKey(false), 1800);
    } catch {
      setCopiedKey(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 pb-10 pt-4">
      <p className="text-muted text-sm text-pretty">
        Download the generated Outrider TLS root CA certificate, open the platform installation
        guide, inspect public gateway readiness, and review MCP commerce protocol invariants.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="rounded-2xl">
          <Card.Header>
            <div className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-xl">
              <ArrowDownToLine aria-hidden="true" className="size-5" />
            </div>
            <Card.Title className="text-base text-balance">Proxy Root CA Certificates</Card.Title>
            <Card.Description className="text-pretty">
              Download the generated X.509 root CA in PEM (macOS, Linux, iOS, Firefox) or CER
              (Windows, Android) format, or open the platform trust guide.
            </Card.Description>
          </Card.Header>
          <Card.Footer className="flex flex-col items-start gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <a
                className="text-accent inline-flex items-center gap-1 font-mono text-xs hover:underline"
                download="proxyfor-ca-cert.pem"
                href="/__proxyfor__/certificate/proxyfor-ca-cert.pem"
              >
                proxyfor-ca-cert.pem
                <ArrowDownToLine aria-hidden="true" className="size-3.5" />
              </a>
              <a
                className="text-accent inline-flex items-center gap-1 font-mono text-xs hover:underline"
                download="proxyfor-ca-cert.cer"
                href="/__proxyfor__/certificate/proxyfor-ca-cert.cer"
              >
                proxyfor-ca-cert.cer
                <ArrowDownToLine aria-hidden="true" className="size-3.5" />
              </a>
            </div>
            <a
              className="text-muted hover:text-foreground inline-flex items-center gap-1 text-xs hover:underline"
              href="/__proxyfor__/certificate/"
              rel="noreferrer"
              target="_blank"
            >
              Certificate install guide (/__proxyfor__/certificate/)
              <ArrowRightFromSquare aria-hidden="true" className="size-3.5" />
            </a>
          </Card.Footer>
        </Card>

        <Card className="rounded-2xl">
          <Card.Header>
            <div className="flex w-full items-start justify-between gap-2">
              <div className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-xl">
                <CurlyBracketsLock aria-hidden="true" className="size-5" />
              </div>
              <IconButton
                isDisabled={!snapshot?.public_key}
                label={copiedKey ? "Copied Ed25519 verifying key" : "Copy Ed25519 verifying key"}
                size="sm"
                tooltip={
                  !snapshot?.public_key
                    ? "Unlock with admin token to copy verifying key"
                    : copiedKey
                      ? "Copied to clipboard"
                      : "Copy Ed25519 verifying key"
                }
                variant="tertiary"
                onPress={() => void handleCopyKey()}
              >
                {copiedKey ? (
                  <CircleCheck aria-hidden="true" className="text-success size-4" />
                ) : (
                  <Copy aria-hidden="true" className="size-4" />
                )}
              </IconButton>
            </div>
            <Card.Title className="text-base text-balance">Ed25519 Verifying Key</Card.Title>
            <Card.Description className="break-all font-mono text-xs">
              {snapshot?.public_key ??
                "Unlock with the admin bearer token above to read the Base64URL Ed25519 public key."}
            </Card.Description>
          </Card.Header>
          <Card.Footer>
            <span className="text-muted font-mono text-xs">
              RFC 8785 JCS · Base64URL (no padding)
            </span>
          </Card.Footer>
        </Card>

        <Card className="rounded-2xl">
          <Card.Header>
            <div className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-xl">
              <Book aria-hidden="true" className="size-5" />
            </div>
            <Card.Title className="text-base text-balance">Commerce Status Endpoint</Card.Title>
            <Card.Description className="text-pretty">
              Unauthenticated JSON probe reporting CLEF engine readiness, active probe policy, and
              remote admin boundary.
            </Card.Description>
          </Card.Header>
          <Card.Footer className="flex flex-col items-start gap-1.5">
            <span className="text-muted font-mono text-xs">
              {observedClef} · policy={observedPolicy ?? "—"} · remote={observedRemote}
            </span>
            <a
              className="text-accent inline-flex items-center gap-1 font-mono text-xs hover:underline"
              href="/__proxyfor__/commerce/status"
              rel="noreferrer"
              target="_blank"
            >
              /__proxyfor__/commerce/status
              <ArrowRightFromSquare aria-hidden="true" className="size-3.5" />
            </a>
          </Card.Footer>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-foreground text-base font-semibold text-balance">
          Protocol & Cryptographic Reference
        </h2>
        <Accordion className="w-full" defaultExpandedKeys={["mcp-2026-mrtr"]}>
          {PROTOCOL_ACCORDION_ITEMS.map((item) => (
            <Accordion.Item key={item.id} id={item.id}>
              <Accordion.Heading>
                <Accordion.Trigger>
                  {item.title}
                  <Accordion.Indicator />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="text-muted text-sm leading-relaxed text-pretty">
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
