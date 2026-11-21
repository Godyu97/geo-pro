/** Opt-in lane for walking M0 pages with labeled stand-ins. Never a real pilot. */
export const functionalMockMarker = "[FUNCTIONAL-MOCK]";

export function functionalMockRequested(env: NodeJS.ProcessEnv) {
  return env.GEO_FUNCTIONAL_MOCK === "1";
}
