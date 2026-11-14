import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DayStrip } from "@/components/day-strip";
import { DoorForm } from "@/components/door-form";
import { FilmPlayer } from "@/components/film-player";
import { VisitBoard } from "@/components/visit-board";
import { diagrams, filmCards } from "@/content";

export function HomePage() {
  useEffect(() => {
    document.title = "One visit, four sides · Silvector";
  }, []);

  return (
    <>
      <section className="border-b" aria-labelledby="p-title">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-16">
          <p className="text-muted-foreground text-sm">Perspectives</p>
          <h1 id="p-title" className="font-heading text-4xl tracking-tight sm:text-5xl">
            One visit. Four sides.
          </h1>
          <p className="text-lg">
            A person sends a shopping agent to a shop. Silvector stands at the door, decides what
            that agent may do, and signs a receipt. The person, the agent, and the shop all read
            the same one.
          </p>
          <p className="text-muted-foreground">
            The shop runs Silvector. The agent does not install it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button render={<a href="#board" />}>Step through the visit</Button>
            <Button
              variant="outline"
              render={<a href="https://demo.silvector.com/#/perspectives/walkthrough" />}
            >
              Investor walkthrough
            </Button>
          </div>
        </div>
      </section>

      <section className="border-b" aria-labelledby="films-title">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-14">
          <h2 id="films-title" className="font-heading text-2xl tracking-tight">
            Four films. Same visit.
          </h2>
          <p className="text-muted-foreground">
            Press play. Nothing starts on its own. The voice is synthetic. Captions are in the
            picture.
          </p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {filmCards.map((film) => (
              <li key={film.slug}>
                <Card
                  className="overflow-hidden"
                  render={<Link to={`/${film.slug}`} />}
                >
                  <img
                    src={`/media/film/${film.file}-poster.jpg`}
                    alt=""
                    width={1280}
                    height={720}
                    className="aspect-video w-full object-cover"
                  />
                  <span className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="font-medium">{film.title}</span>
                    <Badge variant="secondary">{film.seconds} seconds</Badge>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-b" aria-labelledby="board-title">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-14">
          <h2 id="board-title" className="font-heading text-2xl tracking-tight">
            Five steps. One receipt.
          </h2>
          <p className="text-muted-foreground">
            Greet, assess, verify, permit or step up, log. Pick a step. All four sides show that
            moment.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {diagrams.map((diagram) => (
              <figure key={diagram.src} className="overflow-hidden rounded-2xl border bg-card">
                <img src={diagram.src} alt={diagram.alt} width={640} height={360} className="w-full" />
                <figcaption className="px-3 py-2 text-sm">{diagram.caption}</figcaption>
              </figure>
            ))}
          </div>
          <VisitBoard />
        </div>
      </section>

      <section className="border-b" aria-labelledby="day-title">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-14">
          <h2 id="day-title" className="font-heading text-2xl tracking-tight">
            One visit is a story. A day is a pattern.
          </h2>
          <DayStrip />
        </div>
      </section>

      <section className="border-b" aria-labelledby="film-title">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-14">
          <h2 id="film-title" className="font-heading text-2xl tracking-tight">
            Silvector's view, in 80 seconds.
          </h2>
          <p>
            <Link className="underline-offset-4 hover:underline" to="/silvector">
              Open it on its own page
            </Link>
            .
          </p>
          <FilmPlayer file="silvector-view" label="Film: Silvector's view. 80 seconds, captioned." />
          <p className="text-muted-foreground text-sm">
            80 seconds. Captions are in the picture, and a captions track is in the player menu.
            The narration is a synthetic voice.
          </p>
        </div>
      </section>

      <section className="border-b" aria-labelledby="door-title">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-14">
          <h2 id="door-title" className="font-heading text-2xl tracking-tight">
            Is the shop door ready?
          </h2>
          <DoorForm />
        </div>
      </section>

      <section aria-labelledby="next-title">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-14">
          <h2 id="next-title" className="font-heading text-2xl tracking-tight">
            If you want the rest
          </h2>
          <ul className="flex flex-col gap-2">
            <li>
              <a
                className="underline-offset-4 hover:underline"
                href="https://demo.silvector.com/#/perspectives"
              >
                The same visit in the demo
              </a>
              , with the receipt beside each step.
            </li>
            <li>
              <a
                className="underline-offset-4 hover:underline"
                href="https://demo.silvector.com/#/perspectives/walkthrough"
              >
                Investor walkthrough
              </a>
              . Starts at the door.
            </li>
            <li>
              <a
                className="underline-offset-4 hover:underline"
                href="https://www.silvector.com/how-silvector-decides"
              >
                How Silvector decides
              </a>
              . One page for a technical review.
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
