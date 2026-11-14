"use client";

import type {ClefQuestion, ClefQuestionKind, OperatorDialogKind} from "../lib/types";
import type {FormEvent} from "react";

import {Button, Input, Label, Modal, TextArea, TextField} from "@heroui/react";
import {useState} from "react";

import {useOutrider} from "../lib/outrider-store";

const DEFAULT_CLEF_PROMPT =
  "Does the recorded session contain a completed, structurally compliant capability probe?";
const DEFAULT_CLEF_OPTIONS = "compliant, non_compliant";

export function OperatorDialogs() {
  const {activeDialog, closeDialog, dialogOpenedAtUnix, selectedSession, snapshot} = useOutrider();

  const dialogTitle =
    activeDialog === "connect-upstream"
      ? "Connect MCP Upstream"
      : activeDialog === "put-bundle"
        ? "Put Capability Bundle"
        : activeDialog === "issue-receipt"
          ? "Issue Capability Receipt"
          : activeDialog === "evaluate-clef"
            ? "Run CLEF Evaluation"
            : "";

  return (
    <Modal
      isOpen={activeDialog !== null}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <Modal.Backdrop isDismissable>
        <Modal.Container placement="center" size="md">
          <Modal.Dialog id="action-dialog">
            <Modal.CloseTrigger aria-label="Close dialog" />
            <Modal.Header>
              <Modal.Heading>{dialogTitle}</Modal.Heading>
            </Modal.Header>
            {activeDialog ? (
              <OperatorDialogForm
                key={`${activeDialog}-${dialogOpenedAtUnix}-${selectedSession?.session_id ?? ""}`}
                dialogKind={activeDialog}
                initialBundleId={snapshot?.bundles[0]?.bundle_id ?? ""}
                initialCatalogItem={snapshot?.catalog_items[0]?.item_id ?? ""}
                initialExpiryUnix={String((dialogOpenedAtUnix || 0) + 3600)}
                initialSubject={selectedSession?.subject ?? ""}
              />
            ) : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

interface OperatorDialogFormProps {
  dialogKind: OperatorDialogKind;
  initialBundleId: string;
  initialCatalogItem: string;
  initialExpiryUnix: string;
  initialSubject: string;
}

function OperatorDialogForm({
  dialogKind,
  initialBundleId,
  initialCatalogItem,
  initialExpiryUnix,
  initialSubject,
}: OperatorDialogFormProps) {
  const {busy, closeDialog, mutate, selectedSession, snapshot} = useOutrider();

  const [formError, setFormError] = useState<string | null>(null);

  // 1. Connect Upstream state
  const [upstreamName, setUpstreamName] = useState("");
  const [upstreamEndpoint, setUpstreamEndpoint] = useState("");

  // 2. Put Bundle state
  const [bundleId, setBundleId] = useState("");
  const [bundleTitle, setBundleTitle] = useState("");
  const [bundleItems, setBundleItems] = useState(initialCatalogItem);
  const [bundleRules, setBundleRules] = useState("{}");

  // 3. Issue Receipt state
  const [receiptSubject, setReceiptSubject] = useState(initialSubject);
  const [receiptBundleId, setReceiptBundleId] = useState(initialBundleId);
  const [maxCalls, setMaxCalls] = useState("10");
  const [expiryUnix, setExpiryUnix] = useState(initialExpiryUnix);

  // 4. Run CLEF Eval state
  const [questionKind, setQuestionKind] = useState<ClefQuestionKind>("noul");
  const [questionPrompt, setQuestionPrompt] = useState(DEFAULT_CLEF_PROMPT);
  const [questionOptions, setQuestionOptions] = useState(DEFAULT_CLEF_OPTIONS);
  const [scoreMin, setScoreMin] = useState("0");
  const [scoreMax, setScoreMax] = useState("5");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    try {
      if (dialogKind === "connect-upstream") {
        const name = upstreamName.trim();
        const endpoint = upstreamEndpoint.trim();

        if (!name || !endpoint) {
          setFormError("Upstream name and command or HTTP URL are required.");

          return;
        }
        await mutate("/upstreams/connect", {endpoint, name});
        closeDialog();

        return;
      }

      if (dialogKind === "put-bundle") {
        const id = bundleId.trim();
        const title = bundleTitle.trim();
        const items = bundleItems
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean);

        if (!id || !title || items.length === 0) {
          setFormError("Bundle ID, title, and at least one catalog item are required.");

          return;
        }
        let parsedRules: unknown;

        try {
          parsedRules = JSON.parse(bundleRules.trim() || "{}");
        } catch {
          setFormError("Rules JSON must be valid JSON.");

          return;
        }
        if (!parsedRules || typeof parsedRules !== "object" || Array.isArray(parsedRules)) {
          setFormError("Rules JSON must be a JSON object.");

          return;
        }
        await mutate("/bundles/put", {
          bundle_id: id,
          items,
          rules: parsedRules,
          title,
        });
        closeDialog();

        return;
      }

      if (dialogKind === "issue-receipt") {
        const subject = receiptSubject.trim();
        const bundle_id = receiptBundleId.trim();
        const max_calls = Number(maxCalls);
        const expires_at_unix = Number(expiryUnix);

        if (!subject) {
          setFormError("Subject is required.");

          return;
        }
        if (!bundle_id) {
          setFormError("Select a configured bundle.");

          return;
        }
        if (!Number.isInteger(max_calls) || max_calls <= 0) {
          setFormError("Maximum calls must be a positive integer.");

          return;
        }
        if (!Number.isInteger(expires_at_unix) || expires_at_unix <= 0) {
          setFormError("Expiry must be a valid future Unix timestamp.");

          return;
        }
        await mutate("/receipts/issue", {
          bundle_id,
          expires_at_unix,
          max_calls,
          subject,
        });
        closeDialog();

        return;
      }

      if (dialogKind === "evaluate-clef") {
        if (!selectedSession) {
          setFormError("Select an agent session before running a CLEF evaluation.");

          return;
        }
        const prompt = questionPrompt.trim();

        if (!prompt) {
          setFormError("Question prompt is required.");

          return;
        }

        let question: ClefQuestion;

        if (questionKind === "noul") {
          question = {question: prompt, type: "noul"};
        } else if (questionKind === "choice") {
          const options = questionOptions
            .split(",")
            .map((opt) => opt.trim())
            .filter(Boolean);

          if (options.length === 0) {
            setFormError("Provide at least one option for a choice question.");

            return;
          }
          question = {options, question: prompt, type: "choice"};
        } else {
          const min = Number(scoreMin);
          const max = Number(scoreMax);

          if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
            setFormError("Score bounds must be integers with min <= max.");

            return;
          }
          question = {max, min, question: prompt, type: "score"};
        }

        await mutate("/evaluate", {
          question,
          session_id: selectedSession.session_id,
        });
        closeDialog();
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Backend mutation failed.");
    }
  };

  const availableItems = snapshot?.catalog_items ?? [];
  const availableBundles = snapshot?.bundles ?? [];

  const toggleCatalogItem = (itemId: string) => {
    const existing = bundleItems
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (existing.includes(itemId)) {
      setBundleItems(existing.filter((id) => id !== itemId).join(", "));
    } else {
      setBundleItems([...existing, itemId].join(", "));
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <Modal.Body className="flex flex-col gap-3">
        {dialogKind === "connect-upstream" ? (
          <>
            <TextField
              isRequired
              name="name"
              value={upstreamName}
              onChange={setUpstreamName}
            >
              <Label>Upstream name</Label>
              <Input fullWidth placeholder="live" />
            </TextField>
            <TextField
              isRequired
              name="endpoint"
              value={upstreamEndpoint}
              onChange={setUpstreamEndpoint}
            >
              <Label>Command or HTTP URL</Label>
              <Input fullWidth placeholder="https://mcp.example.com/mcp or stdio command" />
            </TextField>
          </>
        ) : null}

        {dialogKind === "put-bundle" ? (
          <>
            <TextField
              isRequired
              name="bundle_id"
              value={bundleId}
              onChange={setBundleId}
            >
              <Label>Bundle ID</Label>
              <Input fullWidth placeholder="research" />
            </TextField>
            <TextField
              isRequired
              name="title"
              value={bundleTitle}
              onChange={setBundleTitle}
            >
              <Label>Bundle title</Label>
              <Input fullWidth placeholder="Live upstream research" />
            </TextField>
            <TextField
              isRequired
              name="items"
              value={bundleItems}
              onChange={setBundleItems}
            >
              <Label>Catalog items</Label>
              <Input fullWidth placeholder="outrider_session_evidence" />
            </TextField>
            {availableItems.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {availableItems.slice(0, 8).map((item) => (
                  <button
                    key={item.item_id}
                    className="border-border text-muted hover:text-foreground rounded-md border px-2 py-0.5 font-mono text-xs"
                    type="button"
                    onClick={() => toggleCatalogItem(item.item_id)}
                  >
                    {item.item_id}
                  </button>
                ))}
              </div>
            ) : null}
            <TextField name="rules" value={bundleRules} onChange={setBundleRules}>
              <Label>Rules JSON</Label>
              <TextArea fullWidth className="min-h-20 font-mono text-xs" />
            </TextField>
          </>
        ) : null}

        {dialogKind === "issue-receipt" ? (
          <>
            <TextField
              isRequired
              name="subject"
              value={receiptSubject}
              onChange={setReceiptSubject}
            >
              <Label>Subject</Label>
              <Input fullWidth placeholder="session subject" />
            </TextField>
            <div className="flex flex-col gap-1.5">
              <label className="text-foreground text-sm font-medium" htmlFor="issue-bundle">
                Bundle
              </label>
              <select
                required
                className="border-border bg-surface text-foreground h-9 w-full rounded-lg border px-3 text-sm"
                id="issue-bundle"
                name="bundle_id"
                value={receiptBundleId}
                onChange={(e) => setReceiptBundleId(e.target.value)}
              >
                {availableBundles.length === 0 ? (
                  <option value="">No bundles configured</option>
                ) : (
                  availableBundles.map((bundle) => (
                    <option key={bundle.bundle_id} value={bundle.bundle_id}>
                      {bundle.bundle_id} — {bundle.title}
                    </option>
                  ))
                )}
              </select>
            </div>
            <TextField
              isRequired
              name="max_calls"
              type="number"
              value={maxCalls}
              onChange={setMaxCalls}
            >
              <Label>Maximum calls</Label>
              <Input fullWidth className="tabular-nums" min={1} />
            </TextField>
            <TextField
              isRequired
              name="expires_at_unix"
              type="number"
              value={expiryUnix}
              onChange={setExpiryUnix}
            >
              <Label>Expiry (Unix seconds)</Label>
              <Input fullWidth className="tabular-nums" />
            </TextField>
          </>
        ) : null}

        {dialogKind === "evaluate-clef" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-foreground text-sm font-medium" htmlFor="clef-kind">
                Question kind
              </label>
              <select
                className="border-border bg-surface text-foreground h-9 w-full rounded-lg border px-3 text-sm"
                id="clef-kind"
                name="question_kind"
                value={questionKind}
                onChange={(e) => setQuestionKind(e.target.value as ClefQuestionKind)}
              >
                <option value="noul">noul</option>
                <option value="choice">choice</option>
                <option value="score">score</option>
              </select>
            </div>
            <TextField
              isRequired
              name="question_prompt"
              value={questionPrompt}
              onChange={setQuestionPrompt}
            >
              <Label>Question prompt</Label>
              <TextArea fullWidth className="min-h-20 text-sm" />
            </TextField>
            <TextField
              isDisabled={questionKind !== "choice"}
              name="question_options"
              value={questionOptions}
              onChange={setQuestionOptions}
            >
              <Label>Options (comma-separated)</Label>
              <Input fullWidth placeholder="compliant, non_compliant" />
            </TextField>
            {questionKind === "score" ? (
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  isRequired
                  name="score_min"
                  type="number"
                  value={scoreMin}
                  onChange={setScoreMin}
                >
                  <Label>Minimum score</Label>
                  <Input fullWidth className="tabular-nums" />
                </TextField>
                <TextField
                  isRequired
                  name="score_max"
                  type="number"
                  value={scoreMax}
                  onChange={setScoreMax}
                >
                  <Label>Maximum score</Label>
                  <Input fullWidth className="tabular-nums" />
                </TextField>
              </div>
            ) : null}
          </>
        ) : null}

        {formError ? (
          <div
            aria-live="assertive"
            className="border-danger/40 bg-danger/10 text-danger rounded-lg border p-2.5 text-xs"
            role="alert"
          >
            {formError}
          </div>
        ) : null}
      </Modal.Body>
      <Modal.Footer className="flex items-center justify-end gap-2">
        <Button isDisabled={busy} type="button" variant="tertiary" onPress={closeDialog}>
          Cancel
        </Button>
        <Button isDisabled={busy} type="submit">
          Apply
        </Button>
      </Modal.Footer>
    </form>
  );
}
