import { type FormEvent, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cleanDomain, DEMO_DOOR } from "@/lib/door";

const INITIAL =
  "The demo runs a security check before it scans, and it refuses private and internal addresses. Nothing is sent from this page.";

export function DoorForm() {
  const [status, setStatus] = useState(INITIAL);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const domain = cleanDomain(String(data.get("domain") ?? ""));
    if (!domain) {
      setStatus("Type a website name, like yourshop.com.");
      return;
    }
    flushSync(() => {
      setStatus(`Opening the scan for ${domain} in the demo.`);
    });
    window.location.assign(DEMO_DOOR + encodeURIComponent(domain));
  }

  return (
    <form id="door-form" className="flex flex-col gap-3" action="/" method="get" noValidate onSubmit={onSubmit}>
      <Field>
        <FieldLabel htmlFor="door-domain">
          Type the shop's website. The scan opens in the demo.
        </FieldLabel>
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Input
            id="door-domain"
            name="domain"
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="yourshop.com"
            maxLength={253}
            required
          />
          <Button type="submit" className="sm:w-auto">
            Scan in the demo
          </Button>
        </div>
      </Field>
      <p id="door-status" className="text-muted-foreground text-sm" role="status">
        {status}
      </p>
    </form>
  );
}
