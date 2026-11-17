import type {Metadata} from "next";
import type {ReactNode} from "react";

import {Toast} from "@heroui/react";
import {Inter, JetBrains_Mono, Space_Grotesk} from "next/font/google";

import {CoreProvider} from "../lib/core-store";
import {WWW_BASE_PATH} from "../lib/www-base-path";

import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-custom-space-grotesk",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-custom-inter",
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-custom-jetbrains-mono",
  weight: ["400", "500", "600", "700"],
});

const WEBMCP_ORIGIN_TRIAL_TOKEN =
  "A/h8mpmc7Ym1LKQeIQMQ2NG8Tosq469/Pk04jVBhwrEMKVjNKhqeNZz1Js6I61E9vLmF8wRkQguqkCYtFatiJggAAABbeyJvcmlnaW4iOiJodHRwOi8vbG9jYWxob3N0OjgwIiwiZmVhdHVyZSI6IldlYk1DUCIsImV4cGlyeSI6MTgwNjM2NDgwMCwiaXNUaGlyZFBhcnR5Ijp0cnVlfQ==";

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("conduit.theme");var d=document.documentElement;if(t==="brutalism-light"){d.dataset.theme="brutalism-light";d.classList.remove("dark","brutalism-dark");d.classList.add("light","brutalism-light");}else{d.dataset.theme="brutalism-dark";d.classList.remove("light","brutalism-light");d.classList.add("dark","brutalism-dark");}}catch(e){}})();`;

export const metadata: Metadata = {
  description:
    "Local control plane for AI agent commerce: live traffic visibility, pricing guardrails, and scoped checkout passes.",
  icons: {
    apple: [
      {
        sizes: "256x256",
        type: "image/png",
        url: `${WWW_BASE_PATH}/brand/dark/conduit-logo-256.png`,
      },
    ],
    icon: [
      {
        media: "(prefers-color-scheme: dark)",
        type: "image/x-icon",
        url: `${WWW_BASE_PATH}/brand/favicon-dark.ico`,
      },
      {
        media: "(prefers-color-scheme: light)",
        type: "image/x-icon",
        url: `${WWW_BASE_PATH}/brand/favicon-light.ico`,
      },
      {
        media: "(prefers-color-scheme: dark)",
        sizes: "32x32",
        type: "image/png",
        url: `${WWW_BASE_PATH}/brand/dark/conduit-icon-32.png`,
      },
      {
        media: "(prefers-color-scheme: light)",
        sizes: "32x32",
        type: "image/png",
        url: `${WWW_BASE_PATH}/brand/light/conduit-icon-32.png`,
      },
      {
        media: "(prefers-color-scheme: dark)",
        sizes: "64x64",
        type: "image/png",
        url: `${WWW_BASE_PATH}/brand/dark/conduit-icon-64.png`,
      },
      {
        media: "(prefers-color-scheme: light)",
        sizes: "64x64",
        type: "image/png",
        url: `${WWW_BASE_PATH}/brand/light/conduit-icon-64.png`,
      },
    ],
    shortcut: `${WWW_BASE_PATH}/brand/favicon-dark.ico`,
  },
  title: "Conduit",
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html
      suppressHydrationWarning
      className={`dark brutalism-dark bg-background text-foreground ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      data-theme="brutalism-dark"
      lang="en"
    >
      <head>
        <meta content={WEBMCP_ORIGIN_TRIAL_TOKEN} httpEquiv="origin-trial" />
        <script dangerouslySetInnerHTML={{__html: THEME_INIT_SCRIPT}} />
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        <CoreProvider>{children}</CoreProvider>
        <Toast.Provider placement="bottom" />
      </body>
    </html>
  );
}
