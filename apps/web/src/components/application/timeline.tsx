import { timelineSentence } from "./labels";
import type { ApplicationView } from "./types";

// The full, append-only history, newest first.
export function Timeline({ application }: { application: ApplicationView }) {
  const contacts = Object.fromEntries(application.contacts.map((contact) => [contact.id, contact.name]));
  const events = [...application.events].sort((a, b) => b.sequence - a.sequence);
  return (
    <section className="application-section" aria-labelledby="timeline-title">
      <h3 id="timeline-title">History</h3>
      <ol className="application-timeline" aria-label="Application history">
        {events.map((event) => (
          <li key={event.id}>
            <time dateTime={event.createdAt}>{event.createdAt.slice(0, 16).replace("T", " ")} UTC</time>
            <span>{timelineSentence(event, { contacts })}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
