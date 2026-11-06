import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { getEnv } from "@/env";
import { BRAND_HEX, SITE } from "@/lib/site";
import "./globals.css";

// Self-hosted (OFL fonts, files in ./fonts): no request to Google at build or run time.
const fredoka = localFont({
  src: [
    { path: "./fonts/fredoka-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/fredoka-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--font-fredoka",
  display: "swap",
});
const nunito = localFont({
  src: [
    { path: "./fonts/nunito-sans-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/nunito-sans-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-nunito",
  display: "swap",
});
const dmMono = localFont({
  src: [
    { path: "./fonts/dm-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/dm-mono-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--font-dmmono",
  display: "swap",
});

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(getEnv().APP_URL),
    title: { default: `${SITE.name} · ${SITE.tagline}`, template: `%s · ${SITE.name}` },
    description: SITE.description,
    applicationName: SITE.name,
    openGraph: { type: "website", siteName: SITE.name, locale: SITE.locale, title: SITE.name, description: SITE.description },
    twitter: { card: "summary_large_image" },
    appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "default" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND_HEX.tomato },
    { media: "(prefers-color-scheme: dark)", color: BRAND_HEX.darkPaper },
  ],
  viewportFit: "cover",
};

// Runs before first paint so there is no flash of the wrong theme. Stamped with the request's CSP nonce.
// Only an explicit choice needs a class; the system preference is handled by CSS alone (globals.css).
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.classList.add(t);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
