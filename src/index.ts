import { cleanError, generateUUID, getFunctionInput } from "./utils";

import type { TraceType, WrapParams, WrappableFn, WrappedFn, CallInfo, cJSON } from "./types";

import chainable from "./chainable";
import ctx from "./context";

import Avido from "./avido";

// Extended Avido class with backend-specific methods and context injection
class BackendMonitor extends Avido {
  private wrap<T extends WrappableFn>(
    type: TraceType,
    func: T,
    params?: WrapParams<T>
  ): WrappedFn<T> {
    const wrappedFn = (...args: Parameters<T>) => {
      // Don't pass the function directly to proxy to avoid it being called directly
      const callInfo = {
        type,
        func,
        args,
        params,
      };

      const proxy = new Proxy(callInfo, {
        get: (target, prop) => {
          if (prop === "setParent") {
            return chainable.setParent.bind({
              target,
              next: avido.executeWrappedFunction.bind(avido),
            });
          }

          const promise = avido.executeWrappedFunction(target);

          if (prop === "then") {
            return (onFulfilled: ((value: any) => any) | null | undefined, onRejected: ((reason: any) => PromiseLike<never>) | null | undefined) =>
              promise.then(onFulfilled, onRejected);
          }

          if (prop === "catch") {
            return (onRejected: ((reason: any) => PromiseLike<never>) | null | undefined) => promise.catch(onRejected);
          }

          if (prop === "finally") {
            return (onFinally: (() => void) | null | undefined) => promise.finally(onFinally);
          }
        },
      }) as unknown;

      return proxy;
    };

    return wrappedFn as WrappedFn<T>;
  }

  // Extract the actual execution logic into a function
  private async executeWrappedFunction<T extends WrappableFn>(target: CallInfo<T>) {
    const { type, args, func, params: properties } = target;

    // Generate a random ID for this run (will be injected into the context)
    const runId = generateUUID();

    // Get agent name from function name or params
    const name = properties?.nameParser
      ? properties.nameParser(...args)
      : properties?.name ?? func.name;

    const {
      inputParser,
      outputParser,
      tokensUsageParser,
      waitUntil,
      enableWaitUntil,
      metadata,
      params,
      track,
      userId,
      evaluationId,
    }: WrapParams<T> = properties || {};

    // Get extra data from function or params
    const paramsData = properties?.paramsParser
      ? properties.paramsParser(...args)
      : params;
    const metadataData = properties?.metadataParser
      ? properties.metadataParser(...args)
      : metadata;
    const userIdData = properties?.userIdParser
      ? properties.userIdParser(...args)
      : userId;
    const evaluationIdData = properties?.evaluationIdParser
      ? properties.evaluationIdParser(...args)
      : evaluationId;

    const input = inputParser
      ? inputParser(...args)
      : getFunctionInput(func, args);

    if (track !== false) {
      this.trackEvent(type, "start", {
        runId,
        input,
        name,
        params: paramsData as cJSON,
        metadata: metadataData,
        userId: userIdData,
        evaluationId: evaluationIdData,
        parentRunId: target._parentRunId
      });
    }

    const shouldWaitUntil =
      typeof enableWaitUntil === "function"
        ? enableWaitUntil(...args)
        : waitUntil;

    const processOutput = async (output: any) => {
      const tokensUsage = tokensUsageParser
        ? await tokensUsageParser(output)
        : undefined;

      this.trackEvent(type, "end", {
        runId,
        name,
        output: outputParser ? outputParser(output) : output,
        tokensUsage,
        evaluationId: evaluationIdData,
        parentRunId: target._parentRunId
      });

      if (shouldWaitUntil) {
        // Process queue immediately, in case it's a stream, we can't ask the user to manually flush
        await this.flush();
      }
    };

    try {
      // Inject runId into context
      const output = await ctx.runId.callAsync(runId, async () => {
        return func(...args);
      });

      if (shouldWaitUntil && waitUntil) {
        // Support waiting for a callback to be called to complete the run
        // Useful for streaming API
        return waitUntil(
          output,
          (res) => processOutput(res),
          (error) => console.error(error)
        );
      }

      if (track !== false) {
        await processOutput(output);
      }

      return output;
    } catch (error) {
      if (track !== false) {
        this.trackEvent(type, "error", {
          runId,
          error: cleanError(error),
          evaluationId: evaluationIdData,
        });

        // Process queue immediately as if there is an uncaught exception next, it won't be processed
        // TODO: find a cleaner (and non platform-specific) way to do this
        await this.processQueue();
      }

      throw error;
    }
  }

  /**
   * Wrap a tool Promise to track input, output and errors.
   * @param {Promise} func - Tool function
   * @param {WrapParams} params - Wrap params
   */
  wrapTool<T extends WrappableFn>(
    func: T,
    params?: WrapParams<T>
  ): WrappedFn<T> {
    return this.wrap("tool", func, params);
  }

  /**
   * Wrap an model Promise to track it input, output and errors.
   * @param {Promise} func - Model generation function
   * @param {WrapParams} params - Wrap params
   */
  wrapModel<T extends WrappableFn>(
    func: T,
    params?: WrapParams<T>,
  ): WrappedFn<T> {
    return this.wrap("llm", func, params) as WrappedFn<T>;
  }
}

// Export the BackendMonitor class if user wants to initiate multiple instances
export { BackendMonitor as Monitor };

// Create a new instance of the monitor with the async context
const avido = new BackendMonitor(ctx);

export default avido;

export { observeOpenAI } from "./openai";
