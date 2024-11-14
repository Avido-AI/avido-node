import type Avido from "./avido";
import type { cJSON } from "./types";
import { generateUUID } from "./utils";

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

  constructor(
    observer: Avido,
    options: {
      id?: string;
    }
  ) {
    this.observer = observer;
    this.id = options?.id || generateUUID();
  }

  /**
   * Tracks a new message from a user
   *
   * @param {Message} message - The message to track
   * @returns {string} - The message ID
   * */

  trackMessage = (message: Message): string => {
    const runId = message.id ?? generateUUID();

    this.observer.trackEvent("thread", "chat", {
      runId,
      parentRunId: this.id,
      message,
    });

    return runId;
  };
}
