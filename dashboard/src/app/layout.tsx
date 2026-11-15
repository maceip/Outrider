import type {Metadata} from "next";
import type {ReactNode} from "react";

import {Toast} from "@heroui/react";

import {CoreProvider} from "../lib/core-store";

import "./globals.css";

const WEBMCP_ORIGIN_TRIAL_TOKEN =
  "A/h8mpmc7Ym1LKQeIQMQ2NG8Tosq469/Pk04jVBhwrEMKVjNKhqeNZz1Js6I61E9vLmF8wRkQguqkCYtFatiJggAAABbeyJvcmlnaW4iOiJodHRwOi8vbG9jYWxob3N0OjgwIiwiZmVhdHVyZSI6IldlYk1DUCIsImV4cGlyeSI6MTgwNjM2NDgwMCwiaXNUaGlyZFBhcnR5Ijp0cnVlfQ==";

export const metadata: Metadata = {
  description: "Local HTTP & MCP Gateway",
  title: "Outrider",
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html suppressHydrationWarning className="bg-background text-foreground" lang="en">
      <head>
        <meta content={WEBMCP_ORIGIN_TRIAL_TOKEN} httpEquiv="origin-trial" />
      </head>
      <body className="font-sans antialiased">
        <CoreProvider>{children}</CoreProvider>
        <Toast.Provider placement="bottom" />
      </body>
    </html>
  );
}
