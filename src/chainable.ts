import context from "./context";
import type { WrappableFn } from "./types";

type ChainableContext<T extends WrappableFn> = {
  target: any;
  next: (target: any) => Promise<ReturnType<T>>;
};

/**
 * Inject the parent run ID into the context
 * Use this to define the hierarchy of your thread
 * @param {string} runId - Previous run ID
 */
async function setParent<T extends WrappableFn>(
  this: ChainableContext<T>,
  runId: string
): Promise<ReturnType<T>> {
  const { target, next } = this;

  // Store the parent run ID in the target for tracking
  target._parentRunId = runId;

  return context.runId.callAsync(runId, async () => {
    return next(target);
  });
}

export default {
  setParent,
};
