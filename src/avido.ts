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

  private shouldSendEvent(): boolean {
    const evalContext = this.context?.evaluation.get();
    return !this.onlySendEvals || !!evalContext?.id;
  }

  /**
   * @param {AvidoInitOptions} options
   */
  constructor(context?: { runId: any; user: any; evaluation?: any }) {
    this.init({
      appId: checkEnv("AVIDO_APP_ID"),
      apiKey: checkEnv("AVIDO_API_KEY"),
      apiUrl: checkEnv("AVIDO_API_URL") ?? "https://api.avido.io/v1",
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

    // If onlySendEvals is true and we don't have an evaluationId, skip sending
    if (!this.shouldSendEvent()) {
      return;
    }

    let timestamp = Date.now();
    const lastEvent = this.queue?.[this.queue.length - 1];
    if (lastEvent && lastEvent.timestamp >= timestamp) {
      timestamp = lastEvent.timestamp + 1;
    }

    const runId = generateUUID();
    const parentRunId = data.parentRunId;
    const userId = data.userId;
    const evaluationId = data.evaluationId;
    const runtime = data.runtime ?? this.runtime;

    const eventData: Event = {
      runId,
      event,
      type,
      userId,
      parentRunId,
      evaluationId,
      timestamp,
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
   * @param {string} parentId - The ID of the parent event this tool call belongs to
   */
  trackToolCall(
    toolCallId: string,
    toolName: string,
    input: cJSON,
    output: cJSON,
    parentId: string
  ): void {
    this.trackEvent("tool", "tool_call", {
      tool_call: {
        tool_call_id: toolCallId,
        tool_call_name: toolName,
        tool_call_input: input,
        tool_call_output: output
      },
      parentRunId: parentId
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
      | { id?: string; tags?: string[]; userId?: string; userProps?: cJSON; evaluationId?: string }
  ) {
    const threadParams = typeof params === "string" ? { id: params } : params || {};
    return new Thread(this, threadParams);
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
}

export default Avido;
