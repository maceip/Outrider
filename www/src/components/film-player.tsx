export function FilmPlayer({
  file,
  label,
  poster,
}: {
  file: string;
  label: string;
  poster?: string;
}) {
  const base = `/media/film/${file}`;
  return (
    <video
      className="aspect-video w-full rounded-2xl border bg-card"
      controls
      playsInline
      preload="metadata"
      width={1280}
      height={720}
      poster={poster ?? `${base}-poster.jpg`}
      aria-label={label}
    >
      <source src={`${base}.mp4`} type="video/mp4" />
      <track kind="captions" srcLang="en" label="English" src={`${base}.vtt`} />
    </video>
  );
}
