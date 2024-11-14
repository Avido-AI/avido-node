import context from "./context";
import type { WrappableFn } from "./types";

type ChainableContext<T extends (...args: any) => any> = {
  target: any;
  next: (target: any) => Promise<ReturnType<T>>;
};

/**
 * Inject a previous run ID into the context
 * For example, to tie back to frontend events
 * @param {string} runId - Previous run ID
 */
async function setParent<T extends WrappableFn>(
  this: ChainableContext<T>,
  runId: string
): Promise<ReturnType<T>> {
  const { target, next } = this;

  return context.runId.callAsync(runId, async () => {
    return next(target);
  });
}

export default {
  setParent,
};
