import type { Metadata, Viewport } from "next";
import { ADMIN_URL, DESCRIPTION, ORIGIN, share } from "@/lib/seo";
import { Fjalla_One, Figtree, Inter } from "next/font/google";
import "@/styles/globals.scss";
import "@/styles/pro.scss";
import { AppProvider } from "@/components/AppProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fjalla = Fjalla_One({ weight: "400", subsets: ["latin"], variable: "--font-fjalla" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });

const TITLE = "DIP Admin: organizer portal";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: { default: TITLE, template: "%s | DIP Admin" },
  description: DESCRIPTION,
  applicationName: "DIP Admin",
  alternates: { canonical: ADMIN_URL },
  robots: { index: false, follow: false },
  manifest: `${ORIGIN}/img/admin/site.webmanifest`,
  icons: {
    icon: [
      { url: `${ORIGIN}/img/admin/favicon-32.png`, sizes: "32x32", type: "image/png" },
      { url: `${ORIGIN}/img/admin/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${ORIGIN}/img/admin/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: `${ORIGIN}/img/admin/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
  },
  ...share(TITLE, DESCRIPTION),
};

export const viewport: Viewport = {
  themeColor: "#7B88FA", // the portal is light-only, so one colour in both schemes
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fjalla.variable} ${figtree.variable}`}>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
