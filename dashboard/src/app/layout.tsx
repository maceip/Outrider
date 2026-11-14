import type {Metadata} from "next";
import type {ReactNode} from "react";

import {Toast} from "@heroui/react";

import {OperatorDialogs} from "../components/operator-dialogs";
import {OutriderProvider} from "../lib/outrider-store";

import "./globals.css";

export const metadata: Metadata = {
  description: "Dynamic MCP Commerce & CLEF Gateway",
  title: "Outrider",
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html suppressHydrationWarning className="bg-background text-foreground" lang="en">
      <body className="font-sans antialiased">
        <OutriderProvider>
          {children}
          <OperatorDialogs />
          <Toast.Provider placement="bottom" />
        </OutriderProvider>
      </body>
    </html>
  );
}
