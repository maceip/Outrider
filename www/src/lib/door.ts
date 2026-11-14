export const DEMO_DOOR = "https://demo.silvector.com/#/readiness/";

const HOST =
  /^(?=.{3,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function cleanDomain(raw: string): string | null {
  let value = String(raw || "").trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  value = value.split(/[/?#]/)[0] || "";
  if (!HOST.test(value)) return null;
  if (/^\d+(\.\d+)*$/.test(value)) return null;
  return value;
}
