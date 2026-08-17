import type {
  ContradictionPresentation,
  EvidencePresentation,
} from "./types";

export function humanize(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  return String(value)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function ResultSection(props: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="result-section">
      <summary>
        <span className="section-title">{props.title}</span>
        <span className="section-summary">{props.summary}</span>
      </summary>
      <div className="section-content">{props.children}</div>
    </details>
  );
}

export function ClassificationBadge({ value }: { value: string }) {
  return <span className={`classification classification-${value.toLowerCase()}`}>{humanize(value)}</span>;
}

export function ScoreDisplay(props: {
  score: number;
  label: string;
  direction: string;
  explanation: string;
}) {
  return (
    <div className="score-display" aria-label={`${props.label}: ${props.score} out of 100`}>
      <div>
        <strong className="score-value">{props.score}</strong>
        <span aria-hidden="true"> / 100</span>
      </div>
      <div>
        <strong>{props.label}</strong>
        <p>{props.direction}</p>
      </div>
      <p className="score-explanation">{props.explanation}</p>
    </div>
  );
}

export function FindingList(props: {
  title: string;
  values: string[];
  empty?: string;
  tone?: "positive" | "concern" | "neutral";
}) {
  return (
    <div className={`finding-group finding-${props.tone ?? "neutral"}`}>
      <h4>{props.title}</h4>
      {props.values.length ? (
        <ul>{props.values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul>
      ) : (
        <p>{props.empty ?? "None identified."}</p>
      )}
    </div>
  );
}

export function EvidenceLinks(props: {
  references: string[];
  evidence: EvidencePresentation[];
}) {
  if (props.references.length === 0) return null;
  const byReference = new Map(props.evidence.map((item) => [item.referenceId, item]));
  const resolved = [...new Set(props.references)]
    .map((reference) => byReference.get(reference))
    .filter((item): item is EvidencePresentation => Boolean(item));
  if (resolved.length === 0) {
    return <p className="evidence-unavailable">Supporting evidence is unavailable.</p>;
  }
  return (
    <p className="evidence-links">
      Evidence: {resolved.map((item, index) => (
        <span key={item.id}>
          {index > 0 ? ", " : null}
          <a href={`#evidence-${item.id}`}>{item.claim}</a>
        </span>
      ))}
    </p>
  );
}

export function EvidenceLibrary({ evidence }: { evidence: EvidencePresentation[] }) {
  const unique = [...new Map(evidence.map((item) => [item.id, item])).values()];
  return (
    <ResultSection title="Evidence library" summary={`${unique.length} validated records`}>
      {unique.length ? (
        <div className="evidence-library">
          {unique.map((item) => {
            const profile = item.sourceType === "USER_PROFILE";
            return (
              <article
                className={`evidence-card ${profile ? "profile-evidence" : "job-evidence"}`}
                id={`evidence-${item.id}`}
                key={item.id}
              >
                <p className="evidence-kind">
                  {profile ? "Candidate profile evidence" : "Job-description evidence"}
                  {" · "}{humanize(item.origin)} · {humanize(item.evidenceLevel)}
                </p>
                <h4>{item.claim}</h4>
                {item.sourceText ? <blockquote>{item.sourceText}</blockquote> : null}
                <p className="evidence-source">
                  Source: {humanize(item.sourceType)}
                  {item.sourceField ? ` · ${humanize(item.sourceField)}` : ""}
                </p>
              </article>
            );
          })}
        </div>
      ) : <p>No evidence records are available.</p>}
    </ResultSection>
  );
}

export function ContradictionList(props: {
  contradictions: ContradictionPresentation[];
  evidence: EvidencePresentation[];
}) {
  if (!props.contradictions.length) return <p>No contradictions were recorded.</p>;
  const byId = new Map(props.evidence.map((item) => [item.id, item.referenceId]));
  return (
    <div className="contradiction-list">
      {props.contradictions.map((item) => (
        <article key={item.id} className="contradiction-card">
          <p className="evidence-kind">{humanize(item.resolutionStatus)} contradiction</p>
          <p><strong>Claim one:</strong> {item.claimA}</p>
          <p><strong>Claim two:</strong> {item.claimB}</p>
          <p>{item.interpretation}</p>
          {item.significance ? <p><strong>Why it matters:</strong> {item.significance}</p> : null}
          <EvidenceLinks
            references={[...item.evidenceIdsA, ...item.evidenceIdsB]
              .map((id) => byId.get(id))
              .filter((value): value is string => Boolean(value))}
            evidence={props.evidence}
          />
        </article>
      ))}
    </div>
  );
}
