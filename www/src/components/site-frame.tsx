import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

const nav = [
  { href: "https://www.silvector.com/", label: "Home" },
  { href: "/", label: "Perspectives", internal: true },
  {
    href: "https://www.silvector.com/how-silvector-decides",
    label: "How it decides",
  },
  { href: "https://demo.silvector.com/#/start", label: "Demo" },
  { href: "https://www.silvector.com/#contact", label: "Contact" },
] as const;

function NavLink({
  href,
  label,
  internal,
  current,
}: {
  href: string;
  label: string;
  internal?: boolean;
  current: boolean;
}) {
  const render = internal ? (
    <Link to={href} aria-current={current ? "page" : undefined} />
  ) : (
    <a href={href} />
  );
  return (
    <Button variant={current ? "secondary" : "ghost"} size="sm" render={render}>
      {label}
    </Button>
  );
}

export function SiteFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const onPerspectives = pathname === "/";

  return (
    <div className="min-h-svh bg-background text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        href="#main"
      >
        Skip to the page
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <a
            className="inline-flex items-center gap-2 font-heading text-sm font-medium"
            href="https://www.silvector.com/"
          >
            <img
              src="/mark/mark-white.png"
              alt=""
              width={1024}
              height={1024}
              className="size-7"
            />
            Silvector
          </a>
          <nav aria-label="Page" className="flex flex-wrap gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.label}
                href={item.href}
                label={item.label}
                internal={"internal" in item ? item.internal : false}
                current={item.label === "Perspectives" && onPerspectives}
              />
            ))}
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-10 text-muted-foreground text-sm">
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          <a className="underline-offset-4 hover:underline" href="https://www.silvector.com/">
            Home
          </a>
          <Link className="underline-offset-4 hover:underline" to="/">
            Perspectives
          </Link>
          <a
            className="underline-offset-4 hover:underline"
            href="https://www.silvector.com/how-silvector-decides"
          >
            How Silvector decides
          </a>
          <a className="underline-offset-4 hover:underline" href="https://docs.silvector.com/">
            Docs
          </a>
          <a className="underline-offset-4 hover:underline" href="https://www.silvector.com/privacy">
            Privacy
          </a>
        </p>
        <p>© 2026 AG47AI</p>
      </footer>
    </div>
  );
}
