"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { loginPath } from "@/lib/auth/return-to";
import { brandErrorCodeSchema, brandFieldNameSchema, brandMutationSchema, type BrandCommandInput, type BrandErrorCode, type BrandFieldName } from "./contracts";

type WithoutIdentity<T> = T extends BrandCommandInput ? Omit<T, "actorId" | "operationId"> : never;
type MutationInput = WithoutIdentity<BrandCommandInput>;
type MutationError = { code: BrandErrorCode; fields?: BrandFieldName[] };
const failure = z.object({
  error: z.object({ code: brandErrorCodeSchema, fields: z.array(brandFieldNameSchema).optional() }),
});

export function useBrandMutation(actorId: string) {
  const inFlight = useRef(false);
  const previous = useRef<{ input: string; operationId: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MutationError | null>(null);

  async function send(input: MutationInput) {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const serialized = JSON.stringify(input);
      const operationId = previous.current?.input === serialized ? previous.current.operationId : crypto.randomUUID();
      previous.current = { input: serialized, operationId };
      const response = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, actorId, operationId }),
      });
      const data: unknown = await response.json();
      if (response.ok) {
        const result = brandMutationSchema.parse(data);
        previous.current = null;
        return result;
      }
      const problem = failure.parse(data).error;
      if (problem.code === "SESSION_REQUIRED") {
        const { pathname, search, hash } = window.location;
        window.location.replace(loginPath(pathname + search + hash, "session-required"));
      }
      if (problem.code !== "SERVICE_UNAVAILABLE") previous.current = null;
      setError(problem);
      return null;
    } catch {
      setError({ code: "SERVICE_UNAVAILABLE" });
      return null;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { send, pending, error };
}
