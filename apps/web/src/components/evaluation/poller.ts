export interface EvaluationPollerOptions<T> {
  fetchStatus(signal: AbortSignal): Promise<T>;
  shouldContinue(value: T): boolean;
  onUpdate(value: T): void;
  onError(message: string): void;
  intervalMs?: number;
  maximumPolls?: number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

export function createEvaluationPoller<T>(options: EvaluationPollerOptions<T>) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const intervalMs = options.intervalMs ?? 1_500;
  const maximumPolls = options.maximumPolls ?? 80;
  let active = false;
  let polls = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  function stop() {
    active = false;
    if (timer !== null) cancel(timer);
    timer = null;
    controller?.abort();
    controller = null;
  }

  async function poll() {
    if (!active) return;
    if (polls >= maximumPolls) {
      stop();
      options.onError("Evaluation is taking longer than expected. Refresh to check again.");
      return;
    }
    polls += 1;
    controller = new AbortController();
    try {
      const value = await options.fetchStatus(controller.signal);
      if (!active) return;
      options.onUpdate(value);
      if (!options.shouldContinue(value)) {
        stop();
        return;
      }
      timer = schedule(() => {
        timer = null;
        void poll();
      }, intervalMs);
    } catch (error) {
      if (!active || (error instanceof Error && error.name === "AbortError")) return;
      stop();
      options.onError("Evaluation status could not be refreshed. Try again shortly.");
    }
  }

  return {
    start() {
      if (active) return false;
      active = true;
      polls = 0;
      void poll();
      return true;
    },
    stop,
    isActive() {
      return active;
    },
  };
}
