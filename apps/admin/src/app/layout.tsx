import type { Metadata } from "next";
import { Fjalla_One, Figtree, Inter } from "next/font/google";
import "@/styles/globals.scss";
import { AppProvider } from "@/components/AppProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fjalla = Fjalla_One({ weight: "400", subsets: ["latin"], variable: "--font-fjalla" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });

export const metadata: Metadata = {
  title: "DIP Admin",
  description: "Organizer portal for DIP company events.",
  robots: { index: false, follow: false },
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
