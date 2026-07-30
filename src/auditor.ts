/**
 * Core audit logic — pure computation, no external calls.
 * Detects "tool description smells" that reduce LLM tool-selection accuracy.
 * Based on 2026 research (tool description quality papers + MCP architecture patterns).
 */

export interface ToolInput {
  name: string;
  description: string;
  inputSchema?: Record<string, any>;
}

export interface Smell {
  code: string;
  severity: "high" | "medium" | "low";
  message: string;
  suggestion: string;
}

export interface AuditResult {
  tool_name: string;
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  smells: Smell[];
  strengths: string[];
  summary: string;
}

export interface ListAuditResult {
  total_tools: number;
  average_score: number;
  overcrowding_warning: string | null;
  ranked: Array<{ name: string; score: number; grade: string }>;
  worst_offenders: string[];
  recommendation: string;
}

// ─── Best practices checklist (public) ──────────────────────────────────────

export const BEST_PRACTICES = {
  version: "2026-07",
  source: "Derived from MCP tool description research + real agent testing",
  rules: [
    {
      id: "clear-purpose",
      title: "State the purpose clearly in the first sentence",
      example: "Search the web for current information and return ranked results.",
    },
    {
      id: "when-to-use",
      title: "Include when the agent should call this tool",
      example: "Use when the user asks for recent news, prices, or facts that may have changed.",
    },
    {
      id: "when-not-to-use",
      title: "Mention limitations or cases to avoid",
      example: "Do not use for private data or when an offline calculation is sufficient.",
    },
    {
      id: "parameter-hints",
      title: "Describe what each important parameter expects",
      example: "query: natural language search string (min 3 characters).",
    },
    {
      id: "output-shape",
      title: "Briefly describe what the tool returns",
      example: "Returns a list of title, url, and snippet objects.",
    },
    {
      id: "keep-short",
      title: "Prefer 1-3 concise sentences over long paragraphs",
      note: "LLMs skim; long descriptions dilute the signal.",
    },
    {
      id: "no-vague-verbs",
      title: "Avoid vague verbs like 'handle', 'manage', 'process', 'do stuff'",
      note: "Be specific about the action.",
    },
    {
      id: "tool-count",
      title: "Keep visible tools under 12-15 for weaker models",
      note: "Accuracy drops sharply beyond this range.",
    },
  ],
};

// ─── Smell detectors ────────────────────────────────────────────────────────

function detectSmells(tool: ToolInput): Smell[] {
  const smells: Smell[] = [];
  const desc = tool.description.trim();
  const lower = desc.toLowerCase();
  const words = desc.split(/\s+/).length;

  // 1. Too short / missing purpose
  if (words < 8) {
    smells.push({
      code: "TOO_SHORT",
      severity: "high",
      message: "Description is too short to convey purpose and usage.",
      suggestion: "Expand to at least one clear sentence stating what the tool does and when to use it.",
    });
  }

  // 2. Vague purpose verbs
  const vagueVerbs = ["handle", "manage", "process", "do", "perform", "work with", "deal with", "stuff"];
  for (const v of vagueVerbs) {
    if (lower.includes(v) && !lower.includes("search") && !lower.includes("fetch") && !lower.includes("calculate")) {
      smells.push({
        code: "VAGUE_VERB",
        severity: "medium",
        message: `Contains vague verb or phrase: "${v}"`,
        suggestion: "Replace with a concrete action verb (search, create, calculate, send, validate…).",
      });
      break;
    }
  }

  // 3. Missing usage guidance
  const usageSignals = ["use when", "use if", "when the user", "call this", "for cases", "ideal for", "best for"];
  const hasUsage = usageSignals.some((s) => lower.includes(s));
  if (!hasUsage && words > 10) {
    smells.push({
      code: "MISSING_USAGE",
      severity: "high",
      message: "No clear guidance on WHEN the agent should call this tool.",
      suggestion: "Add a clause like: 'Use when the user asks for X' or 'Ideal for Y scenarios'.",
    });
  }

  // 4. No limitations mentioned
  const limitSignals = ["do not", "don't", "avoid", "not for", "limitation", "only works", "requires"];
  const hasLimit = limitSignals.some((s) => lower.includes(s));
  if (!hasLimit && words > 15) {
    smells.push({
      code: "NO_LIMITATIONS",
      severity: "medium",
      message: "No limitations or 'when not to use' guidance.",
      suggestion: "Add one short sentence about cases where this tool should not be used.",
    });
  }

  // 5. Opaque parameters (if schema provided)
  if (tool.inputSchema) {
    const props = tool.inputSchema.properties || tool.inputSchema;
    if (typeof props === "object") {
      const paramNames = Object.keys(props);
      for (const p of paramNames) {
        if (!lower.includes(p.toLowerCase()) && p.length > 2) {
          smells.push({
            code: "OPAQUE_PARAM",
            severity: "medium",
            message: `Parameter "${p}" is not mentioned in the description.`,
            suggestion: `Briefly explain what "${p}" expects (e.g. format, required values).`,
          });
        }
      }
    }
  }

  // 6. Excessively long
  if (words > 80) {
    smells.push({
      code: "TOO_LONG",
      severity: "low",
      message: "Description is very long; LLMs may dilute the key signal.",
      suggestion: "Trim to 2-4 focused sentences. Move examples to a separate docs file.",
    });
  }

  // 7. Starts with "This tool" or similar filler
  if (lower.startsWith("this tool") || lower.startsWith("a tool that") || lower.startsWith("the tool")) {
    smells.push({
      code: "FILLER_START",
      severity: "low",
      message: "Starts with filler ('This tool…').",
      suggestion: "Start directly with the action: 'Search the web…' or 'Create a new…'.",
    });
  }

  return smells;
}

function computeScore(smells: Smell[], wordCount: number): number {
  let score = 100;
  for (const s of smells) {
    if (s.severity === "high") score -= 18;
    else if (s.severity === "medium") score -= 10;
    else score -= 4;
  }
  // slight bonus for good length
  if (wordCount >= 15 && wordCount <= 45) score += 5;
  return Math.max(0, Math.min(100, score));
}

function grade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function collectStrengths(tool: ToolInput, smells: Smell[]): string[] {
  const strengths: string[] = [];
  const lower = tool.description.toLowerCase();
  const words = tool.description.split(/\s+/).length;

  if (words >= 12 && words <= 50) strengths.push("Good length (concise yet informative)");
  if (lower.includes("use when") || lower.includes("use if") || lower.includes("ideal for")) {
    strengths.push("Contains usage guidance");
  }
  if (lower.includes("return") || lower.includes("returns") || lower.includes("output")) {
    strengths.push("Mentions output shape");
  }
  if (smells.length === 0) strengths.push("No major smells detected");
  if (tool.inputSchema) strengths.push("Input schema provided for deeper analysis");

  return strengths;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function auditTool(tool: ToolInput): AuditResult {
  const smells = detectSmells(tool);
  const wordCount = tool.description.trim().split(/\s+/).length;
  const score = computeScore(smells, wordCount);
  const g = grade(score);
  const strengths = collectStrengths(tool, smells);

  let summary = "";
  if (score >= 90) summary = "Excellent — ready for production agents.";
  else if (score >= 75) summary = "Good — minor polish will make it even better.";
  else if (score >= 60) summary = "Average — several improvements recommended before publishing.";
  else summary = "Weak — high risk that agents will mis-select or ignore this tool. Rewrite recommended.";

  return {
    tool_name: tool.name,
    score,
    grade: g,
    smells,
    strengths,
    summary,
  };
}

export function rewriteDescription(tool: ToolInput & { context?: string }): string {
  const name = tool.name;
  const original = tool.description.trim();
  const lower = original.toLowerCase();

  // Simple rule-based rewrite that forces best-practice structure
  // In production this can be swapped for a local LLM call if desired.
  let purpose = original;
  // strip filler starts
  purpose = purpose.replace(/^(this tool |a tool that |the tool )/i, "");
  if (!purpose.endsWith(".")) purpose += ".";

  // Build structured rewrite
  const parts: string[] = [];

  // 1. Clear purpose first
  parts.push(purpose.charAt(0).toUpperCase() + purpose.slice(1));

  // 2. Usage guidance if missing
  if (!lower.includes("use when") && !lower.includes("use if") && !lower.includes("ideal for")) {
    if (tool.context) {
      parts.push(`Use when ${tool.context}.`);
    } else {
      parts.push(`Use this tool when the user request matches the purpose above.`);
    }
  }

  // 3. Parameter hints from schema
  if (tool.inputSchema?.properties) {
    const keys = Object.keys(tool.inputSchema.properties).slice(0, 4);
    if (keys.length > 0) {
      parts.push(`Key parameters: ${keys.join(", ")}.`);
    }
  }

  // 4. Limitation (generic if none)
  if (!lower.includes("do not") && !lower.includes("don't") && !lower.includes("not for")) {
    parts.push("Do not use for unrelated tasks outside the stated purpose.");
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function auditToolList(tools: ToolInput[]): ListAuditResult {
  const results = tools.map((t) => {
    const a = auditTool(t);
    return { name: t.name, score: a.score, grade: a.grade };
  });

  results.sort((a, b) => a.score - b.score);

  const avg = results.length
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    : 0;

  let overcrowding: string | null = null;
  if (tools.length > 15) {
    overcrowding = `WARNING: ${tools.length} tools visible. Research shows weaker models drop below 90% accuracy between 10-15 tools. Consider splitting into multiple focused MCP servers or using progressive disclosure.`;
  } else if (tools.length > 12) {
    overcrowding = `Caution: ${tools.length} tools is near the upper limit for reliable selection. Monitor agent accuracy.`;
  }

  const worst = results.filter((r) => r.score < 60).map((r) => r.name);

  let recommendation = "";
  if (avg >= 85 && !overcrowding) recommendation = "Strong overall quality. Ready to ship.";
  else if (overcrowding) recommendation = "Reduce tool count or improve the lowest-scoring tools first.";
  else recommendation = "Focus rewrite effort on the lowest-scoring tools before publishing.";

  return {
    total_tools: tools.length,
    average_score: avg,
    overcrowding_warning: overcrowding,
    ranked: results,
    worst_offenders: worst,
    recommendation,
  };
}
