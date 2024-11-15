export async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks if the env variable exists in Node
 * @param {string} variable name
 * @returns {string | undefined}
 */
export const checkEnv = (variable: string): string | undefined => {
  if (typeof process !== "undefined" && process.env?.[variable]) {
    return process.env[variable];
  }

  return undefined;
};

export const debounce = (func: () => void, timeout = 500) => {
  let timer: NodeJS.Timeout;
  return (...args: []) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      func.apply(this, args);
    }, timeout);
  };
};

export const cleanError = (error: Error | string | unknown) => {
  if (typeof error === "string")
    return {
      message: error,
    };
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  const unknownError = new Error("Unknown error");
  return {
    message: unknownError.message,
    stack: unknownError.stack,
  };
};

export const cleanExtra = (extra: object) => {
  return Object.fromEntries(
    Object.entries(extra).filter(([_, v]) => v != null)
  );
};

// Get the function argument' names dynamically
// Works with both normal and arrow functions
// Inspired from : https://www.geeksforgeeks.org/how-to-get-the-javascript-function-parameter-names-values-dynamically/
function getArgumentNames(func: (...args: unknown[]) => unknown) {
  // String representation of the function code
  let str = func.toString();

  // Remove comments of the form /* ... */
  // Removing comments of the form //
  // Remove body of the function { ... }
  // removing '=>' if func is arrow function
  str = str
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/(.)*/g, "")
    .replace(/{[\s\S]*}/, "")
    .replace(/=>/g, "")
    .trim();

  // Start parameter names after first '('
  const start = str.indexOf("(") + 1;
  // End parameter names is just before last ')'
  const end = str.length - 1;

  const result = str
    .substring(start, end)
    .split(",")
    .map((el: string) => el.trim());

  const params: string[] = [];

  for (let element of result) {
    // Removing any default value
    element = element.replace(/=[\s\S]*/g, "").trim();
    if (element.length > 0) params.push(element);
  }

  return params;
}

export const getFunctionInput = (
  func: (...args: unknown[]) => unknown,
  args: unknown[]
) => {
  const argNames = getArgumentNames(func);

  // If there is only one argument, use its value as input
  // Otherwise, build an object with the argument names as keys
  const input =
    argNames.length === 1
      ? args[0]
      : argNames.reduce((obj, argName, index) => {
        obj[argName] = args[index];
        return obj;
      }, {} as Record<string, unknown>);

  return input;
};

// Doesn't use the Crypto API (in some Edge environments, it's not available)
// and also doesn't fully rely on Math.random() (which is not cryptographically secure)
// https://stackoverflow.com/a/8809472
export const generateUUID = () => {
  let d = new Date().getTime();
  let d2 =
    (typeof performance !== "undefined" &&
      performance.now &&
      performance.now() * 1000) ||
    0;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    let r = Math.random() * 16;
    if (d > 0) {
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else {
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    }
    return (c === "x" ? r : (r & 0x7) | 0x8).toString(16);
  });
};
