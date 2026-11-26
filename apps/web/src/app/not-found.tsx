import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>This page or opportunity does not exist. It may have been removed, or the link may be wrong.</p>
      <p>
        <Link href="/">Go to the dashboard</Link>
      </p>
    </main>
  );
}
