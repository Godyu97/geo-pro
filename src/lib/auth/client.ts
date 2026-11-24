"use client";

import { createAuthClient } from "better-auth/react";

// Same-origin API calls; no server environment values enter the client bundle.
export const authClient = createAuthClient({
  sessionOptions: { refetchInterval: 60, refetchOnWindowFocus: true },
});

let signOutInProgress: Promise<boolean> | undefined;

export function pendingSignOut() {
  return signOutInProgress;
}

export function signOutTo(target: string) {
  signOutInProgress ??= (async () => {
    try {
      const result = await authClient.signOut({ fetchOptions: { disableSignal: true } });
      if (!result.error) {
        window.location.replace(target);
        return true;
      }
    } catch {
      // The button can show a retryable error.
    }
    signOutInProgress = undefined;
    return false;
  })();
  return signOutInProgress;
}
