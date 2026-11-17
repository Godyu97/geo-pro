"use client";

import { createAuthClient } from "better-auth/react";

// Same-origin API calls; no server environment values enter the client bundle.
export const authClient = createAuthClient();
