import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODEL_URL,
  candidateOrigins,
  describeFailure,
  openaiBaseFromOrigin,
  parseModelIds,
  probeModelServer,
  probeRemoteServer,
  stripToOrigin,
  withLoopback,
} from "./model-server";

describe("stripToOrigin", () => {
  it("defaults empty input to LM Studio on 127.0.0.1", () => {
    assert.equal(stripToOrigin(""), DEFAULT_MODEL_URL);
    assert.equal(stripToOrigin("   "), DEFAULT_MODEL_URL);
  });

  it("peels /v1 and trailing completion paths", () => {
    assert.equal(stripToOrigin("http://localhost:1234/v1"), "http://localhost:1234");
    assert.equal(stripToOrigin("http://127.0.0.1:1234/v1/"), "http://127.0.0.1:1234");
    assert.equal(stripToOrigin("http://127.0.0.1:1234/v1/chat/completions"), "http://127.0.0.1:1234");
    assert.equal(stripToOrigin("http://127.0.0.1:1234/models"), "http://127.0.0.1:1234");
  });

  it("adds http:// when the user types a bare host", () => {
    assert.equal(stripToOrigin("127.0.0.1:1234"), "http://127.0.0.1:1234");
  });
});

describe("openaiBaseFromOrigin", () => {
  it("appends /v1 once", () => {
    assert.equal(openaiBaseFromOrigin("http://127.0.0.1:1234"), "http://127.0.0.1:1234/v1");
    assert.equal(openaiBaseFromOrigin("http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234/v1");
  });
});

describe("withLoopback", () => {
  it("rewrites localhost to 127.0.0.1 so Node fetch does not hit ::1", () => {
    assert.deepEqual(withLoopback("http://localhost:1234"), ["http://127.0.0.1:1234"]);
  });

  it("keeps a custom host unchanged", () => {
    assert.deepEqual(withLoopback("http://192.168.1.20:1234"), ["http://192.168.1.20:1234"]);
  });
});

describe("candidateOrigins", () => {
  it("only uses the configured origin unless discover is on", () => {
    assert.deepEqual(candidateOrigins("http://localhost:1234"), ["http://127.0.0.1:1234"]);
  });

  it("adds LM Studio and Ollama defaults when discovering", () => {
    const found = candidateOrigins("http://127.0.0.1:9999", true);
    assert.ok(found.includes("http://127.0.0.1:9999"));
    assert.ok(found.includes("http://127.0.0.1:1234"));
    assert.ok(found.includes("http://127.0.0.1:11434"));
  });
});

describe("parseModelIds", () => {
  it("reads OpenAI-style data[].id", () => {
    assert.deepEqual(parseModelIds({ data: [{ id: "qwen2.5-7b-instruct" }] }), [
      "qwen2.5-7b-instruct",
    ]);
  });

  it("reads Ollama-style models[].name", () => {
    assert.deepEqual(parseModelIds({ models: [{ name: "llama3.2" }] }), ["llama3.2"]);
  });
});

describe("describeFailure", () => {
  it("explains connection refused as demo-mode / server not started", () => {
    const err = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const { error, hint } = describeFailure(err, ["http://127.0.0.1:1234"]);
    assert.match(error, /Nothing is listening/);
    assert.match(hint, /Developer/);
  });

  it("explains 401 as a missing API token", () => {
    const { error, hint } = describeFailure(new Error("HTTP 401 unauthorized"), [
      "http://127.0.0.1:1234",
    ]);
    assert.match(error, /API token/i);
    assert.match(hint, /token/i);
  });
});

describe("probeModelServer", () => {
  it("connects via 127.0.0.1 when localhost is refused", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:1234/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "local-model" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as typeof fetch;
    try {
      const result = await probeModelServer({ url: "http://localhost:1234" });
      assert.equal(result.connected, true);
      assert.equal(result.demo, false);
      assert.equal(result.origin, "http://127.0.0.1:1234");
      assert.deepEqual(result.models, ["local-model"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("discovers LM Studio on 1234 when a custom port is dead", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:1234/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "ready" }] }), { status: 200 });
      }
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as typeof fetch;
    try {
      const result = await probeModelServer({ url: "http://127.0.0.1:9999", discover: true });
      assert.equal(result.connected, true);
      assert.equal(result.origin, "http://127.0.0.1:1234");
      assert.deepEqual(result.models, ["ready"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("stays in demo mode with a hint when nothing is listening", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as typeof fetch;
    try {
      const result = await probeModelServer({ url: "http://127.0.0.1:1234" });
      assert.equal(result.connected, false);
      assert.equal(result.demo, true);
      assert.match(result.error || "", /Nothing is listening/);
      assert.ok(result.hint);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("surfaces 401 instead of pretending the server is down", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("nope", { status: 401 })) as typeof fetch;
    try {
      const result = await probeModelServer({ url: "http://127.0.0.1:1234" });
      assert.equal(result.connected, false);
      assert.match(result.error || "", /API token/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("probeRemoteServer", () => {
  it("treats unsupported /models endpoints as connected for remote engines", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("missing", { status: 404 })) as typeof fetch;
    try {
      const result = await probeRemoteServer({ baseUrl: "https://api.example.com/v1", apiKey: "test-key" });
      assert.equal(result.connected, true);
      assert.equal(result.demo, false);
      assert.deepEqual(result.models, []);
    } finally {
      globalThis.fetch = original;
    }
  });
});
