import { coverFor } from "@/lib/catalog";

export function Cover({ url, className }: { url: string; className?: string }) {
  const cover = coverFor(url);
  return (
    <div
      className={className}
      role="img"
      aria-label={cover ? `${cover.label} cover` : "No cover"}
      style={{ background: cover ? `linear-gradient(135deg, ${cover.from}, ${cover.to})` : "#ececec" }}
    />
  );
}
