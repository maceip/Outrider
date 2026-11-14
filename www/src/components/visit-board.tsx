import { type KeyboardEvent, useState } from "react";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardPanel, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { chapters } from "@/content";

export function VisitBoard() {
  const [chapter, setChapter] = useState("0");

  function onChapterKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const current = Number(chapter);
    const next = Math.max(
      0,
      Math.min(chapters.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)),
    );
    setChapter(String(next));
    event.currentTarget
      .querySelector<HTMLElement>(`[data-chapter-button="${next}"]`)
      ?.focus();
  }

  return (
    <div
      id="board"
      data-chapter={chapter}
      className="flex flex-col gap-6"
      onKeyDownCapture={onChapterKey}
    >
      <Tabs value={chapter} onValueChange={setChapter}>
        <TabsList aria-label="Steps in the visit" className="h-auto w-full flex-wrap">
          {chapters.map((item) => (
            <TabsTab key={item.id} value={item.id} data-chapter-button={item.id}>
              {item.label}
            </TabsTab>
          ))}
        </TabsList>
        {chapters.map((item) => (
          <TabsPanel key={item.id} value={item.id} data-ch={item.id} className="pt-4">
            <p className="font-medium text-sm">{item.label}</p>
            <p className="mt-2 max-w-3xl text-base">{item.body}</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {item.sides.map((side) => (
                <li key={side.label}>
                  <Card>
                    <CardHeader>
                      <CardTitle>{side.label}</CardTitle>
                    </CardHeader>
                    <CardPanel>
                      <p>{side.text}</p>
                    </CardPanel>
                  </Card>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm">
              <span className="font-medium">{item.receiptLabel}</span> {item.receipt}
            </p>
          </TabsPanel>
        ))}
      </Tabs>
      <Accordion>
        <AccordionItem value="without">
          <AccordionTrigger>What happens without Silvector?</AccordionTrigger>
          <AccordionPanel>
            <ul className="flex flex-col gap-2 pb-4">
              <li>
                <strong className="text-foreground">Customer.</strong> The site blocks every agent.
                You get nothing.
              </li>
              <li>
                <strong className="text-foreground">Agent.</strong> Refused at the door. The person
                who sent you gets nothing.
              </li>
              <li>
                <strong className="text-foreground">Seller.</strong> The customer's agent is blocked
                with the rest.
              </li>
              <li>
                <strong className="text-foreground">The door.</strong> Nobody writes down who sent
                the agent.
              </li>
            </ul>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
