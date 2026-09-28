import Link from "next/link";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Authright_Sharing",
  description: "A shared reading list for your team.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header>
            <Link className="brand" href="/">
              Authright_Sharing<span>TEAM READING ROOM</span>
            </Link>
            <nav>
              <Link href="/">Home</Link>
              <Link href="/library">Library</Link>
              <Link href="/account">Account</Link>
            </nav>
          </header>
          {children}
          <footer>Good links. Shared context.</footer>
        </div>
      </body>
    </html>
  );
}
