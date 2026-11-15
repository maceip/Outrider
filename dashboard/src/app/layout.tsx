import type {Metadata} from "next";
import type {ReactNode} from "react";

import {Toast} from "@heroui/react";
import {JetBrains_Mono, Unbounded} from "next/font/google";

import {CoreProvider} from "../lib/core-store";

import "./globals.css";

const unbounded = Unbounded({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-custom-unbounded",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-custom-jetbrains-mono",
  weight: ["400", "500", "600", "700"],
});

const WEBMCP_ORIGIN_TRIAL_TOKEN =
  "A/h8mpmc7Ym1LKQeIQMQ2NG8Tosq469/Pk04jVBhwrEMKVjNKhqeNZz1Js6I61E9vLmF8wRkQguqkCYtFatiJggAAABbeyJvcmlnaW4iOiJodHRwOi8vbG9jYWxob3N0OjgwIiwiZmVhdHVyZSI6IldlYk1DUCIsImV4cGlyeSI6MTgwNjM2NDgwMCwiaXNUaGlyZFBhcnR5Ijp0cnVlfQ==";

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("outrider.theme");var d=document.documentElement;if(t==="brutalism-light"){d.dataset.theme="brutalism-light";d.classList.remove("dark","brutalism-dark");d.classList.add("light","brutalism-light");}else{d.dataset.theme="brutalism-dark";d.classList.remove("light","brutalism-light");d.classList.add("dark","brutalism-dark");}}catch(e){}})();`;

export const metadata: Metadata = {
  description: "Local HTTP & MCP Gateway",
  title: "Outrider",
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html
      suppressHydrationWarning
      className={`dark brutalism-dark bg-background text-foreground ${unbounded.variable} ${jetbrainsMono.variable}`}
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
