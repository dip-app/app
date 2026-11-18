import { coverFor } from "@/lib/catalog";
import { asset } from "@/lib/asset";

/** Event photo from the default catalog. Decorative when the title is shown beside it. */
export function Cover({ url, className, alt = "", eager = false }: { url: string; className?: string; alt?: string; eager?: boolean }) {
  const cover = coverFor(url);
  if (!cover && !url) return <div className={className} aria-hidden style={{ background: "#CCCCCC" }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images
    <img className={className} src={cover?.image ?? asset("/img/events/fitness.jpg")} alt={alt} width={1200} height={675} loading={eager ? "eager" : "lazy"} draggable={false} />
  );
}
