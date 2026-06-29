import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mahjong Family Table",
  description: "Accessible American Mahjong rooms for family and friends."
};

export default function RootLayout(props: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{props.children}</body>
    </html>
  );
}
