"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <h1>Unable to load this page.</h1>
      <p>Your saved links are still in the library. Try again in a moment.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
