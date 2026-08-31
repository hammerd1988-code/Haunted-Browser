import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseToolCall, runAgent, type AgentStepEvent, type AgentToolbelt } from "./agent";

describe("parseToolCall", () => {
  it("only accepts a TOOL line when it is the last non-empty line", () => {
    assert.equal(parseToolCall("Example syntax:\nTOOL: readPage {}\nFinal answer"), null);
    assert.equal(parseToolCall("TOOL: readPage {}\n\nDone"), null);
    assert.deepEqual(parseToolCall("Thinking...\nTOOL: readPage {}"), {
      tool: "readPage",
      args: {},
    });
  });
});

describe("runAgent", () => {
  it("reports thought text from lines before the final TOOL line", async () => {
    const events: AgentStepEvent[] = [];
    const toolbelt: AgentToolbelt = {
      listTabs: () => [{ index: 0, title: "Home", url: "https://example.com/", active: true }],
      openTab: () => {},
      closeTab: () => undefined,
      switchTab: () => undefined,
      navigate: () => {},
      readPage: async () => ({ url: "https://example.com/", title: "Home", text: "Example page" }),
      executeInPage: null,
      sshRun: async () => ({ ok: true, output: "" }),
      serverGuiUrl: "",
    };

    let callCount = 0;
    await runAgent({
      goal: "Inspect the page",
      mode: "auto",
      toolbelt,
      callAgentStep: async () => {
        callCount += 1;
        return callCount === 1
          ? { content: "I should inspect the current page first.\nTOOL: readPage {}" }
          : { content: "Done." };
      },
      requestApproval: async () => true,
      onEvent: (event) => events.push(event),
    });

    assert.equal(events[0]?.type, "thought");
    assert.equal(events[0]?.text, "I should inspect the current page first.");
    assert.equal(events[1]?.type, "observation");
    assert.equal(events.at(-1)?.type, "final");
  });
});
