import { coverFor } from "@/lib/catalog";

/** Event photo from the default catalog. Decorative when the title is shown beside it. */
export function Cover({ url, className, alt = "", eager = false }: { url: string; className?: string; alt?: string; eager?: boolean }) {
  const cover = coverFor(url);
  if (!cover && !url) return <div className={className} aria-hidden style={{ background: "#CCCCCC" }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images
    <img className={className} src={cover?.image ?? "/img/events/fitness.jpg"} alt={alt} loading={eager ? "eager" : "lazy"} />
  );
}
