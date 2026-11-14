import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FilmPlayer } from "@/components/film-player";
import { films } from "@/content";

export function FilmRoute() {
  const { slug } = useParams();
  const film = films.find((item) => item.slug === slug);

  useEffect(() => {
    document.title = film ? `${film.title} · Silvector` : "Silvector";
  }, [film]);

  if (!film) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="font-heading text-3xl">That page is not here.</h1>
        <p className="mt-4">
          <Link className="underline-offset-4 hover:underline" to="/">
            Back to Perspectives
          </Link>
        </p>
      </div>
    );
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-16">
      <p className="text-muted-foreground text-sm">{film.kicker}</p>
      <h1 className="font-heading text-4xl tracking-tight">{film.title}</h1>
      <p className="text-lg">{film.lede}</p>
      <FilmPlayer file={film.file} label={film.aria} />
      <p className="text-muted-foreground text-sm">
        {film.seconds} seconds. Captions are in the picture. The narration is a synthetic voice.
        Same visit, same receipt, as the other three films.
      </p>
      <h2 className="mt-4 font-heading text-xl">What to notice</h2>
      <ul className="flex list-disc flex-col gap-2 ps-5">
        {film.notices.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {film.previous ? (
          <Button variant="outline" render={<Link to={`/${film.previous.slug}`} />}>
            {film.previous.label}
          </Button>
        ) : null}
        {film.next ? (
          <Button render={<Link to={`/${film.next.slug}`} />}>{film.next.label}</Button>
        ) : null}
      </div>
    </section>
  );
}
