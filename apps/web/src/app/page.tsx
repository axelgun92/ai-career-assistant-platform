import { platformMetadata } from "@ai-career/core";

export default function HomePage() {
  return (
    <main>
      <h1>{platformMetadata.name}</h1>
      <p>Core platform foundation is running.</p>
    </main>
  );
}
