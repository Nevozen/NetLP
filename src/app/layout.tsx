import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "LPStacks", template: "%s | LPStacks" },
  description:
    "Private liquidity journal and LP-vs-HODL analysis by Wardana Dev.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
