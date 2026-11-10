import { resolveTheme } from "@/lib/themes";

/**
 * A theme's bundled illustration on its accent colour (never a photo). Unknown keys get the neutral gray
 * fallback with no illustration, so a future theme never breaks the list. Decorative: titles sit beside it.
 */
export function ThemeArt({ url, title = "", className = "" }: { url: string; title?: string; className?: string }) {
  const theme = resolveTheme(url, title);
  return (
    <div className={`theme-art ${className}`} style={{ background: theme.accent }} aria-hidden>
      {theme.illustration
        // eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images
        ? <img src={theme.illustration} alt="" />
        : <span className="fallback">{theme.displayName}</span>}
    </div>
  );
}
