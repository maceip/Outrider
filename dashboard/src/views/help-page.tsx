"use client";

import type {ComponentType} from "react";

import {ArrowRightFromSquare, FileArrowDown, Lock, ShieldCheck} from "@gravity-ui/icons";
import {Accordion, Card, Link} from "@heroui/react";
import {useEffect, useMemo, useState} from "react";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";
const GITHUB_RELEASES_LATEST_URL = "https://github.com/maceip/Outrider/releases/latest";
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/maceip/Outrider/releases/latest";

type HelpLink = {
  href: string;
  icon: ComponentType<{className?: string}>;
  title: string;
};

const LOCAL_HELP_LINKS: readonly HelpLink[] = [
  {
    href: "/__proxyfor__/certificate/proxyfor-ca-cert.pem",
    icon: ShieldCheck,
    title: "Root Certificate (.pem)",
  },
  {
    href: "/__proxyfor__/certificate/proxyfor-ca-cert.cer",
    icon: Lock,
    title: "Root Certificate (.cer)",
  },
  {
    href: "/__proxyfor__/traffics?har",
    icon: FileArrowDown,
    title: "Export Traffic (.har)",
  },
];

type FaqItem = {
  question: string;
  answer: string;
};

const FAQS: readonly FaqItem[] = [
  {
    answer:
      "Set your application or shell HTTP_PROXY and HTTPS_PROXY environment variables to the proxy address listed in Settings. Forwarded requests and responses stream into the Dashboard automatically.",
    question: "How do I route HTTP and HTTPS traffic through Conduit?",
  },
  {
    answer:
      "Copy the endpoint URL from Settings and add it to your agent configuration. You can also connect upstream servers in Settings to expose their tools through the gateway.",
    question: "How do I connect an agent client?",
  },
  {
    answer:
      "Download the Root Certificate (.cer) file and open it in Keychain Access. Double-click the imported certificate, expand Trust, and set When using this certificate to Always Trust.",
    question: "How do I trust the local root certificate on macOS?",
  },
  {
    answer:
      "Click Export HAR in the top navigation bar to download all captured exchanges as a standard archive.",
    question: "How do I export captured traffic?",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function HelpPage() {
  const [releaseUrls, setReleaseUrls] = useState<{dmg: string; linux: string; msi: string}>({
    dmg: GITHUB_RELEASES_LATEST_URL,
    linux: GITHUB_RELEASES_LATEST_URL,
    msi: GITHUB_RELEASES_LATEST_URL,
  });

  useEffect(() => {
    if (!IS_WWW) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(GITHUB_RELEASES_API_URL, {
          headers: {Accept: "application/vnd.github+json"},
          signal: controller.signal,
        });

        if (!res.ok) return;
        const json: unknown = await res.json();

        if (!isRecord(json) || !Array.isArray(json.assets)) return;
        const pageUrl =
          typeof json.html_url === "string" ? json.html_url : GITHUB_RELEASES_LATEST_URL;
        let dmg = pageUrl;
        let msi = pageUrl;
        let linux = pageUrl;

        for (const item of json.assets) {
          if (
            isRecord(item) &&
            typeof item.name === "string" &&
            typeof item.browser_download_url === "string"
          ) {
            const lower = item.name.toLowerCase();

            if (lower.endsWith(".dmg")) dmg = item.browser_download_url;
            else if (lower.endsWith(".msi")) msi = item.browser_download_url;
            else if (lower.includes("linux") && lower.endsWith(".tar.gz")) {
              linux = item.browser_download_url;
            }
          }
        }
        if (!controller.signal.aborted) {
          setReleaseUrls({dmg, linux, msi});
        }
      } catch {
        // Offline or rate-limited falls back cleanly to releases/latest.
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  const links = useMemo<readonly HelpLink[]>(() => {
    if (!IS_WWW) return LOCAL_HELP_LINKS;

    return [
      {href: releaseUrls.dmg, icon: FileArrowDown, title: "macOS Installer (.dmg)"},
      {href: releaseUrls.msi, icon: FileArrowDown, title: "Windows Installer (.msi)"},
      {href: releaseUrls.linux, icon: FileArrowDown, title: "Linux Archive (.tar.gz)"},
    ];
  }, [releaseUrls]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-10 pt-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {links.map((link) => (
          <HelpLinkCard key={link.title} link={link} />
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-foreground text-base font-semibold">Frequently Asked Questions</h2>
        <Accordion className="border-border w-full border" variant="surface">
          {FAQS.map((faq, index) => (
            <Accordion.Item key={faq.question} id={`faq-${index}`}>
              <Accordion.Heading>
                <Accordion.Trigger>
                  <span className="min-w-0 pr-3">{faq.question}</span>
                  <Accordion.Indicator />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="text-muted text-sm leading-relaxed">
                  {faq.answer}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </section>
    </div>
  );
}

function HelpLinkCard({link}: {link: HelpLink}) {
  const Icon = link.icon;

  return (
    <Card className="h-full justify-between">
      <Card.Header className="flex-row items-center gap-3">
        <div className="bg-accent-soft text-accent-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-5" />
        </div>
        <Card.Title className="min-w-0 text-base">{link.title}</Card.Title>
      </Card.Header>
      <Card.Footer>
        <Link
          className="text-accent-soft-foreground inline-flex items-center gap-1.5 text-sm no-underline hover:underline"
          href={link.href}
          rel="noreferrer"
          target="_blank"
        >
          Download
          <ArrowRightFromSquare className="size-3.5" />
        </Link>
      </Card.Footer>
    </Card>
  );
}
