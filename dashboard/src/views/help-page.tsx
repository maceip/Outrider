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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-10 pt-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {HELP_LINKS.map((link) => (
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
      <Card.Header className="gap-2">
        <div className="bg-accent-soft text-accent-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-5" />
        </div>
        <Card.Title className="min-w-0 text-base">{link.title}</Card.Title>
        <Card.Description className="leading-relaxed">{link.description}</Card.Description>
      </Card.Header>
      <Card.Footer>
        <Link
          className="text-accent-soft-foreground inline-flex items-center gap-1.5 text-sm no-underline hover:underline"
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
