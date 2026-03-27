import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import { ThemeProvider } from "../components/theme-provider";
import { getSiteUrl, siteMetadata, socialImageSize } from "../lib/site-metadata";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "block",
  weight: ["400", "500", "600", "700", "800"],
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "block",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  applicationName: siteMetadata.applicationName,
  title: {
    default: siteMetadata.title,
    template: "%s | Hop",
  },
  description: siteMetadata.description,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "Hop",
    url: "/",
    title: siteMetadata.title,
    description: siteMetadata.description,
    images: [
      {
        url: "/opengraph-image",
        width: socialImageSize.width,
        height: socialImageSize.height,
        alt: siteMetadata.ogImageAlt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteMetadata.title,
    description: siteMetadata.description,
    images: ["/twitter-image"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/apple-touch-icon-167x167.png", sizes: "167x167", type: "image/png" },
      { url: "/apple-touch-icon-152x152.png", sizes: "152x152", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Hop",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f5f6fa",
};

const themeScript = `(function(){try{var t=localStorage.getItem("hop-theme");document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <body>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: intentional anti-FOUC theme script */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
