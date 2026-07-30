/**
 * Smoke test — run with: npm run test:smoke
 * Verifies core audit logic without needing a full MCP client.
 */

import { auditTool, rewriteDescription, auditToolList, BEST_PRACTICES } from "../src/auditor.js";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

// 1. Weak description should score low
const weak = auditTool({
  name: "do_stuff",
  description: "This tool handles things.",
});
assert(weak.score < 60, `Weak tool scored ${weak.score} (expected <60)`);
assert(weak.smells.length >= 2, `Expected multiple smells, got ${weak.smells.length}`);

// 2. Strong description should score high
const strong = auditTool({
  name: "search_web",
  description:
    "Search the public web for current information and return ranked results with title, url and snippet. Use when the user asks for recent news, prices, or facts that may have changed. Do not use for private data or offline calculations.",
});
assert(strong.score >= 80, `Strong tool scored ${strong.score} (expected >=80)`);

// 3. Rewrite produces longer, structured text
const rewritten = rewriteDescription({
  name: "calc",
  description: "Does math.",
  context: "the user needs a precise numerical answer",
});
assert(rewritten.length > 40, "Rewrite should be longer than original");
assert(rewritten.toLowerCase().includes("use"), "Rewrite should contain usage guidance");

// 4. List audit detects overcrowding
const many = Array.from({ length: 18 }, (_, i) => ({
  name: `tool_${i}`,
  description: "A short description that is too vague.",
}));
const listResult = auditToolList(many);
assert(listResult.overcrowding_warning !== null, "Should warn about overcrowding");
assert(listResult.total_tools === 18, "Should count 18 tools");

// 5. Best practices present
assert(BEST_PRACTICES.rules.length >= 6, "Best practices checklist should have multiple rules");

console.log("\nAll smoke tests passed.");
