"use client";

import type {CapabilityReceiptPayload} from "../lib/types";

import {Button, Card, Chip, Input, Label, TextArea, TextField, toast} from "@heroui/react";
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
    subject: `browser:${randomId}`,
  };
}

/**
 * Deterministic JSON canonicalization matching `serde_jcs::to_vec` in `proxyfor/src/commerce/receipt.rs`.
 */
export function canonicalizeJcs(value: unknown): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON forbids NaN and Infinity");
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

async function verifySignatureBytes(
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
  const [lastValidPayload, setLastValidPayload] = useState<unknown>(() => initialPayload ?? null);
  const [publicKeyB64, setPublicKeyB64] = useState<string>(initialPublicKey ?? "");
  const [signatureB64, setSignatureB64] = useState<string>(initialSignature ?? "");
  const [keySource, setKeySource] = useState<KeySource>(
    initialPublicKey && initialSignature ? "recorded-gateway" : "webcrypto-ephemeral",
  );
  const [verification, setVerification] = useState<VerificationState>("idle");
  const [busy, setBusy] = useState(false);

  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const hydratedRecordedRef = useRef(false);

  const canonicalText = useMemo(() => {
    if (lastValidPayload === null || lastValidPayload === undefined) {
      return "";
    }
    try {
      return canonicalizeJcs(lastValidPayload);
    } catch {
      return "";
    }
  }, [lastValidPayload]);

  const encodedEnvelope = useMemo(() => {
    if (!signatureB64 || lastValidPayload === null || lastValidPayload === undefined) {
      return "";
    }
    try {
      return JSON.stringify(
        {
          public_key: publicKeyB64,
          receipt: lastValidPayload,
          signature: signatureB64,
        },
        null,
        2,
      );
    } catch {
      return "";
    }
  }, [lastValidPayload, publicKeyB64, signatureB64]);

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
        const result = await verifySignatureBytes(pretty, initialPublicKey, initialSignature);

        if (!cancelled) {
          setPayloadText(pretty);
          setLastValidPayload(initialPayload);
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
      if (!nextText.trim()) {
        setLastValidPayload(null);
      } else {
        try {
          setLastValidPayload(JSON.parse(nextText));
        } catch {
          // Keep last valid payload for canonical preview while user types.
        }
      }
      if (!publicKeyB64 || !signatureB64) {
        return;
      }
      void verifySignatureBytes(nextText, publicKeyB64, signatureB64).then((state) => {
        setVerification(state);
      });
    },
    [publicKeyB64, signatureB64],
  );

  const handleMintReceipt = useCallback(async () => {
    if (typeof window === "undefined" || !window.crypto?.subtle) {
      setVerification("unsupported");
      toast.danger("Browser cryptography is unavailable");

      return;
    }

    let effectiveText = payloadText.trim();
    let parsed: unknown;

    if (!effectiveText) {
      const generatedPayload = createFreshBrowserPayload();

      effectiveText = JSON.stringify(generatedPayload, null, 2);
      setPayloadText(effectiveText);
      setLastValidPayload(generatedPayload);
      parsed = generatedPayload;
    } else {
      try {
        parsed = JSON.parse(effectiveText);
        setLastValidPayload(parsed);
      } catch {
        setVerification("invalid");
        toast.danger("Enter valid receipt JSON before minting");

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
      const state = await verifySignatureBytes(effectiveText, activePub, nextSig);

      setPublicKeyB64(activePub);
      setSignatureB64(nextSig);
      setKeySource("webcrypto-ephemeral");
      setVerification(state);
      toast.success("Minted signed receipt");
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
      toast.danger("Browser cryptography is unavailable");

      return;
    }

    setBusy(true);
    try {
      const {pubKeyB64} = await generateBrowserKeyPair();
      const state = signatureB64
        ? await verifySignatureBytes(payloadText, pubKeyB64, signatureB64)
        : "invalid";

      setPublicKeyB64(pubKeyB64);
      setKeySource("webcrypto-ephemeral");
      setVerification(state);
      toast.success("Generated fresh browser keypair");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to generate keypair";

      toast.danger(msg);
    } finally {
      setBusy(false);
    }
  }, [generateBrowserKeyPair, payloadText, signatureB64]);

  const handleVerifySignature = useCallback(async () => {
    try {
      JSON.parse(payloadText);
    } catch {
      setVerification("invalid");
      toast.danger("Invalid receipt JSON");

      return;
    }

    setBusy(true);
    try {
      const state = await verifySignatureBytes(payloadText, publicKeyB64, signatureB64);

      setVerification(state);
      if (state === "valid") {
        toast.success("Receipt signature verified");
      } else if (state === "unsupported") {
        toast.danger("Browser cryptography is unavailable");
      } else {
        toast.danger("Signature verification failed");
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-foreground text-base font-semibold">Access Pass Verification</h2>
          {statusChip}
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
              Receipt Payload
            </Label>
            <span className="text-muted font-mono text-xs tabular-nums">
              {keySource === "recorded-gateway" ? "Gateway Key" : "Browser Key"}
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

          <TextField
            fullWidth
            isReadOnly
            name="receipt-public-key"
            value={publicKeyB64 || "—"}
            variant="secondary"
          >
            <Label className="text-xs">Public Key</Label>
            <Input fullWidth className="font-mono text-xs tabular-nums" />
          </TextField>

          <TextField
            fullWidth
            isReadOnly
            name="receipt-signature"
            value={signatureB64 || "—"}
            variant="secondary"
          >
            <Label className="text-xs">Signature</Label>
            <Input fullWidth className="font-mono text-xs tabular-nums" />
          </TextField>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-foreground text-xs font-medium">Canonical Payload</span>
              <span className="text-muted font-mono text-xs tabular-nums">
                {canonicalText ? `${new TextEncoder().encode(canonicalText).byteLength} B` : "0 B"}
              </span>
            </div>
            <CodeBlock className="my-0 rounded-lg">
              <CodeBlock.Header>
                <span className="text-muted font-mono text-xs">canonical.json</span>
                <CodeBlock.CopyButton
                  aria-label="Copy canonical payload"
                  code={canonicalText}
                />
              </CodeBlock.Header>
              <CodeBlock.Code
                className="max-h-36 overflow-auto"
                code={canonicalText}
                language="json"
              />
            </CodeBlock>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-foreground text-xs font-medium">Signed Receipt</span>
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
                code={encodedEnvelope}
                language="json"
              />
            </CodeBlock>
          </div>
        </div>
      </div>
    </Card>
  );
}
