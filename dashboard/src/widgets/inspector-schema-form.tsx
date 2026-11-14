"use client";

import {Button, Input, Label, TextArea, TextField} from "@heroui/react";
import {NativeSelect} from "@heroui-pro/react";
import {useId} from "react";

export interface JsonSchemaProperty {
  type?: string | string[];
  title?: string;
  description?: string;
  format?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  enum?: unknown[];
  oneOf?: Array<{const?: unknown; title?: string}>;
  properties?: Record<string, JsonSchemaProperty>;
  items?: {
    type?: string;
    enum?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

export interface RootEntry {
  uri: string;
  name?: string;
}

export interface AnswerDraftState {
  elicitationAction: "accept" | "decline" | "cancel";
  schemaValues: Record<string, string>;
  samplingReply: string;
  modelName: string;
  rawJson: string;
}

export function createInitialAnswerDraft(params?: Record<string, unknown> | null): AnswerDraftState {
  const rawSchema = (params?.requestedSchema ?? params?.requested_schema) as JsonSchema | undefined;

  return {
    elicitationAction: "accept",
    modelName: "human-operator",
    rawJson: "{}",
    samplingReply: "",
    schemaValues: buildInitialSchemaStrings(rawSchema),
  };
}

function resolvePropertyType(prop: JsonSchemaProperty): string | undefined {
  if (Array.isArray(prop.type)) {
    return prop.type.find((t) => t !== "null");
  }

  return prop.type;
}

function resolvePropertyOptions(
  prop: JsonSchemaProperty,
  resolvedType: string | undefined,
): unknown[] | null {
  if (Array.isArray(prop.enum)) {
    return prop.enum;
  }
  if (Array.isArray(prop.oneOf)) {
    const consts = prop.oneOf.map((o) => o.const).filter((v) => v !== undefined);

    if (consts.length > 0) return consts;
  }
  if (Array.isArray(prop.items?.enum) && resolvedType !== "array") {
    return prop.items.enum;
  }

  return null;
}

export function buildInitialSchemaStrings(
  schema?: JsonSchema | null,
  initial?: Record<string, unknown>,
): Record<string, string> {
  const props = schema?.properties ?? {};
  const out: Record<string, string> = {};

  for (const [key, prop] of Object.entries(props)) {
    const val = initial?.[key];

    if (val === undefined) {
      out[key] = "";
      continue;
    }
    const resolvedType = resolvePropertyType(prop ?? {});
    const options = resolvePropertyOptions(prop ?? {}, resolvedType);

    if (options && resolvedType !== "array") {
      out[key] = JSON.stringify(val);
    } else if (
      resolvedType === "boolean" ||
      resolvedType === "number" ||
      resolvedType === "integer"
    ) {
      out[key] = String(val);
    } else if (
      resolvedType === "string" ||
      (!resolvedType && !prop?.properties && !prop?.items)
    ) {
      out[key] = String(val);
    } else {
      out[key] = JSON.stringify(val, null, 2);
    }
  }

  return out;
}

export function readSchemaValues(
  schema: JsonSchema | null | undefined,
  values: Record<string, string>,
): Record<string, unknown> {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const out: Record<string, unknown> = {};

  for (const [key, rawProp] of Object.entries(props)) {
    const prop = rawProp ?? {};
    const raw = values[key] ?? "";
    const resolvedType = resolvePropertyType(prop);
    const options = resolvePropertyOptions(prop, resolvedType);
    let parsed: unknown;

    if (options && resolvedType !== "array") {
      parsed = raw === "" ? undefined : (JSON.parse(raw) as unknown);
    } else if (resolvedType === "boolean") {
      parsed = raw === "" ? undefined : raw === "true";
    } else if (resolvedType === "number" || resolvedType === "integer") {
      if (raw.trim() === "") {
        parsed = undefined;
      } else {
        const num = Number(raw);

        if (Number.isNaN(num)) {
          throw new Error(`${key} must be a valid number`);
        }
        parsed = num;
      }
    } else if (
      resolvedType === "string" ||
      (!resolvedType && !prop.properties && !prop.items)
    ) {
      parsed = raw === "" ? undefined : raw;
    } else if (!raw.trim()) {
      parsed = undefined;
    } else {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid JSON";

        throw new Error(`${key}: ${message}`);
      }
    }

    if (parsed !== undefined) {
      out[key] = parsed;
    } else if (required.has(key)) {
      throw new Error(`${key} is required`);
    }
  }

  return out;
}

export interface InspectorSchemaFormProps {
  schema?: JsonSchema | null;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

export function InspectorSchemaForm({onChange, schema, values}: InspectorSchemaFormProps) {
  const baseId = useId();
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const keys = Object.keys(props);

  if (keys.length === 0) {
    return <p className="text-muted text-xs">No parameters.</p>;
  }

  const updateKey = (key: string, nextValue: string) => {
    onChange({...values, [key]: nextValue});
  };

  return (
    <div className="flex flex-col gap-2.5">
      {keys.map((key) => {
        const prop = props[key] ?? {};
        const resolvedType = resolvePropertyType(prop);
        const options = resolvePropertyOptions(prop, resolvedType);
        const isReq = required.has(key);
        const rawValue = values[key] ?? "";
        const fieldId = `${baseId}-${key}`;
        const defaultPlaceholder =
          prop.default !== undefined ? `default ${JSON.stringify(prop.default)}` : undefined;
        const hint = prop.description || prop.title;

        return (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <Label className="font-mono text-xs" htmlFor={fieldId}>
                {key}
                {isReq ? " *" : ""}
              </Label>
              {resolvedType ? (
                <span className="text-muted font-mono text-xs">{resolvedType}</span>
              ) : null}
            </div>

            {options && resolvedType !== "array" ? (
              <NativeSelect fullWidth variant="secondary">
                <NativeSelect.Trigger
                  aria-label={key}
                  aria-required={isReq || undefined}
                  className="font-mono text-xs"
                  id={fieldId}
                  value={rawValue}
                  onChange={(e) => updateKey(key, e.target.value)}
                >
                  <NativeSelect.Option value="">
                    {isReq ? "— choose —" : "— unset —"}
                  </NativeSelect.Option>
                  {options.map((opt, idx) => (
                    <NativeSelect.Option key={`${idx}-${String(opt)}`} value={JSON.stringify(opt)}>
                      {String(opt)}
                    </NativeSelect.Option>
                  ))}
                </NativeSelect.Trigger>
              </NativeSelect>
            ) : resolvedType === "boolean" ? (
              <NativeSelect fullWidth variant="secondary">
                <NativeSelect.Trigger
                  aria-label={key}
                  aria-required={isReq || undefined}
                  className="font-mono text-xs"
                  id={fieldId}
                  value={rawValue}
                  onChange={(e) => updateKey(key, e.target.value)}
                >
                  <NativeSelect.Option value="">— unset —</NativeSelect.Option>
                  <NativeSelect.Option value="true">true</NativeSelect.Option>
                  <NativeSelect.Option value="false">false</NativeSelect.Option>
                </NativeSelect.Trigger>
              </NativeSelect>
            ) : resolvedType === "number" || resolvedType === "integer" ? (
              <Input
                fullWidth
                aria-label={key}
                aria-required={isReq || undefined}
                className="font-mono text-xs tabular-nums"
                id={fieldId}
                max={prop.maximum}
                min={prop.minimum}
                placeholder={defaultPlaceholder}
                step={resolvedType === "integer" ? "1" : "any"}
                type="number"
                 value={rawValue}
                variant="secondary"
                onChange={(e) => updateKey(key, e.target.value)}
              />
            ) : resolvedType === "string" ||
              (!resolvedType && !prop.properties && !prop.items) ? (
              prop.format === "textarea" || (prop.maxLength ?? 0) > 200 ? (
                <TextArea
                  fullWidth
                  aria-label={key}
                  aria-required={isReq || undefined}
                  className="min-h-16 font-mono text-xs"
                  id={fieldId}
                  placeholder={defaultPlaceholder}
                  value={rawValue}
                  variant="secondary"
                  onChange={(e) => updateKey(key, e.target.value)}
                />
              ) : (
                <Input
                  fullWidth
                  aria-label={key}
                  aria-required={isReq || undefined}
                  className="font-mono text-xs"
                  id={fieldId}
                  placeholder={defaultPlaceholder}
                  type={
                    prop.format === "email"
                      ? "email"
                      : prop.format === "uri"
                        ? "url"
                        : prop.format === "date"
                          ? "date"
                          : "text"
                  }
                  value={rawValue}
                  variant="secondary"
                  onChange={(e) => updateKey(key, e.target.value)}
                />
              )
            ) : (
              <TextArea
                fullWidth
                aria-label={key}
                aria-required={isReq || undefined}
                className="min-h-16 font-mono text-xs"
                id={fieldId}
                placeholder={
                  defaultPlaceholder ??
                  (resolvedType === "array" ? "[ ] JSON array" : "{ } JSON object")
                }
                value={rawValue}
                variant="secondary"
                onChange={(e) => updateKey(key, e.target.value)}
              />
            )}

            {hint ? <span className="text-muted text-xs text-pretty">{hint}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export interface InspectorArgsEditorProps {
  schema?: JsonSchema | null;
  mode: "form" | "json";
  formValues: Record<string, string>;
  rawJson: string;
  onFormValuesChange: (next: Record<string, string>) => void;
  onRawJsonChange: (next: string) => void;
  onToggleMode: () => void;
}

export function InspectorArgsEditor({
  formValues,
  mode,
  onFormValuesChange,
  onRawJsonChange,
  onToggleMode,
  rawJson,
  schema,
}: InspectorArgsEditorProps) {
  const rawId = useId();

  return (
    <div className="flex flex-col gap-2">
      {mode === "form" ? (
        <InspectorSchemaForm
          schema={schema}
          values={formValues}
          onChange={onFormValuesChange}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <Label className="font-mono text-xs" htmlFor={rawId}>
            Arguments JSON
          </Label>
          <TextArea
            fullWidth
            aria-label="Arguments JSON"
            className="min-h-24 font-mono text-xs"
            id={rawId}
            placeholder="{}"
            value={rawJson}
            variant="secondary"
            onChange={(e) => onRawJsonChange(e.target.value)}
          />
        </div>
      )}
      <div>
        <Button size="sm" variant="tertiary" onPress={onToggleMode}>
          {mode === "json" ? "Edit as form" : "Edit as JSON"}
        </Button>
      </div>
    </div>
  );
}

export function buildAnswerPayload(
  method: string,
  params: Record<string, unknown> | null | undefined,
  draft: AnswerDraftState,
  roots: RootEntry[],
): unknown {
  if (method === "elicitation/create") {
    const isUrlMode = params?.mode === "url" || Boolean(params?.url);

    if (isUrlMode || draft.elicitationAction !== "accept") {
      return {action: draft.elicitationAction};
    }
    const requestedSchema = (params?.requestedSchema ?? params?.requested_schema) as
      | JsonSchema
      | undefined;

    return {
      action: "accept",
      content: readSchemaValues(requestedSchema, draft.schemaValues),
    };
  }

  if (method === "sampling/createMessage") {
    if (!draft.samplingReply) {
      throw new Error("Write the sampling reply");
    }

    return {
      content: {text: draft.samplingReply, type: "text"},
      model: draft.modelName || "human-operator",
      role: "assistant",
      stopReason: "endTurn",
    };
  }

  if (method === "roots/list") {
    return {roots};
  }

  try {
    return JSON.parse(draft.rawJson.trim() || "{}") as unknown;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid answer JSON");
  }
}

export interface InspectorAnswerEditorProps {
  method: string;
  params: Record<string, unknown> | null | undefined;
  draft: AnswerDraftState;
  roots: RootEntry[];
  onChange: (next: AnswerDraftState) => void;
}

export function InspectorAnswerEditor({
  draft,
  method,
  onChange,
  params,
  roots,
}: InspectorAnswerEditorProps) {
  const actionId = useId();
  const rawId = useId();

  if (method === "elicitation/create") {
    const message = typeof params?.message === "string" ? params.message : "";
    const url = typeof params?.url === "string" ? params.url : "";
    const isUrlMode = params?.mode === "url" || Boolean(url);
    const requestedSchema = (params?.requestedSchema ?? params?.requested_schema) as
      | JsonSchema
      | undefined;

    return (
      <div className="flex flex-col gap-2.5">
        {message ? (
          <div className="banner border-border bg-background text-foreground rounded-lg border p-2.5 text-xs text-pretty">
            {message}
          </div>
        ) : null}

        {isUrlMode ? (
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-muted">The server asks you to open this URL:</span>
            <a
              className="text-accent font-mono break-all underline"
              href={url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {url}
            </a>
          </div>
        ) : (
          <InspectorSchemaForm
            schema={requestedSchema}
            values={draft.schemaValues}
            onChange={(schemaValues) => onChange({...draft, schemaValues})}
          />
        )}

        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor={actionId}>
            Elicitation action
          </Label>
          <NativeSelect fullWidth variant="secondary">
            <NativeSelect.Trigger
              aria-label="Elicitation action"
              className="font-mono text-xs"
              id={actionId}
              value={draft.elicitationAction}
              onChange={(e) =>
                onChange({
                  ...draft,
                  elicitationAction: e.target.value as AnswerDraftState["elicitationAction"],
                })
              }
            >
              <NativeSelect.Option value="accept">accept</NativeSelect.Option>
              <NativeSelect.Option value="decline">decline</NativeSelect.Option>
              <NativeSelect.Option value="cancel">cancel</NativeSelect.Option>
            </NativeSelect.Trigger>
          </NativeSelect>
        </div>
      </div>
    );
  }

  if (method === "sampling/createMessage") {
    const systemPrompt = typeof params?.systemPrompt === "string" ? params.systemPrompt : null;
    const maxTokens = typeof params?.maxTokens === "number" ? params.maxTokens : null;
    const rawMessages = Array.isArray(params?.messages)
      ? (params.messages as Array<{role?: string; content?: unknown}>)
      : [];

    return (
      <div className="flex flex-col gap-2.5">
        <details open className="border-border bg-background rounded-lg border p-2 text-xs">
          <summary className="text-muted cursor-pointer font-medium">
            Messages the server wants sampled
          </summary>
          <div className="mt-2 flex flex-col gap-1.5">
            {systemPrompt ? (
              <div className="text-muted font-mono text-xs">system: {systemPrompt}</div>
            ) : null}
            {rawMessages.map((msg, idx) => {
              const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];

              return (
                <div key={idx} className="flex flex-col gap-1">
                  <span className="text-muted font-mono text-xs">{msg.role ?? "user"}:</span>
                  {blocks.map((block, bIdx) => {
                    const text =
                      block &&
                      typeof block === "object" &&
                      "type" in block &&
                      (block as {type?: string}).type === "text" &&
                      "text" in block
                        ? String((block as {text?: unknown}).text ?? "")
                        : JSON.stringify(block, null, 2);

                    return (
                      <pre
                        key={bIdx}
                        className="border-border bg-surface overflow-x-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-words"
                      >
                        {text}
                      </pre>
                    );
                  })}
                </div>
              );
            })}
            {maxTokens !== null ? (
              <div className="text-muted font-mono text-xs tabular-nums">
                maxTokens {maxTokens}
              </div>
            ) : null}
          </div>
        </details>

        <TextField
          fullWidth
          value={draft.samplingReply}
          variant="secondary"
          onChange={(samplingReply) => onChange({...draft, samplingReply})}
        >
          <Label className="text-xs">Sampling reply</Label>
          <TextArea
            aria-label="Sampling reply"
            className="min-h-20 font-mono text-xs"
            placeholder="The assistant reply you return to the server"
          />
        </TextField>

        <TextField
          fullWidth
          value={draft.modelName}
          variant="secondary"
          onChange={(modelName) => onChange({...draft, modelName})}
        >
          <Label className="text-xs">Model name</Label>
          <Input aria-label="Model name" className="font-mono text-xs" />
        </TextField>
      </div>
    );
  }

  if (method === "roots/list") {
    return (
      <div className="flex flex-col gap-1.5 text-xs">
        <span className="text-muted">Answered with configured roots:</span>
        <pre className="border-border bg-background overflow-x-auto rounded-lg border p-2 font-mono text-xs whitespace-pre-wrap">
          {JSON.stringify(roots, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <pre className="border-border bg-background max-h-48 overflow-auto rounded-lg border p-2 font-mono text-xs whitespace-pre-wrap break-words">
        {JSON.stringify(params ?? {}, null, 2)}
      </pre>
      <div className="flex flex-col gap-1">
        <Label className="text-xs" htmlFor={rawId}>
          Raw answer JSON
        </Label>
        <TextArea
          fullWidth
          aria-label="Raw answer JSON"
          className="min-h-20 font-mono text-xs"
          id={rawId}
          placeholder="Result JSON"
          value={draft.rawJson}
          variant="secondary"
          onChange={(e) => onChange({...draft, rawJson: e.target.value})}
        />
      </div>
    </div>
  );
}
