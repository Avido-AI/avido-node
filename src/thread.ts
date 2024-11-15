import type Avido from "./avido"
import type { cJSON } from "./types"
import { generateUUID } from "./utils"

type Message = {
  id?: string
  role: "user" | "assistant" | "tool" | "system"
  content?: string | null
  feedback?: cJSON
  userId?: string
}

export class Thread {
  public id: string
  private userId?: string
  private monitor: Avido

  constructor(
    monitor: Avido,
    options: {
      id?: string
      userId?: string
    }
  ) {
    this.monitor = monitor
    this.id = options?.id || generateUUID()
  }

  /**
   * Track a new message from the user
   *
   * @param {Message} message - The message to track
   * @returns {string} - The message ID, to reconcile with feedback and backend LLM calls
   * */

  trackMessage = (message: Message): string => {
    const runId = message.id ?? generateUUID()

    const evaluationContext = this.monitor.context?.evaluation;
    const evaluationId = evaluationContext?.id;
    const onlySendEvals = this.monitor.onlySendEvals;

    // Store the latest message runId in context
    this.monitor.context = {
      ...this.monitor.context,
      lastMessageRunId: runId
    };

    if (!onlySendEvals || !!evaluationId) {
      // Track the message with the thread as parent
      this.monitor.trackEvent("thread", "chat", {
        runId,
        parentRunId: this.id,  // Use thread ID as parent
        userId: this.userId,
        evaluationId,
        message,
      })
    }

    return runId
  }
}