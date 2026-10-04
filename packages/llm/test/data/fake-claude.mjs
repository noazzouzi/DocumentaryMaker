// Fake `claude -p --input-format stream-json --output-format stream-json` for the claude-code client tests. Emits the
// event shapes the real CLI (2.1.282) printed. FAKE_SCENARIO picks the run; every call appends one JSON line to FAKE_LOG.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const env = process.env;
const scenario = env.FAKE_SCENARIO ?? "ok";
const out = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 };
const result = (o) => out({ type: "result", subtype: "success", is_error: false, num_turns: 2, usage, total_cost_usd: 0.01, ...o });

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const message = JSON.parse(input.trim().split("\n")[0]);
  const systemFile = flag("--system-prompt-file");
  appendFileSync(env.FAKE_LOG, `${JSON.stringify({
    args, cwd: process.cwd(), apiKey: env.ANTHROPIC_API_KEY ?? null, authToken: env.ANTHROPIC_AUTH_TOKEN ?? null,
    maxOutput: env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? null, system: systemFile ? readFileSync(systemFile, "utf8") : null, content: message.message.content,
  })}\n`);
  let call = 1;
  if (env.FAKE_COUNTER) {
    call = existsSync(env.FAKE_COUNTER) ? Number(readFileSync(env.FAKE_COUNTER, "utf8")) + 1 : 1;
    writeFileSync(env.FAKE_COUNTER, String(call));
  }
  out({ type: "system", subtype: "init", tools: (flag("--tools") ?? "").split(",").filter(Boolean), model: flag("--model") });
  out({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: Number(env.FAKE_UTILIZATION ?? "0.1") } } } });
  const structured = (value) => {
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "StructuredOutput", input: value }], stop_reason: null } });
    result({ result: JSON.stringify(value), structured_output: value });
  };
  switch (scenario) {
    case "ok":
      return structured(JSON.parse(env.FAKE_OUTPUT));
    case "bad-then-ok":
      return structured(call === 1 ? { nope: 1 } : JSON.parse(env.FAKE_OUTPUT));
    case "bad":
      return structured({ nope: 1 });
    case "text-json":
      out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: env.FAKE_OUTPUT }], stop_reason: "end_turn" } });
      return result({ result: env.FAKE_OUTPUT });
    case "auth":
      out({ type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "Not logged in · Please run /login" }] }, error: "authentication_failed", is_api_error_message: true });
      result({ is_error: true, result: "Not logged in · Please run /login", terminal_reason: "api_error" });
      return process.exit(1);
    case "limit":
      out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour" } });
      out({ type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your limit · resets 3pm" }] }, error: "rate_limit", is_api_error_message: true });
      result({ is_error: true, result: "You've hit your limit · resets 3pm" });
      return process.exit(1);
    case "refusal":
      out({ type: "assistant", message: { role: "assistant", content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } } });
      return result({ result: "" });
    case "noresult":
      process.stdout.write("not json\n");
      process.stderr.write("boom\n");
      return process.exit(2);
    case "research": {
      const search = (id, query, links) => {
        out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "WebSearch", input: { query } }] } });
        out({
          type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `Web search results for query: "${query}"\n\nLinks: ${JSON.stringify(links)}` }] },
          tool_use_result: { query, results: [{ tool_use_id: `srv_${id}`, content: links }, "Here are the results."] },
        });
      };
      const fetch = (id, url, code) => {
        out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "WebFetch", input: { url, prompt: "dates" } }] } });
        out({
          type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: code === 200 ? "# Page\nOpened on 31 March 1889." : `HTTP ${code}` }] },
          tool_use_result: { bytes: 100, code, codeText: code === 200 ? "OK" : "Not Found", result: "…", url },
        });
      };
      search("t1", "eiffel tower opening", [
        { title: "Eiffel Tower opens", url: "https://www.history.example:443/eiffel" },
        { title: "Gustave Eiffel", url: "https://bio.example/eiffel/" },
        { title: "Unused result", url: "https://unused.example/x" },
      ]);
      fetch("t2", "https://www.history.example/eiffel", 200);
      fetch("t3", "https://gone.example/page", 404);
      // a search whose structured result is missing: the links come from the text form
      out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t4", name: "WebSearch", input: { query: "eiffel height" } }] } });
      out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t4", content: 'Links: [{"title":"Height \\"facts\\"","url":"https://facts.example/height"}]' }] } });
      const dossier = [
        "- Opened on 31 March 1889. [https://history.example/eiffel]",
        "- Designed by Gustave Eiffel's company. [https://bio.example/eiffel, https://invented.example/nope]",
        "- 300 m tall at opening, see [Height facts](https://facts.example/height).",
        "- A claim from memory. [https://never-seen.example/a]",
      ].join("\n");
      out({ type: "assistant", message: { content: [{ type: "text", text: dossier }], stop_reason: "end_turn" } });
      return result({ result: dossier, num_turns: 6 });
    }
    case "empty-research":
      return result({ result: "" });
    default:
      process.stderr.write(`unknown scenario ${scenario}\n`);
      return process.exit(3);
  }
});
