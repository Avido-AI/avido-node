import type Avido from "./avido";
import type { cJSON } from "./types";
import { generateUUID } from "./utils";
import context from "./context";

type Message = {
  id?: string;
  role: "user" | "assistant" | "tool" | "system";
  content?: string | null;
  tool_calls?: cJSON;
  feedback?: cJSON;
};

export class Thread {
  public id: string;
  private observer: Avido;
  private evaluationId?: string;
  private messages: string[] = []; // Track message IDs for potential retroactive updates

  constructor(
    observer: Avido,
    options: {
      id?: string;
      evaluationId?: string;
    }
  ) {
    this.observer = observer;
    this.id = options?.id || generateUUID();
    if (options?.evaluationId) {
      this.setEvaluationId(options.evaluationId);
    }
  }

  setEvaluationId(evaluationId: string): void {
    context.evaluation.set({ id: evaluationId });
    // If we have previous messages and onlySendEvals was true, we need to send them now
    if (this.observer.onlySendEvals && this.messages.length > 0) {
      this.messages.forEach(runId => {
        this.observer.trackEvent("thread", "chat", {
          runId,
          parentRunId: this.id,
          evaluationId,
        });
      });
    }
  }

  /**
   * Tracks a new message from a user
   *
   * @param {Message} message - The message to track
   * @returns {string} - The message ID
   * */
  trackMessage = (message: Message): Promise<string> => {
    const runId = message.id ?? generateUUID();
    this.messages.push(runId); // Track the message ID

    return context.runId.callAsync(runId, async () => {
      // Only track if we're not in onlySendEvals mode or we have an evaluationId
      if (!this.observer.onlySendEvals || this.evaluationId) {
        this.observer.trackEvent("thread", "chat", {
          runId,
          parentRunId: this.id,
          evaluationId: this.evaluationId,
          message,
        });
      }

      return runId;
    });
  };
}
