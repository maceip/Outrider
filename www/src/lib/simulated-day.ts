// Published fixed-seed demo generator. These counts are not shop data.
// Same math as the previous page.js and apps/console simulated-day.ts.

export type SimulatedDay = {
  date: string;
  total: number;
  letThrough: number;
  askedToVerify: number;
  blocked: number;
};

export function chicagoDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function seedOf(date: string): number {
  let hash = 2166136261;
  for (let i = 0; i < date.length; i += 1) {
    hash ^= date.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulatedDay(date: string): SimulatedDay {
  const next = random(seedOf(date));
  const total = 1200 + Math.floor(next() * 600);
  const askedToVerify = Math.round(total * (0.12 + next() * 0.06));
  const blocked = Math.round(total * (0.05 + next() * 0.04));
  return {
    date,
    total,
    letThrough: total - askedToVerify - blocked,
    askedToVerify,
    blocked,
  };
}
