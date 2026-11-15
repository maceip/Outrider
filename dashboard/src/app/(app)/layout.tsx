import type {ReactNode} from "react";

import {AppShell} from "../../components/app-shell";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";

export default function AppGroupLayout({children}: {children: ReactNode}) {
  if (IS_WWW) {
    return children;
  }

  return <AppShell>{children}</AppShell>;
}
