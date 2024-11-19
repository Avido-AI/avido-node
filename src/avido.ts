import {
  checkEnv,
  cleanError,
  cleanExtra,
  debounce,
  generateUUID,
  wait,
} from "./utils";

import type {
  AvidoInitOptions,
  cJSON,
  Event,
  EventType,
  LogEvent,
  TraceEvent,
  TraceType,
} from "./types";

import { Thread } from "./thread";

const MAX_CHUNK_SIZE = 10;

class Avido {
  appId?: string;
  apiKey?: string;
  apiUrl?: string;
  context?: any;
  runtime?: string;
  onlySendEvals: boolean = true;
  queue: Event[] = [];

  private running = false;
  private activeThread?: Thread;

  private shouldSendEvent(): boolean {
    const hasEvaluationId = this.activeThread?.getEvaluationId();
    return !this.onlySendEvals || !!hasEvaluationId;
  }

  /**
   * @param {AvidoInitOptions} options
   */
  constructor(context?: { runId: any; user: any; evaluation?: any }) {
    this.init({
      appId: checkEnv("AVIDO_APP_ID"),
      apiKey: checkEnv("AVIDO_API_KEY"),
      apiUrl: checkEnv("AVIDO_API_URL") ?? "https://api.avido.io/v0",
      runtime: "avido-node",
    });

    this.context = context;
  }

  init({ appId, apiKey, apiUrl, onlySendEvals = true }: AvidoInitOptions = {}) {
    if (appId) this.appId = appId;
    if (apiKey) this.apiKey = apiKey;
    if (apiUrl) this.apiUrl = apiUrl;
    this.onlySendEvals = onlySendEvals;
  }

  /**
   * Manually track a run event.
   * @param {RunType} type - The type of the run.
   * @param {EventType} event - The name of the event.
   * @param {Partial<TraceEvent | LogEvent>} data - The data associated with the event.
   * @example
   * monitor.trackEvent("llm", "start", { name: "gpt-4o", input: "Hi, how can I help you?" });
   */
  trackEvent(
    type: TraceType,
    event: EventType,
    data: Partial<TraceEvent | LogEvent>
  ): void {
    if (!this.appId || !this.apiKey || !this.apiUrl) {
      console.warn(
        "Avido is not reporting anything. Please check your init() parameters."
      );
      return;
    }

    if (!this.shouldSendEvent()) return;

    const runtime = this.runtime;
    const { runId, parentRunId, userId, evaluationId } = data;

    const eventData = {
      type,
      event,
      runId: runId ?? generateUUID(),
      userId,
      parentRunId,
      evaluationId: evaluationId ?? this.activeThread?.getEvaluationId(),
      timestamp: Date.now(),
      runtime,
      ...cleanExtra(data),
    };

    this.queue.push(eventData);

    if (this.queue.length > MAX_CHUNK_SIZE) {
      this.processQueue();
    } else {
      this.debouncedProcessQueue();
    }
  }

  /**
   * Manually track a tool call event.
   * @param {string} toolCallId - The ID of the tool call
   * @param {string} toolName - The name of the tool being called
   * @param {cJSON} input - The input parameters for the tool
   * @param {cJSON} output - The output from the tool
   * @param {string} [parentRunId] - Parent run ID to link this tool call to, usually the thread id
   */
  trackToolCall(
    toolCallId: string,
    toolName: string,
    input: cJSON,
    output: cJSON,
    parentRunId: string,
  ): void {
    this.trackEvent("tool", "end", {
      runId: toolCallId,
      parentRunId,
      evaluationId: this.activeThread?.getEvaluationId(),
      tool_call_id: toolCallId,
      tool_call_name: toolName,
      tool_call_input: input,
      tool_call_output: output,
    });
  }

  // Wait 500ms to allow other events to be added to the queue
  private debouncedProcessQueue = debounce(() => this.processQueue());

  async processQueue() {
    if (!this.queue.length || this.running) return;

    this.running = true;

    try {

      const copy = this.queue.slice();

      await fetch(`${this.apiUrl}/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "x-avido-app-id": `${this.appId}`,
        },
        body: JSON.stringify({ events: copy }),
      });

      // Clear the events we just sent (don't clear it all in case new events were added while sending)
      this.queue = this.queue.slice(copy.length);

      this.running = false;

      // If there are new events in the queue
      if (this.queue.length) this.processQueue();
    } catch (error) {
      this.running = false;
      console.error("Error sending event(s) to Avido", error);
    }
  }

  openThread(
    params?:
      | string
      | { id?: string; userId?: string; evaluationId?: string }
  ) {
    const threadParams = typeof params === "string" ? { id: params } : params || {};
    const thread = new Thread(this, threadParams);
    this.activeThread = thread;
    return thread;
  }

  /**
   * Report any errors that occur during the conversation.
   * @param {string} message - Error message
   * @param {any} error - Error object
   * @example
   * try {
   *   const response = await openai.generate("Help!")
   *   observer.result(response)
   * } catch (error) {
   *   observer.error("Something went wrong", error)
   * }
   */
  error(message: string | any, error?: any) {
    if (typeof message === "object") {
      error = message;
      message = error.message ?? undefined;
    }

    this.trackEvent("log", "error", {
      message,
      extra: cleanError(error),
    });
  }

  /**
   * Make sure the queue is flushed before exiting the program
   */
  async flush() {
    if (!this.running) {
      return await this.processQueue();
    }

    // Wait for a maximum of 10 seconds to send the already running queue
    let counter = 0;
    while (this.running) {
      wait(100);
      counter++;

      if (counter === 10) {
        break;
      }
    }
  }

  async validateWebhook(payload: unknown, headers: Record<string, string>): Promise<boolean> {
    if (!this.appId || !this.apiKey || !this.apiUrl) {
      console.warn(
        "Avido is not reporting anything. Please check your init() parameters."
      );
      return false;
    }
    try {
      const response = await fetch(`${this.apiUrl}/validate-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "x-avido-app-id": this.appId,
          "x-avido-signature": headers["x-avido-signature"],
          "x-avido-timestamp": headers["x-avido-timestamp"],
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return data.valid === true;
    } catch (error) {
      console.error("Error validating webhook signature:", error);
      return false;
    }
  }
}

export default Avido;
