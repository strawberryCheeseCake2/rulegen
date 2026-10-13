// Loaded before every test file: tests must never reach the network (a real key may be in .env.local).
// Tests that exercise AI calls replace globalThis.fetch with a mock and restore this guard afterwards.
globalThis.fetch = async (input: string | URL | Request) => {
  throw new Error(`Network access is disabled in tests: ${input instanceof Request ? input.url : String(input)}`);
};
