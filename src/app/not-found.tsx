import Link from "next/link";
export default function NotFound() {
  return (
    <main>
      <h1>This share is unavailable.</h1>
      <p>It may have been withdrawn, or the link may be incorrect.</p>
      <Link href="/library">Return to library</Link>
    </main>
  );
}
