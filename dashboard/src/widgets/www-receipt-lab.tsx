"use client";

import type {CapabilityReceiptPayload} from "../lib/types";

import {Button, Card, Chip, Label, TextArea, toast} from "@heroui/react";
import {CodeBlock} from "@heroui-pro/react/code-block";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

export interface WwwReceiptLabProps {
  initialPayload?: CapabilityReceiptPayload | null;
  initialPublicKey?: string | null;
  initialSignature?: string | null;
}

type VerificationState = "idle" | "valid" | "invalid" | "unsupported";
type KeySource = "recorded-gateway" | "webcrypto-ephemeral";

function createFreshBrowserPayload(): CapabilityReceiptPayload {
  const randomId =
    typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `receipt-${Date.now()}`;
  const nowUnix = Math.floor(Date.now() / 1_000);

  return {
    bundle_id: "outrider_session_evidence",
    expires_at_unix: nowUnix + 86_400 * 30,
    item_digests: [],
    max_calls: 10,
    receipt_id: randomId,
    subject: `webcrypto:${randomId}`,
  };
}

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 * Matches `serde_jcs::to_vec` in `proxyfor/src/commerce/receipt.rs`.
 */
export function canonicalizeJcs(value: unknown): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("RFC 8785 JCS forbids NaN and Infinity");
    }
    if (Object.is(value, -0)) {
      return "0";
    }

    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const serializedItems = value.map((item) =>
      canonicalizeJcs(item === undefined ? null : item),
    );

    return `[${serializedItems.join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const members = sortedKeys.map(
      (key) => `${JSON.stringify(key)}:${canonicalizeJcs(record[key])}`,
    );

    return `{${members.join(",")}}`;
  }

  throw new TypeError(`Unsupported JSON value type: ${typeof value}`);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  const padded = remainder === 0 ? normalized : normalized + "=".repeat(4 - remainder);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function toArrayBufferBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(input.byteLength);
  const copy = new Uint8Array(buffer);

  copy.set(input);

  return copy;
}

async function verifyEd25519Jcs(
  payloadJsonText: string,
  publicKeyB64Url: string,
  signatureB64Url: string,
): Promise<VerificationState> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return "unsupported";
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(payloadJsonText);
  } catch {
    return "invalid";
  }

  if (!publicKeyB64Url || !signatureB64Url) {
    return "invalid";
  }

  try {
    const jcsText = canonicalizeJcs(parsedPayload);
    const messageBytes = toArrayBufferBytes(new TextEncoder().encode(jcsText));
    const rawPubKey = decodeBase64Url(publicKeyB64Url);
    const rawSig = decodeBase64Url(signatureB64Url);

    if (rawPubKey.byteLength !== 32 || rawSig.byteLength !== 64) {
      return "invalid";
    }

    const verifyKey = await window.crypto.subtle.importKey(
      "raw",
      rawPubKey,
      {name: "Ed25519"},
      true,
      ["verify"],
    );

    const ok = await window.crypto.subtle.verify(
      {name: "Ed25519"},
      verifyKey,
      rawSig,
      messageBytes,
    );

    return ok ? "valid" : "invalid";
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotSupportedError") {
      return "unsupported";
    }

    return "invalid";
  }
}

export function WwwReceiptLab({
  initialPayload,
  initialPublicKey,
  initialSignature,
}: WwwReceiptLabProps) {
  const [payloadText, setPayloadText] = useState<string>(() =>
    initialPayload ? JSON.stringify(initialPayload, null, 2) : "",
  );
  const [publicKeyB64, setPublicKeyB64] = useState<string>(initialPublicKey ?? "");
  const [signatureB64, setSignatureB64] = useState<string>(initialSignature ?? "");
  const [keySource, setKeySource] = useState<KeySource>(
    initialPublicKey && initialSignature ? "recorded-gateway" : "webcrypto-ephemeral",
  );
  const [verification, setVerification] = useState<VerificationState>("idle");
  const [busy, setBusy] = useState(false);

  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const hydratedRecordedRef = useRef(false);

  const jcsPreview = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(payloadText);

      return {canonical: canonicalizeJcs(parsed), parseError: null};
    } catch (error) {
      return {
        canonical: "",
        parseError: error instanceof Error ? error.message : "Invalid JSON payload",
      };
    }
  }, [payloadText]);

  const encodedEnvelope = useMemo(() => {
    if (!signatureB64 || jcsPreview.parseError) {
      return "";
    }
    try {
      const parsed: unknown = JSON.parse(payloadText);
      const envelope = JSON.stringify(
        {
          public_key: publicKeyB64,
          receipt: parsed,
          signature: signatureB64,
        },
        null,
        2,
      );

      return envelope;
    } catch {
      return "";
    }
  }, [jcsPreview.parseError, payloadText, publicKeyB64, signatureB64]);

  const generateBrowserKeyPair = useCallback(async (): Promise<{
    pair: CryptoKeyPair;
    pubKeyB64: string;
  }> => {
    const generated = (await window.crypto.subtle.generateKey(
      {name: "Ed25519"},
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const rawPub = new Uint8Array(await window.crypto.subtle.exportKey("raw", generated.publicKey));
    const pubKeyB64 = encodeBase64Url(rawPub);

    keyPairRef.current = generated;

    return {pair: generated, pubKeyB64};
  }, []);

  // Hydrate recorded gateway receipt when bundle loads
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (
        !hydratedRecordedRef.current &&
        initialPayload &&
        initialPublicKey &&
        initialSignature
      ) {
        hydratedRecordedRef.current = true;
        const pretty = JSON.stringify(initialPayload, null, 2);
        const result = await verifyEd25519Jcs(pretty, initialPublicKey, initialSignature);

        if (!cancelled) {
          setPayloadText(pretty);
          setPublicKeyB64(initialPublicKey);
          setSignatureB64(initialSignature);
          setKeySource("recorded-gateway");
          setVerification(result);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialPayload, initialPublicKey, initialSignature]);

  const handlePayloadChange = useCallback(
    (nextText: string) => {
      setPayloadText(nextText);
      if (!publicKeyB64 || !signatureB64) {
        return;
      }
      void verifyEd25519Jcs(nextText, publicKeyB64, signatureB64).then((state) => {
        setVerification(state);
      });
    },
    [publicKeyB64, signatureB64],
  );

  const handleMintReceipt = useCallback(async () => {
    if (typeof window === "undefined" || !window.crypto?.subtle) {
      setVerification("unsupported");
      toast.danger("WebCrypto Ed25519 is unavailable in this browser");

      return;
    }

    let effectiveText = payloadText.trim();
    let parsed: unknown;

    if (!effectiveText) {
      const generatedPayload = createFreshBrowserPayload();

      effectiveText = JSON.stringify(generatedPayload, null, 2);
      setPayloadText(effectiveText);
      parsed = generatedPayload;
    } else {
      try {
        parsed = JSON.parse(effectiveText);
      } catch {
        setVerification("invalid");
        toast.danger("Enter valid JSON before minting a receipt signature");

        return;
      }
    }

    setBusy(true);
    try {
      let activePair = keyPairRef.current;
      let activePub = publicKeyB64;

      if (!activePair || keySource !== "webcrypto-ephemeral") {
        const fresh = await generateBrowserKeyPair();

        activePair = fresh.pair;
        activePub = fresh.pubKeyB64;
      }

      const jcsString = canonicalizeJcs(parsed);
      const messageBytes = toArrayBufferBytes(new TextEncoder().encode(jcsString));
      const sigBuffer = await window.crypto.subtle.sign(
        {name: "Ed25519"},
        activePair.privateKey,
        messageBytes,
      );
      const nextSig = encodeBase64Url(new Uint8Array(sigBuffer));
      const state = await verifyEd25519Jcs(effectiveText, activePub, nextSig);

      setPublicKeyB64(activePub);
      setSignatureB64(nextSig);
      setKeySource("webcrypto-ephemeral");
      setVerification(state);
      toast.success("Minted Ed25519 receipt signature via WebCrypto");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to sign receipt";

      toast.danger(msg);
    } finally {
      setBusy(false);
    }
  }, [generateBrowserKeyPair, keySource, payloadText, publicKeyB64]);

  const handleRotateKeypair = useCallback(async () => {
    if (typeof window === "undefined" || !window.crypto?.subtle) {
      setVerification("unsupported");
      toast.danger("WebCrypto Ed25519 is unavailable in this browser");

      return;
    }

    setBusy(true);
    try {
      const {pubKeyB64} = await generateBrowserKeyPair();
      const state = signatureB64
        ? await verifyEd25519Jcs(payloadText, pubKeyB64, signatureB64)
        : "invalid";

      setPublicKeyB64(pubKeyB64);
      setKeySource("webcrypto-ephemeral");
      setVerification(state);
      toast.success("Generated fresh Ed25519 keypair in browser");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to generate Ed25519 keypair";

      toast.danger(msg);
    } finally {
      setBusy(false);
    }
  }, [generateBrowserKeyPair, payloadText, signatureB64]);

  const handleVerifySignature = useCallback(async () => {
    setBusy(true);
    try {
      const state = await verifyEd25519Jcs(payloadText, publicKeyB64, signatureB64);

      setVerification(state);
      if (state === "valid") {
        toast.success("Ed25519 signature verified against RFC 8785 JCS bytes");
      } else if (state === "unsupported") {
        toast.danger("WebCrypto Ed25519 is unavailable in this browser");
      } else {
        toast.danger("Invalid Ed25519 signature for current payload and public key");
      }
    } finally {
      setBusy(false);
    }
  }, [payloadText, publicKeyB64, signatureB64]);

  const statusChip = useMemo(() => {
    if (verification === "valid") {
      return (
        <Chip color="success" size="sm" variant="soft">
          Valid
        </Chip>
      );
    }
    if (verification === "invalid") {
      return (
        <Chip color="danger" size="sm" variant="soft">
          Invalid Signature
        </Chip>
      );
    }
    if (verification === "unsupported") {
      return (
        <Chip color="warning" size="sm" variant="soft">
          Unsupported Browser
        </Chip>
      );
    }

    return (
      <Chip color="default" size="sm" variant="soft">
        Checking
      </Chip>
    );
  }, [verification]);

  return (
    <Card className="gap-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-foreground text-lg font-semibold">Capability Receipt Lab</h2>
            {statusChip}
          </div>
          <p className="text-muted max-w-3xl text-sm leading-relaxed">
            Inspect RFC 8785 JSON Canonicalization (JCS) and verify or mint Ed25519 capability
            receipts directly in your browser using{" "}
            <code className="text-foreground font-mono text-xs">window.crypto.subtle</code>.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            isDisabled={busy}
            size="sm"
            variant="tertiary"
            onPress={() => void handleRotateKeypair()}
          >
            Rotate Keypair
          </Button>
          <Button
            isDisabled={busy}
            size="sm"
            variant="secondary"
            onPress={() => void handleVerifySignature()}
          >
            Verify Signature
          </Button>
          <Button
            isDisabled={busy}
            size="sm"
            variant="primary"
            onPress={() => void handleMintReceipt()}
          >
            Mint Signed Receipt
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs font-medium" htmlFor="www-receipt-payload">
              Editable Receipt Payload (JSON)
            </Label>
            <span className="text-muted font-mono text-xs tabular-nums">
              {keySource === "recorded-gateway"
                ? "Authority: Recorded Gateway Key"
                : "Authority: Browser WebCrypto Key"}
            </span>
          </div>

          <TextArea
            fullWidth
            className="font-mono text-xs leading-relaxed tabular-nums"
            disabled={busy}
            id="www-receipt-payload"
            rows={11}
            value={payloadText}
            variant="secondary"
            onChange={(event) => handlePayloadChange(event.target.value)}
          />

          <div className="bg-surface-secondary flex flex-col gap-2 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted text-xs font-medium">Ed25519 Public Key (base64url)</span>
              <span className="text-muted font-mono text-xs tabular-nums">32 B</span>
            </div>
            <p className="text-foreground font-mono text-xs break-all tabular-nums">
              {publicKeyB64 || "—"}
            </p>
          </div>

          <div className="bg-surface-secondary flex flex-col gap-2 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted text-xs font-medium">Ed25519 Signature (base64url)</span>
              <span className="text-muted font-mono text-xs tabular-nums">64 B</span>
            </div>
            <p className="text-foreground font-mono text-xs break-all tabular-nums">
              {signatureB64 || "—"}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-foreground text-xs font-medium">
                RFC 8785 JCS Canonical Signing Input
              </span>
              <span className="text-muted font-mono text-xs tabular-nums">
                {jcsPreview.canonical
                  ? `${new TextEncoder().encode(jcsPreview.canonical).byteLength} B`
                  : "Invalid JSON"}
              </span>
            </div>
            <CodeBlock className="my-0 rounded-lg">
              <CodeBlock.Header>
                <span className="text-muted font-mono text-xs">rfc8785-jcs</span>
                <CodeBlock.CopyButton
                  aria-label="Copy JCS canonical bytes"
                  code={jcsPreview.canonical || jcsPreview.parseError || ""}
                />
              </CodeBlock.Header>
              <CodeBlock.Code
                className="max-h-36 overflow-auto"
                code={jcsPreview.canonical || jcsPreview.parseError || ""}
                language={jcsPreview.parseError ? "plaintext" : "json"}
              />
            </CodeBlock>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-foreground text-xs font-medium">Signed Receipt Envelope</span>
              <span className="text-muted font-mono text-xs tabular-nums">Ed25519 + JCS</span>
            </div>
            <CodeBlock className="my-0 rounded-lg">
              <CodeBlock.Header>
                <span className="text-muted font-mono text-xs">signed-receipt.json</span>
                <CodeBlock.CopyButton
                  aria-label="Copy signed receipt JSON"
                  code={encodedEnvelope}
                />
              </CodeBlock.Header>
              <CodeBlock.Code
                className="max-h-64 overflow-auto"
                code={encodedEnvelope || "// Fix JSON syntax to serialize signed envelope"}
                language={encodedEnvelope ? "json" : "plaintext"}
              />
            </CodeBlock>
          </div>
        </div>
      </div>
    </Card>
  );
}
