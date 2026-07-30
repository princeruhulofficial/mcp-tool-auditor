#!/usr/bin/env node
/**
 * MCP Tool Auditor — Production MCP Server
 * Detects "smells" in tool descriptions that hurt LLM tool-selection accuracy.
 * Pure computation, zero external API cost. Type-A idea.
 *
 * Daily AI project by Grok for Prince Ruhul / Prevalid
 * Date: 2026-07-30
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  auditTool,
  rewriteDescription,
  auditToolList,
  BEST_PRACTICES,
  type ToolInput,
} from "./auditor.js";

const server = new Server(
  {
    name: "mcp-tool-auditor",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Tool definitions (clear, LLM-friendly) ────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "audit_tool",
        description:
          "Audit a single MCP tool description for LLM reliability. Returns a 0-100 quality score, list of detected smells (vague purpose, missing usage guidelines, opaque params, etc.), and concrete fix suggestions. Use this before publishing any MCP server.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The exact name of the tool (e.g. 'search_web')",
            },
            description: {
              type: "string",
              description: "The current human-readable description of the tool",
            },
            inputSchema: {
              type: "object",
              description: "The JSON Schema of the tool's input parameters (optional but recommended for deeper analysis)",
            },
          },
          required: ["name", "description"],
        },
      },
      {
        name: "rewrite_tool_description",
        description:
          "Rewrite a weak tool description into a high-quality, LLM-optimized version that follows current best practices (clear purpose, usage guidelines, parameter hints, limitations). Returns the improved description ready to paste into your MCP server.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Tool name",
            },
            description: {
              type: "string",
              description: "Current (weak) description",
            },
            inputSchema: {
              type: "object",
              description: "JSON Schema of parameters (helps generate better parameter guidance)",
            },
            context: {
              type: "string",
              description: "Optional extra context about when the tool should be used",
            },
          },
          required: ["name", "description"],
        },
      },
      {
        name: "audit_tool_list",
        description:
          "Audit an entire list of tools at once. Detects overcrowding (too many tools hurt accuracy), ranks each tool by quality score, and flags the worst offenders. Research shows accuracy drops below 90% when weaker models see more than 10-15 tools.",
        inputSchema: {
          type: "object",
          properties: {
            tools: {
              type: "array",
              description: "Array of tool objects to audit",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  inputSchema: { type: "object" },
                },
                required: ["name", "description"],
              },
            },
          },
          required: ["tools"],
        },
      },
      {
        name: "get_best_practices",
        description:
          "Return the current checklist of MCP tool-description best practices derived from research (2026 papers + real-world agent testing). Use this as a reference when writing new tools.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// ─── Tool handlers ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "audit_tool": {
        const parsed = z
          .object({
            name: z.string().min(1),
            description: z.string().min(1),
            inputSchema: z.record(z.any()).optional(),
          })
          .parse(args);

        const result = auditTool(parsed as ToolInput);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "rewrite_tool_description": {
        const parsed = z
          .object({
            name: z.string().min(1),
            description: z.string().min(1),
            inputSchema: z.record(z.any()).optional(),
            context: z.string().optional(),
          })
          .parse(args);

        const rewritten = rewriteDescription(parsed);
        return {
          content: [
            {
              type: "text",
              text: rewritten,
            },
          ],
        };
      }

      case "audit_tool_list": {
        const parsed = z
          .object({
            tools: z.array(
              z.object({
                name: z.string(),
                description: z.string(),
                inputSchema: z.record(z.any()).optional(),
              })
            ),
          })
          .parse(args);

        const result = auditToolList(parsed.tools as ToolInput[]);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_best_practices": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(BEST_PRACTICES, null, 2),
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${err.errors.map((e) => e.message).join(", ")}`
      );
    }
    throw err;
  }
});

// ─── Start server ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Tool Auditor running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
