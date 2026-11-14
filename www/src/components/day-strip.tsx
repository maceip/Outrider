import { useState } from "react";
import { Meter, MeterIndicator, MeterLabel, MeterTrack } from "@/components/ui/meter";
import { chicagoDate, simulatedDay } from "@/lib/simulated-day";

const rows = [
  {
    key: "through",
    label: "Let through",
    hint: "Permit or rate-limit. The agent got an answer.",
    indicator: "bg-success",
    pick: (day: { letThrough: number }) => day.letThrough,
  },
  {
    key: "verify",
    label: "Asked to verify",
    hint: "Step up. A person was asked to confirm.",
    indicator: "bg-warning",
    pick: (day: { askedToVerify: number }) => day.askedToVerify,
  },
  {
    key: "blocked",
    label: "Blocked",
    hint: "Block. The only stop.",
    indicator: "bg-destructive",
    pick: (day: { blocked: number }) => day.blocked,
  },
] as const;

export function DayStrip() {
  const [day] = useState(() => simulatedDay(chicagoDate(new Date())));
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <div id="day-strip" className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Simulated demo traffic · <span data-day="date">{day.date}</span>
      </p>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-input" aria-hidden="true">
        <span data-bar="through" className="bg-success" style={{ flexGrow: day.letThrough }} />
        <span data-bar="verify" className="bg-warning" style={{ flexGrow: day.askedToVerify }} />
        <span data-bar="blocked" className="bg-destructive" style={{ flexGrow: day.blocked }} />
      </div>
      <div className="grid gap-4">
        {rows.map((row) => {
          const value = row.pick(day);
          return (
            <Meter key={row.key} value={value} max={day.total}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <MeterLabel>{row.label}</MeterLabel>
                <p className="text-sm tabular-nums">
                  <span data-day={row.key}>{fmt(value)}</span> of{" "}
                  <span data-day="total">{fmt(day.total)}</span>
                </p>
              </div>
              <MeterTrack>
                <MeterIndicator className={row.indicator} />
              </MeterTrack>
              <p className="text-muted-foreground text-sm">{row.hint}</p>
            </Meter>
          );
        })}
      </div>
      <p className="text-muted-foreground text-sm">
        These counts are simulated demo traffic, from a fixed seed for each day. They are not from
        real shops.
      </p>
    </div>
  );
}
