export const WWW_BASE_PATH =
  process.env.NEXT_PUBLIC_WWW === "1" ? "/__PAGES_BASE__" : "/__proxyfor__";

export function withWwwBasePath(assetPath: string): string {
  const normalized = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;

  return `${WWW_BASE_PATH}${normalized}`;
}
