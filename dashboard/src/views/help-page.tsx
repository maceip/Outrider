"use client";

import type {ComponentType} from "react";

import {ArrowRightFromSquare} from "@gravity-ui/icons";
import {Accordion, Card, Link} from "@heroui/react";

type HelpLink = {
  description: string;
  href: string;
  icon: ComponentType<{className?: string}>;
  title: string;
};

const HELP_LINKS: readonly HelpLink[] = [];

type FaqItem = {
  question: string;
  answer: string;
};

const FAQS: readonly FaqItem[] = [];

export function HelpPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">Local gateway certificates, endpoints, and reference.</p>

      {HELP_LINKS.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {HELP_LINKS.map((link) => (
            <HelpLinkCard key={link.title} link={link} />
          ))}
        </div>
      ) : null}

      {FAQS.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-foreground text-base font-semibold">Reference</h2>
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
      ) : null}
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
        <Link className="text-accent inline-flex items-center gap-1 text-sm" href={link.href}>
          Open
          <ArrowRightFromSquare className="size-3.5" />
        </Link>
      </Card.Footer>
    </Card>
  );
}
