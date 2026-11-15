"use client";

import type {ComponentType} from "react";

import {ArrowRightFromSquare, FileArrowDown, Lock, ShieldCheck} from "@gravity-ui/icons";
import {Accordion, Card, Link} from "@heroui/react";

type HelpLink = {
  description: string;
  href: string;
  icon: ComponentType<{className?: string}>;
  title: string;
};

const HELP_LINKS: readonly HelpLink[] = [
  {
    description:
      "Download the local root certificate in PEM format for command-line clients and runtimes.",
    href: "/__proxyfor__/certificate/proxyfor-ca-cert.pem",
    icon: ShieldCheck,
    title: "HTTPS Certificate (.pem)",
  },
  {
    description:
      "Download the local root certificate in CER format for macOS Keychain Access and browsers.",
    href: "/__proxyfor__/certificate/proxyfor-ca-cert.cer",
    icon: Lock,
    title: "HTTPS Certificate (.cer)",
  },
  {
    description:
      "Download captured HTTP and HTTPS requests and responses as a standard HAR archive.",
    href: "/__proxyfor__/traffics?har",
    icon: FileArrowDown,
    title: "Export Traffic (HAR)",
  },
];

type FaqItem = {
  question: string;
  answer: string;
};

const FAQS: readonly FaqItem[] = [
  {
    answer:
      "Set your application or shell HTTP_PROXY and HTTPS_PROXY environment variables to the proxy address listed in Settings. Forwarded requests and responses will stream into the Dashboard automatically.",
    question: "How do I route HTTP and HTTPS traffic through Outrider?",
  },
  {
    answer:
      "Copy the MCP endpoint URL from Settings and add it as an HTTP server in your MCP client configuration. You can also connect upstream MCP servers in Settings to expose their tools through the gateway.",
    question: "How do I connect an MCP client?",
  },
  {
    answer:
      "Download the HTTPS Certificate (.cer) file above and open it in Keychain Access. Double-click the imported Proxyfor CA certificate, expand the Trust section, and set When using this certificate to Always Trust.",
    question: "How do I trust the local HTTPS certificate on macOS?",
  },
  {
    answer:
      "Click Export HAR in the top navigation bar or open the Export Traffic (HAR) card above to save all captured HTTP and HTTPS exchanges as a HAR file.",
    question: "How do I export captured traffic?",
  },
];

export function HelpPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">
        Download local gateway certificates, export captured traffic, or review common setup steps.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {HELP_LINKS.map((link) => (
          <HelpLinkCard key={link.title} link={link} />
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-foreground text-base font-semibold">Frequently asked questions</h2>
        <Accordion className="w-full">
          {FAQS.map((faq, index) => (
            <Accordion.Item key={faq.question} id={`faq-${index}`}>
              <Accordion.Heading>
                <Accordion.Trigger>
                  {faq.question}
                  <Accordion.Indicator />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="text-muted text-sm">{faq.answer}</Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </section>

      <footer className="text-muted text-xs">
        Source and issue tracker on{" "}
        <Link
          className="no-underline"
          href="https://github.com/maceip/Outrider"
          rel="noreferrer"
          target="_blank"
        >
          GitHub
        </Link>
      </footer>
    </div>
  );
}

function HelpLinkCard({link}: {link: HelpLink}) {
  const Icon = link.icon;

  return (
    <Card className="rounded-2xl">
      <Card.Header>
        <div className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-xl">
          <Icon className="size-5" />
        </div>
        <Card.Title className="text-base">{link.title}</Card.Title>
        <Card.Description>{link.description}</Card.Description>
      </Card.Header>
      <Card.Footer>
        <Link
          className="text-accent inline-flex items-center gap-1 text-sm"
          href={link.href}
          rel="noreferrer"
          target="_blank"
        >
          Open
          <ArrowRightFromSquare className="size-3.5" />
        </Link>
      </Card.Footer>
    </Card>
  );
}
