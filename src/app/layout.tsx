import type { ReactNode } from "react";

// The root layout defers to src/app/[locale]/layout.tsx.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
