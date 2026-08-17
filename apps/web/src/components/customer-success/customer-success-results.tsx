import {
  ClassificationBadge,
  ContradictionList,
  EvidenceLibrary,
  EvidenceLinks,
  FindingList,
  ResultSection,
  ScoreDisplay,
  humanize,
} from "../evaluation/shared-results";
import type {
  EvaluationPresentation,
  OpportunityPresentation,
} from "../evaluation/types";

type Data = Record<string, unknown>;

function data(value: unknown): Data {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Data
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "Unknown"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function references(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === "string");
}

function findings(value: unknown): string[] {
  return list(value).flatMap((item) => {
    if (typeof item === "string") return [item];
    const entry = data(item);
    const candidate =
      entry.finding ?? entry.description ?? entry.recommendation ?? entry.conclusion;
    return typeof candidate === "string" ? [candidate] : [];
  });
}

function unknowns(value: unknown): string[] {
  return list(value).flatMap((item) => {
    if (typeof item === "string") return [item];
    const entry = data(item);
    if (typeof entry.description !== "string") return [];
    return [entry.materiality
      ? `${entry.description} — ${String(entry.materiality)}`
      : entry.description];
  });
}

function bool(value: unknown): boolean {
  return value === true;
}

function summaryOf(container: Data, nestedKey: string, fallback: string) {
  if (!bool(container.evaluated)) return text(container.reason, "Not evaluated");
  const nested = data(container[nestedKey]);
  return text(nested.summary ?? nested.alignmentSummary ?? nested.assessment, fallback);
}

function maturityLabel(score: number) {
  if (score < 20) return "Very Low";
  if (score < 40) return "Low";
  if (score < 60) return "Mixed or Moderate";
  if (score < 80) return "Good or High";
  return "Very Strong or Very High";
}

function Criterion(props: {
  label: string;
  value: unknown;
  evidence: EvaluationPresentation["evidence"];
}) {
  const item = data(props.value);
  return (
    <div className="criterion">
      <h4>{props.label}</h4>
      {item.classification ? <ClassificationBadge value={text(item.classification)} /> : null}
      {item.result ? <ClassificationBadge value={text(item.result)} /> : null}
      <p>{text(item.explanation ?? item.conclusion)}</p>
      <EvidenceLinks references={references(item.evidenceReferences)} evidence={props.evidence} />
    </div>
  );
}

function NotEvaluated({ reason }: { reason: unknown }) {
  return <p className="status-note">Not evaluated: {text(reason)}</p>;
}

export function CustomerSuccessResults(props: {
  opportunity: OpportunityPresentation;
  evaluation: EvaluationPresentation;
}) {
  const { evaluation, opportunity } = props;
  const result = data(evaluation.result);
  const recommendation = evaluation.recommendation;
  const hardFilters = data(result.hardFilters);
  const reconstruction = data(hardFilters.reconstruction);
  const travel = data(reconstruction.travel);
  const travelDisplay = travel.purpose
    ? [humanize(travel.purpose), travel.frequency, travel.statedPercentage === null
      ? null
      : `${travel.statedPercentage}%`].filter(Boolean).join(" · ")
    : "Unknown";

  const job = data(result.jobEvaluation);
  const jobEvaluation = data(job.evaluation);
  const company = data(result.companyAlignment);
  const alignment = data(company.alignment);
  const maturityContainer = data(result.organizationalMaturity);
  const maturity = data(maturityContainer.maturity);
  const alexContainer = data(result.alexFit);
  const alex = data(alexContainer.fit);
  const burnoutContainer = data(result.burnoutRisk);
  const burnout = data(burnoutContainer.risk);
  const resumeContainer = data(result.resumeMatch);
  const resume = data(resumeContainer.match);
  const seniority = data(resume.effectiveSeniority);
  const priorityContainer = data(result.opportunityPriority);
  const priority = data(priorityContainer.priority);
  const timing = data(priorityContainer.timing);
  const ghostContainer = data(result.ghostJobRisk);
  const ghost = data(ghostContainer.risk);

  const recommendationUnknowns = unknowns(recommendation?.unknowns);
  const reviewConditions = unknowns(recommendation?.reviewConditions);

  return (
    <div className="results-experience">
      <header className="opportunity-hero">
        <p className="eyebrow">Customer Success evaluation</p>
        <h1>{opportunity.title}</h1>
        <p className="company-name">{opportunity.company}</p>
        <dl className="opportunity-facts">
          <div><dt>Salary</dt><dd>{opportunity.salary}</dd></div>
          <div><dt>Location</dt><dd>{opportunity.location}</dd></div>
          <div><dt>Work arrangement</dt><dd>{opportunity.workArrangement}</dd></div>
          <div><dt>Time zone</dt><dd>{opportunity.timeZoneRequirements}</dd></div>
          <div><dt>Travel</dt><dd>{travelDisplay}</dd></div>
        </dl>
      </header>

      {recommendation ? (
        <section className="recommendation-panel" aria-labelledby="recommendation-title">
          <div>
            <p className="eyebrow">Final recommendation</p>
            <h2 id="recommendation-title">
              <ClassificationBadge value={recommendation.decision} />
            </h2>
          </div>
          <p className="recommendation-explanation">{recommendation.explanation}</p>
          <EvidenceLinks references={recommendation.evidenceReferences} evidence={evaluation.evidence} />
          <div className="decision-grid">
            <FindingList title="Major strengths" values={findings(recommendation.strongestPositives)} tone="positive" />
            <FindingList title="Major concerns" values={findings(recommendation.strongestConcerns)} tone="concern" />
            <FindingList title="Important unknowns" values={recommendationUnknowns} empty="No decision-relevant unknowns." />
            <FindingList title="Review conditions" values={reviewConditions} empty="No additional review conditions." />
          </div>
        </section>
      ) : (
        <section className="status-note"><h2>Recommendation unavailable</h2><p>This evaluation did not produce a persisted recommendation.</p></section>
      )}

      <section aria-labelledby="assessment-title">
        <p className="eyebrow">Detailed assessment</p>
        <h2 id="assessment-title">Customer Success evaluation</h2>

        <ResultSection title="Hard Filters" summary={`${humanize(hardFilters.overall)} · ${humanize(data(hardFilters.role).classification)}`}>
          <div className="criterion-grid">
            <Criterion label="Actual role" value={hardFilters.role} evidence={evaluation.evidence} />
            <Criterion label="Salary" value={hardFilters.salary} evidence={evaluation.evidence} />
            <Criterion label="Location" value={hardFilters.location} evidence={evaluation.evidence} />
            <Criterion label="Work arrangement" value={hardFilters.workArrangement} evidence={evaluation.evidence} />
            <Criterion label="Travel" value={hardFilters.travel} evidence={evaluation.evidence} />
          </div>
          <dl className="compact-facts">
            <div><dt>Time-zone requirements</dt><dd>{findings(data(reconstruction.location).timeZoneRequirements).join(", ") || "Unknown"}</dd></div>
            <div><dt>Salary disclosure</dt><dd>{humanize(data(reconstruction.salary).disclosure)}</dd></div>
            <div><dt>Travel purpose</dt><dd>{humanize(travel.purpose)}</dd></div>
          </dl>
        </ResultSection>

        <ResultSection title="Job Evaluation" summary={summaryOf(job, "evaluation", "Practical work assessment")}>
          {!bool(job.evaluated) ? <NotEvaluated reason={job.reason} /> : <>
            <p>{text(jobEvaluation.practicalSummary)}</p>
            <FindingList title="Primary work" values={findings(jobEvaluation.primaryWork)} />
            <div className="criterion-grid">
              <Criterion label="Customer lifecycle" value={jobEvaluation.customerLifecycleInvolvement} evidence={evaluation.evidence} />
              <Criterion label="Customer ownership" value={jobEvaluation.customerOwnership} evidence={evaluation.evidence} />
              <Criterion label="Strategic responsibility" value={jobEvaluation.strategicResponsibility} evidence={evaluation.evidence} />
              <Criterion label="Technical exposure" value={jobEvaluation.technicalExposure} evidence={evaluation.evidence} />
              <Criterion label="Commercial responsibility" value={jobEvaluation.commercialResponsibility} evidence={evaluation.evidence} />
              <Criterion label="Cross-functional work" value={jobEvaluation.crossFunctionalInvolvement} evidence={evaluation.evidence} />
              <Criterion label="Business impact" value={jobEvaluation.businessImpact} evidence={evaluation.evidence} />
              <Criterion label="Strategic Bridge Value" value={jobEvaluation.strategicBridgeValue} evidence={evaluation.evidence} />
            </div>
            <FindingList title="Unknowns" values={unknowns(jobEvaluation.unknowns)} />
          </>}
        </ResultSection>

        <ResultSection title="Company Alignment" summary={summaryOf(company, "alignment", "Company alignment assessment")}>
          {!bool(company.evaluated) ? <NotEvaluated reason={company.reason} /> : <>
            <p>{text(alignment.alignmentSummary)}</p>
            <div className="criterion-grid">
              <Criterion label="Business model" value={alignment.businessModel} evidence={evaluation.evidence} />
              <Criterion label="Customer type" value={alignment.customerType} evidence={evaluation.evidence} />
              <Criterion label="Product type" value={alignment.productType} evidence={evaluation.evidence} />
              <Criterion label="Customer segment" value={alignment.customerSegment} evidence={evaluation.evidence} />
            </div>
            <FindingList title="Strategic advantages" values={findings(alignment.strategicAdvantages)} tone="positive" />
            <FindingList title="Potential concerns" values={findings(alignment.potentialConcerns)} tone="concern" />
            <FindingList title="Unknowns" values={unknowns(alignment.unknowns)} />
          </>}
        </ResultSection>

        <ResultSection title="Organizational Maturity" summary={summaryOf(maturityContainer, "maturity", "Organizational maturity assessment")}>
          {!bool(maturityContainer.evaluated) ? <NotEvaluated reason={maturityContainer.reason} /> : <>
            <ScoreDisplay
              score={number(maturity.score) ?? 0}
              label={maturityLabel(number(maturity.score) ?? 0)}
              direction="Higher means a more established Customer Success operating environment."
              explanation={text(maturity.scoreExplanation)}
            />
            <div className="criterion-grid">
              <Criterion label="Existing Customer Success function" value={maturity.existingCustomerSuccessFunction} evidence={evaluation.evidence} />
              <Criterion label="Customer operating model" value={maturity.customerOperatingModel} evidence={evaluation.evidence} />
            </div>
            <h4>Ownership and cross-functional design</h4>
            <p>{text(data(maturity.ownershipAndCrossFunctionalDesign).summary)}</p>
            <FindingList title="Positive maturity signals" values={findings(maturity.positiveSignals)} tone="positive" />
            <FindingList title="Weak maturity signals" values={findings(maturity.weakSignals)} tone="concern" />
            <FindingList title="Unknowns" values={unknowns(maturity.unknowns)} />
          </>}
        </ResultSection>

        <ResultSection title="Alex Fit" summary={bool(alexContainer.evaluated) ? `${humanize(alex.classification)} · ${text(alex.summary)}` : text(alexContainer.reason, "Not evaluated")}>
          {!bool(alexContainer.evaluated) ? <NotEvaluated reason={alexContainer.reason} /> : <>
            <ClassificationBadge value={text(alex.classification)} />
            <p>{text(alex.summary)}</p>
            <Criterion label="Experience alignment" value={alex.experienceAlignment} evidence={evaluation.evidence} />
            <Criterion label="Career strategy" value={alex.careerStrategyAlignment} evidence={evaluation.evidence} />
            <FindingList title="Strongest matches" values={findings(alex.strongestMatches)} tone="positive" />
            <FindingList title="Partial matches" values={findings(alex.partialMatches)} />
            <FindingList title="Concerns" values={findings(alex.concerns)} tone="concern" />
            <FindingList title="Strategic value" values={findings(alex.strategicValue)} />
            <FindingList title="Working-style findings" values={list(alex.workingStyleAlignment).map((item) => `${humanize(data(item).alignment)}: ${text(data(item).explanation)}`)} />
            <FindingList title="Unknowns" values={unknowns(alex.unknowns)} />
          </>}
        </ResultSection>

        <ResultSection title="Burnout Risk" summary={bool(burnoutContainer.evaluated) ? `${humanize(burnoutContainer.classification)} · ${text(burnout.summary)}` : text(burnoutContainer.reason, "Not evaluated")}>
          {!bool(burnoutContainer.evaluated) ? <NotEvaluated reason={burnoutContainer.reason} /> : <>
            <ScoreDisplay
              score={number(burnout.score) ?? 0}
              label={humanize(burnoutContainer.classification)}
              direction="Higher means greater burnout risk."
              explanation={text(burnout.scoreExplanation)}
            />
            <FindingList title="Primary workload concerns" values={findings(burnout.majorContributors)} tone="concern" />
            <FindingList title="Healthy scope signals" values={findings(burnout.positiveIndicators)} tone="positive" />
            <FindingList title="Unknowns" values={unknowns(burnout.unknowns)} />
          </>}
        </ResultSection>

        <ResultSection title="Resume Match" summary={bool(resumeContainer.evaluated) ? `${humanize(resumeContainer.band)} · ${text(resume.summary)}` : text(resumeContainer.reason, "Not evaluated")}>
          {!bool(resumeContainer.evaluated) ? <NotEvaluated reason={resumeContainer.reason} /> : <>
            <ScoreDisplay
              score={number(resume.score) ?? 0}
              label={humanize(resumeContainer.band)}
              direction="Higher means stronger evidence-backed Resume Match."
              explanation={text(resume.scoreExplanation)}
            />
            <div className="effective-level">
              <p className="eyebrow">Effective Level</p>
              <ClassificationBadge value={text(seniority.effectiveLevelFit)} />
              <p>{text(seniority.explanation)}</p>
            </div>
            <FindingList title="Strong matches" values={findings(resume.strongStrengths)} tone="positive" />
            <FindingList title="Partial and transferable matches" values={findings(resume.partialMatches)} />
            <FindingList title="Genuine gaps" values={findings(resume.genuineGaps)} tone="concern" />
            <FindingList title="Unknown requirements" values={unknowns(resume.unknowns)} />
            <FindingList title="Positioning recommendations" values={findings(resume.positioningRecommendations)} />
            <h4>Requirement assessments</h4>
            <div className="requirement-list">
              {list(resume.requirementAssessments).map((value, index) => {
                const item = data(value);
                return <article className="requirement-card" key={`${text(item.requirementText)}-${index}`}>
                  <h5>{text(item.requirementText)}</h5>
                  <p>
                    <ClassificationBadge value={text(item.classification)} />{" "}
                    {humanize(item.strength)} · {humanize(item.matchedExperienceSpecificity)}
                  </p>
                  <p>{text(item.explanation)}</p>
                  <p><strong>Decision impact:</strong> {humanize(item.decisionImpact)} — {text(item.decisionImpactExplanation)}</p>
                  <EvidenceLinks
                    references={[...references(item.jdEvidenceReferences), ...references(item.profileEvidenceReferences)]}
                    evidence={evaluation.evidence}
                  />
                </article>;
              })}
            </div>
          </>}
        </ResultSection>

        <ResultSection title="Effective Level" summary={bool(resumeContainer.evaluated) ? humanize(seniority.effectiveLevelFit) : "Not evaluated"}>
          {!bool(resumeContainer.evaluated) ? <NotEvaluated reason={resumeContainer.reason} /> : <>
            <ClassificationBadge value={text(seniority.effectiveLevelFit)} />
            <p>{text(seniority.explanation)}</p>
            <Criterion label="Actual responsibility seniority" value={seniority.actualResponsibilitySeniority} evidence={evaluation.evidence} />
            <EvidenceLinks references={references(seniority.evidenceReferences)} evidence={evaluation.evidence} />
          </>}
        </ResultSection>

        <ResultSection title="Opportunity Priority" summary={bool(priorityContainer.evaluated) ? `${humanize(priorityContainer.band)} · ${text(priority.strategicValueSummary)}` : text(priorityContainer.reason, "Not evaluated")}>
          {!bool(priorityContainer.evaluated) ? <NotEvaluated reason={priorityContainer.reason} /> : <>
            <ScoreDisplay
              score={number(priority.score) ?? 0}
              label={humanize(priorityContainer.band)}
              direction="Higher means greater application priority, not overall job quality."
              explanation={text(priority.scoreExplanation)}
            />
            <p><strong>Timing:</strong> {humanize(timing.classification)} — {text(timing.explanation)}</p>
            <p><strong>Posting age:</strong> {timing.ageDays === null ? "Unknown" : `${timing.ageDays} days`}</p>
            <Criterion label="Application effort" value={priority.applicationEffort} evidence={evaluation.evidence} />
            <p><strong>Strategic value:</strong> {text(priority.strategicValueSummary)}</p>
            <FindingList title="Reasons to prioritize" values={findings(priority.reasonsForPrioritization)} tone="positive" />
            <FindingList title="Reasons for reduced priority" values={findings(priority.reasonsForReducedPriority)} tone="concern" />
            <FindingList title="Unknowns" values={unknowns(priority.unknowns)} />
          </>}
        </ResultSection>

        <ResultSection title="Ghost Job Risk" summary={bool(ghostContainer.evaluated) ? `${humanize(ghost.classification)} · ${text(ghost.assessment)}` : text(ghostContainer.reason, "Not evaluated")}>
          {!bool(ghostContainer.evaluated) ? <NotEvaluated reason={ghostContainer.reason} /> : <>
            <ClassificationBadge value={text(ghost.classification)} />
            <p>{text(ghost.assessment)}</p>
            <p>{text(ghost.interpretation)}</p>
            {ghost.classification === "UNKNOWN" ? (
              <p className="unknown-callout">Unknown does not mean Low Risk. Available posting-history evidence is insufficient for a supported classification.</p>
            ) : null}
            <FindingList title="Unknowns" values={unknowns(ghost.unknowns)} />
            <EvidenceLinks references={references(ghost.evidenceReferences)} evidence={evaluation.evidence} />
          </>}
        </ResultSection>

        <ResultSection title="Contradictions" summary={`${evaluation.contradictions.length} recorded`}>
          <ContradictionList contradictions={evaluation.contradictions} evidence={evaluation.evidence} />
        </ResultSection>

        <EvidenceLibrary evidence={evaluation.evidence} />
      </section>

      <footer className="evaluation-metadata">
        <p>
          Evaluation {evaluation.versions.evaluation} · Rules {evaluation.versions.rules}
          {evaluation.versions.prompt ? ` · Prompt ${evaluation.versions.prompt}` : ""}
          {evaluation.versions.userProfile ? ` · Profile v${evaluation.versions.userProfile}` : ""}
        </p>
        <p>Completed {evaluation.completedAt ? new Date(evaluation.completedAt).toLocaleString() : "Unknown"}</p>
      </footer>
    </div>
  );
}
