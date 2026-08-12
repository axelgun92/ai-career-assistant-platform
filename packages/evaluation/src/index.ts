export interface EvaluationStage<TContext, TResult> {
  readonly id: string;
  evaluate(context: TContext): Promise<TResult>;
}

export interface DomainEvaluator<TOpportunity, TProfile, TResult> {
  evaluate(opportunity: TOpportunity, userProfile: TProfile): Promise<TResult>;
}
