// Thank you Lunary for making this MVP possible
// Support for old OpenAI v3

import type { ChatMessage, ToolCallData, WrapExtras, WrappedReturn, cJSON } from "./types"

import OpenAI from "openai"
import { APIPromise } from "openai/core"
import OpenAIStreaming from "openai/streaming"

import { cleanExtra } from "./utils"

import observer from "./index"

const parseOpenaiMessage = (message: any) => {
  if (!message) return undefined

  const { role, content, name, function_call, tool_calls, tool_call_id } =
    message

  return {
    role,
    content,
    function_call,
    tool_calls,
    tool_call_id,
    name,
  } as ChatMessage
}

const parseToolCall = (toolCall: any): ToolCallData => {
  return {
    tool_call_id: toolCall.id,
    tool_call_name: toolCall.function.name,
    tool_call_input: JSON.parse(toolCall.function.arguments || "{}"),
    tool_call_output: null // This will be filled in later when the tool responds
  };
};

// Forks a stream in two
// https://stackoverflow.com/questions/63543455/how-to-multicast-an-async-iterable
const teeAsync = (iterable: any) => {
  const AsyncIteratorProto = Object.getPrototypeOf(
    Object.getPrototypeOf(async function* () { }.prototype)
  )

  const iterator = iterable[Symbol.asyncIterator]()
  const buffers = [[], []]
  function makeIterator(buffer: any, i: any) {
    return Object.assign(Object.create(AsyncIteratorProto), {
      next() {
        if (!buffer) return Promise.resolve({ done: true, value: undefined })
        if (buffer.length) return buffer.shift()
        const res = iterator.next()
        if (buffers[i ^ 1]) buffers[i ^ 1].push(res as never)
        return res
      },
      async return() {
        if (buffer) {
          // @ts-expect-error MVP mode
          buffer = buffers[i] = null
          if (!buffers[i ^ 1]) await iterator.return()
        }
        return { done: true, value: undefined }
      },
    })
  }
  return buffers.map(makeIterator)
}

/* Just forwarding the types doesn't work, as it's an overloaded function (tried many solutions, couldn't get it to work) */
type NewParams = {
  tags?: string[]
  metadata?: cJSON
}

type WrapCreateFunction<T, U> = (
  body: (T & NewParams),
  options?: OpenAI.RequestOptions
) => WrappedReturn<any>

type WrapCreate = {
  chat: {
    completions: {
      create: WrapCreateFunction<
        OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        APIPromise<OpenAI.ChatCompletion>
      > &
      WrapCreateFunction<
        OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        APIPromise<OpenAIStreaming.Stream<OpenAI.ChatCompletionChunk>>
      > &
      WrapCreateFunction<
        OpenAI.Chat.ChatCompletionCreateParams,
        | APIPromise<OpenAI.ChatCompletion>
        | APIPromise<OpenAIStreaming.Stream<OpenAI.ChatCompletionChunk>>
      >
    }
  }
}

const PARAMS_TO_CAPTURE = [
  "temperature",
  "top_p",
  "top_k",
  "stop",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "function_call",
  "functions",
  "tool_calls",
  "tools",
  "tool_choice",
  "response_format",
  "max_tokens",
  "logit_bias",
]

type WrappedOpenAi<T> = Omit<T, "chat"> & WrapCreate

export function observeOpenAI<T extends any>(
  openai: T,
  params: WrapExtras = {}
): WrappedOpenAi<T> {
  // @ts-ignore
  const createChatCompletion = openai.chat.completions.create
  const wrappedCreateChatCompletion = (...args: any[]) =>
    // @ts-ignore
    createChatCompletion.apply(openai.chat.completions, args)

  async function handleStream(stream: any, onComplete: { (res: any): void; (arg0: { choices: any[]; usage: { completion_tokens: number; prompt_tokens: undefined } }): void }, onError: { (error: unknown): void; (arg0: unknown): void }) {
    try {
      let tokens = 0
      let choices: any[] = []
      for await (const part of stream) {
        // 1 chunk = 1 token
        tokens += 1

        const chunk = part.choices[0]

        const { index, delta } = chunk

        const { content, role, tool_calls } = delta

        if (!choices[index]) {
          choices.splice(index, 0, {
            message: { role, content, tool_calls: [] },
          })
        }

        if (content) choices[index].message.content += content || ""

        if (role) choices[index].message.role = role

        if (tool_calls) {
          for (const tool_call of tool_calls) {
            const existingCallIndex = choices[
              index
            ].message.tool_calls.findIndex((tc: { index: any }) => tc.index === tool_call.index)

            if (existingCallIndex === -1) {
              const parsedToolCall = parseToolCall(tool_call);
              choices[index].message.tool_calls.push(parsedToolCall);
            } else {
              const existingCall =
                choices[index].message.tool_calls[existingCallIndex]

              if (tool_call.function?.arguments) {
                existingCall.function.arguments += tool_call.function.arguments
              }
            }
          }
        }
      }

      // remove the `index` property from the tool_calls if any
      // as it's only used to help us merge the tool_calls
      choices = choices.map((c) => {
        if (c.message.tool_calls) {
          c.message.tool_calls = c.message.tool_calls.map((tc: { [x: string]: any; index: any }) => {
            const { index, ...rest } = tc
            return rest
          })
        }
        return c
      })

      const res = {
        choices,
        usage: { completion_tokens: tokens, prompt_tokens: undefined },
      }

      onComplete(res)
    } catch (error) {
      console.error(error)
      onError(error)
    }
  }

  const wrapped = observer.wrapModel(wrappedCreateChatCompletion, {
    nameParser: (request) => request.model,
    inputParser: (request) => request.messages.map(parseOpenaiMessage),
    paramsParser: (request) => {
      const rawExtra: any = {}
      for (const param of PARAMS_TO_CAPTURE) {
        if (request[param]) rawExtra[param] = request[param]
      }
      return cleanExtra(rawExtra)
    },
    metadataParser(request) {
      const metadata = request.metadata
      delete request.metadata // delete key otherwise openai will throw error
      return metadata
    },
    outputParser: (res) => parseOpenaiMessage(res.choices[0].message || ""),
    tokensUsageParser: async (res) => {
      return {
        completion: res.usage?.completion_tokens,
        prompt: res.usage?.prompt_tokens,
      }
    },
    userIdParser: (request) => request.user,
    enableWaitUntil: (request) => !!request.stream,
    waitUntil: (stream, onComplete, onError) => {
      // Fork the stream in two to be able to process it / multicast it
      const [og, copy] = teeAsync(stream)
      handleStream(copy, onComplete, onError)
      return og
    },
    ...params,
  })

  // @ts-ignore
  openai.chat.completions.create = wrapped

  return openai as WrappedOpenAi<T>
}