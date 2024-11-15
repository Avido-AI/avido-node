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
  private evaluationId?: string
  private observer: Avido

  constructor(
    observer: Avido,
    options: {
      id?: string
      userId?: string
      evaluationId?: string
    }
  ) {
    this.observer = observer
    this.id = options?.id || generateUUID()
    this.userId = options?.userId
    this.evaluationId = options?.evaluationId
  }

  getEvaluationId(): string | undefined {
    return this.evaluationId;
  }

  /**
   * Track a new message from the user
   *
   * @param {Message} message - The message to track
   * @returns {string} - The message ID, to reconcile with feedback and backend LLM calls
   * */

  trackMessage = (message: Message): string => {
    const runId = message.id ?? generateUUID()

    const onlySendEvals = this.observer.onlySendEvals;

    // Store the latest message runId in context
    this.observer.context = {
      ...this.observer.context,
      lastMessageRunId: runId
    };

    if (!onlySendEvals || !!this.evaluationId) {
      this.observer.trackEvent("thread", "chat", {
        runId,
        parentRunId: this.id,  // Use thread ID as parent
        userId: this.userId,
        evaluationId: this.evaluationId,
        message,
      })
    }

    return runId
  }
}