import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  AiResponseError,
  buildResponsesUrl,
  createAiResponse,
  extractResponseAnnotations,
  extractResponseText,
  getAiEnvironment,
  isAiConfigured,
} from "../../src/lib/ai/responses.ts";

test("parses and normalizes Responses API environment configuration", () => {
  assert.equal(isAiConfigured({}), false);
  assert.equal(isAiConfigured({ OPENAI_API_KEY: "   " }), false);
  assert.equal(isAiConfigured({ OPENAI_BASE_URL: "ftp://example.invalid/v1", OPENAI_API_KEY: "sk-test" }), false);

  const env = getAiEnvironment({
    OPENAI_BASE_URL: "https://x.arzopa.com/v1/",
    OPENAI_API_KEY: "sk-test-token",
    OPENAI_MODEL: "deepseek-flash",
  });
  assert.deepEqual(env, {
    baseUrl: "https://x.arzopa.com/v1",
    apiKey: "sk-test-token",
    defaultModel: "deepseek-flash",
  });
  assert.equal(buildResponsesUrl(env.baseUrl), "https://x.arzopa.com/v1/responses");
  assert.equal(
    getAiEnvironment({ OPENAI_API_KEY: "sk-test-token" }).baseUrl,
    "https://api.openai.com/v1",
  );
});

test("extracts text and annotations from Responses API output items", () => {
  const payload = {
    output: [
      {
        type: "reasoning",
        id: "r1",
        status: "completed",
        content: [{ type: "reasoning_text", text: "internal thought" }],
      },
      {
        type: "message",
        id: "m1",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "Hello",
            annotations: [{ type: "url_citation", url: "https://example.com" }],
          },
          {
            type: "output_text",
            text: " world",
          },
        ],
      },
    ],
    output_text: "fallback",
  };

  assert.equal(extractResponseText(payload), "Hello world");
  assert.deepEqual(extractResponseAnnotations(payload), [
    { type: "url_citation", url: "https://example.com" },
  ]);
  assert.equal(extractResponseText({ output: [], output_text: "fallback" }), "fallback");
});

test("createAiResponse sends standard POST /responses request and masks secrets on errors", async (t) => {
  const received = [];
  let mode = "ok";

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    });

    if (mode === "error") {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit exceeded", code: "rate_limit" } }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "resp_123",
        object: "response",
        status: "completed",
        model: "deepseek-flash",
        output: [
          {
            type: "reasoning",
            content: [{ type: "reasoning_text", text: "think" }],
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "OK", annotations: [] }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const { port } = server.address();
  const env = {
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_API_KEY: "sk-secret-value-not-leaked",
    OPENAI_MODEL: "deepseek-flash",
  };

  const result = await createAiResponse(
    { input: "Reply with OK", instructions: "Be brief", maxOutputTokens: 32 },
    { env },
  );

  assert.equal(received.length, 1);
  assert.equal(received[0].method, "POST");
  assert.equal(received[0].url, "/v1/responses");
  assert.equal(received[0].auth, "Bearer sk-secret-value-not-leaked");
  assert.deepEqual(received[0].body, {
    model: "deepseek-flash",
    input: "Reply with OK",
    instructions: "Be brief",
    max_output_tokens: 32,
  });
  assert.equal(result.id, "resp_123");
  assert.equal(result.model, "deepseek-flash");
  assert.equal(result.status, "completed");
  assert.equal(result.outputText, "OK");
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });

  mode = "error";
  await assert.rejects(
    () => createAiResponse({ input: "Trigger error" }, { env }),
    (error) =>
      error instanceof AiResponseError &&
      error.status === 429 &&
      error.code === "rate_limit" &&
      !error.message.includes("sk-secret-value-not-leaked"),
  );
});
