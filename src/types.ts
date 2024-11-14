export type cJSON =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [x: string]: cJSON }
  | Array<cJSON>;

export interface AvidoInitOptions {
  appId?: string;
  apiKey?: string;
  apiUrl?: string;
  runtime?: string;
  onlySendEvals?: boolean;
}

export type OpenAIMessage = {
  role: "user" | "assistant" | "system" | "function" | "tool";
  content: string | null;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
};

export type TraceType = "log" | "tool" | "llm" | "chat" | "thread";

export type EventType = "start" | "end" | "error" | "info" | "chat" | "tool_call";

export interface Event {
  runId: string;
  type: TraceType;
  event: EventType;
  timestamp: number;
  userId?: string;
  parentRunId?: string;
  evaluationId?: string;
  params?: cJSON;
  metadata?: cJSON;
  runtime?: string;
  error?: {
    message: string;
    stack?: string;
  };
}

export type TokenUsage = {
  completion: number | undefined;
  prompt: number | undefined;
};

export interface ToolCallData {
  tool_call_id: string;
  tool_call_name: string;
  tool_call_input: cJSON;
  tool_call_output: cJSON;
}

export interface TraceEvent extends Event {
  runId: string;
  input?: cJSON;
  output?: cJSON;
  tokensUsage?: TokenUsage;
  tool_call?: ToolCallData;
  [key: string]: unknown;
}

export interface LogEvent extends Event {
  message: string;
}

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "function" | "tool";
  content: string | null;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  [key: string]: cJSON | undefined;
};

export type WrapExtras = {
  name?: string;
  metadata?: cJSON;
  params?: cJSON;
  userId?: string;
  evaluationId?: string;
};

export type WrapParams<T extends WrappableFn> = {
  track?: boolean;
  name?: string;
  metadata?: cJSON;
  params?: cJSON;
  userId?: string;
  evaluationId?: string;
  nameParser?: (...args: Parameters<T>) => string;
  inputParser?: (...args: Parameters<T>) => any;
  outputParser?: (result: Awaited<ReturnType<T>>) => any;
  paramsParser?: (...args: Parameters<T>) => Record<string, unknown>;
  metadataParser?: (...args: Parameters<T>) => cJSON | undefined;
  evaluationIdParser?: (...args: Parameters<T>) => string | undefined;
  tokensUsageParser?: (result: Awaited<ReturnType<T>>) => Promise<{
    completion: number | undefined;
    prompt: number | undefined;
  }>;
  userIdParser?: (...args: Parameters<T>) => string | undefined;
  enableWaitUntil?: (...args: Parameters<T>) => boolean;
  waitUntil?: <T>(
    stream: AsyncIterable<T>,
    onComplete: (res: any) => void,
    onError: (error: unknown) => void
  ) => AsyncIterable<T>;
} & WrapExtras;

export type WrappableFn = (...args: any[]) => any;

export type Identify<T extends WrappableFn> = (
  userId: string,
  userProps?: cJSON
) => WrappedReturn<T>;

export type SetParent<T extends WrappableFn> = (
  runId: string
) => WrappedReturn<T>;

export type WrappedReturn<T extends WrappableFn> = ReturnType<T> & {
  identify: Identify<T>;
  setParent: SetParent<T>;
};

export type WrappedFn<T extends WrappableFn> = (
  ...args: Parameters<T>
) => WrappedReturn<T>;
