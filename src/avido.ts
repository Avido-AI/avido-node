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
  queue: Event[] = [];

  private running = false;

  /**
   * @param {AvidoInitOptions} options
   */
  constructor(context?: { runId: any; user: any; }) {
    this.init({
      appId: checkEnv("AVIDO_APP_ID"),
      apiKey: checkEnv("AVIDO_API_KEY"),
      apiUrl: checkEnv("AVIDO_API_URL") ?? "https://api.avido.io/v1",
      runtime: "avido-js",
    });

    this.context = context;
  }

  init({ appId, apiKey, apiUrl }: AvidoInitOptions = {}) {
    if (appId) this.appId = appId;
    if (apiKey) this.apiKey = apiKey;
    if (apiUrl) this.apiUrl = apiUrl;
  }

  /**
   * Manually track a run event.
   * @param {RunType} type - The type of the run.
   * @param {EventType} event - The name of the event.
   * @param {Partial<TraceEvent | LogEvent>} data - The data associated with the event.
   * @example
   * monitor.trackEvent("llm", "start", { name: "gpt-4", input: "Hello I'm a bot" });
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

    let timestamp = Date.now();
    const lastEvent = this.queue?.[this.queue.length - 1];
    if (lastEvent && lastEvent.timestamp >= timestamp) {
      timestamp = lastEvent.timestamp + 1;
    }

    const runId = generateUUID();
    const parentRunId = data.parentRunId;
    const userId = data.userId
    const runtime = data.runtime ?? this.runtime;

    const eventData: Event = {
      runId,
      event,
      type,
      userId,
      parentRunId,
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
          "avido-application-id": `${this.appId}`,
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
      | { id?: string; tags?: string[]; userId?: string; userProps?: cJSON }
  ) {
    return new Thread(
      this,
      typeof params === "string" ? { id: params } : params || {}
    );
  }

  /**
   * Use this to log any external action or tool you use.
   * @param {string} message - Log message
   * @param {any} extra - Extra data to pass
   * @example
   * monitor.info("Running tool Google Search")
   **/
  info(message: string, extra?: any) {
    this.trackEvent("log", "info", {
      message,
      extra,
    });
  }

  log(message: string, extra?: any) {
    this.info(message, extra);
  }

  /**
   * Report any errors that occur during the conversation.
   * @param {string} message - Error message
   * @param {any} error - Error object
   * @example
   * try {
   *   const answer = await model.generate("Hello")
   *   monitor.result(answer)
   * } catch (error) {
   *   monitor.error("Error generating answer", error)
   * }
   */
  error(message: string | any, error?: any) {
    // More concise implementation
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
