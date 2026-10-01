import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";

import { AppProviders } from "@/components/providers/app-providers";
import { getI18n } from "@/lib/i18n/server";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: t.app.name, template: `%s · ${t.app.name}` },
    description: t.app.tagline,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#14161f" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const i18n = await getI18n();

  return (
    <html
      lang={i18n.locale}
      dir={i18n.dir}
      className={`${inter.variable} ${plexArabic.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh">
        <AppProviders locale={i18n.locale} dir={i18n.dir} timeZone={i18n.timeZone}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
