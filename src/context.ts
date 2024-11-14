import { AsyncLocalStorage } from "node:async_hooks";
import { createContext } from "unctx";

const runId = createContext({
  asyncContext: true,
  AsyncLocalStorage,
});

const user = createContext({
  asyncContext: true,
  AsyncLocalStorage,
});

export default {
  runId,
  user,
};
