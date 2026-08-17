import { describe, expect, it, vi } from "vitest";
import { createEvaluationPoller } from "../../apps/web/src/components/evaluation/poller";

describe("evaluation status polling", () => {
  it("moves through queued and running states and stops after completion", async () => {
    const values = ["PENDING", "RUNNING", "COMPLETED"] as const;
    const updates: string[] = [];
    const callbacks: Array<() => void> = [];
    const poller = createEvaluationPoller({
      fetchStatus: async () => values.shift() ?? "COMPLETED",
      shouldContinue: (value) => value === "PENDING" || value === "RUNNING",
      onUpdate: (value) => updates.push(value),
      onError: vi.fn(),
      schedule: (callback) => {
        callbacks.push(callback);
        return callbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: vi.fn(),
    });

    expect(poller.start()).toBe(true);
    expect(poller.start()).toBe(false);
    await vi.waitFor(() => expect(updates).toEqual(["PENDING"]));
    callbacks.shift()?.();
    await vi.waitFor(() => expect(updates).toEqual(["PENDING", "RUNNING"]));
    callbacks.shift()?.();
    await vi.waitFor(() => expect(updates).toEqual(["PENDING", "RUNNING", "COMPLETED"]));
    expect(poller.isActive()).toBe(false);
    expect(callbacks).toHaveLength(0);
  });

  it("stops immediately on terminal failure", async () => {
    const schedule = vi.fn();
    const poller = createEvaluationPoller({
      fetchStatus: async () => "FAILED",
      shouldContinue: (value) => value === "PENDING",
      onUpdate: vi.fn(),
      onError: vi.fn(),
      schedule,
    });
    poller.start();
    await vi.waitFor(() => expect(poller.isActive()).toBe(false));
    expect(schedule).not.toHaveBeenCalled();
  });

  it("cleans up scheduled work and an active request when stopped", async () => {
    const cancel = vi.fn();
    const callbacks: Array<() => void> = [];
    const poller = createEvaluationPoller({
      fetchStatus: async () => "PENDING",
      shouldContinue: () => true,
      onUpdate: vi.fn(),
      onError: vi.fn(),
      schedule: (callback) => {
        callbacks.push(callback);
        return 42 as unknown as ReturnType<typeof setTimeout>;
      },
      cancel,
    });
    poller.start();
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    poller.stop();
    expect(cancel).toHaveBeenCalledWith(42);
    expect(poller.isActive()).toBe(false);
  });
});
