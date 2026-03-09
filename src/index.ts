import { Hono } from "hono";
import { createMcpHandler } from "mcp-handler";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const app = new Hono();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { db: { schema: "dashboard_portfolios" } }
);

const handler = createMcpHandler(
  (server) => {
    // Tool 1: Get survey overview stats
    server.tool(
      "get-survey-stats",
      "Get aggregated survey statistics: total responses, breakdown by role, ecosystem, portfolio requirement, review time, and preferred format.",
      {},
      async () => {
        const { data, error } = await supabase
          .from("responses")
          .select("role, ecosystem, requires_portfolio, review_time, preferred_format");

        if (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }

        const total = data.length;

        const countBy = (key: string) => {
          const counts: Record<string, number> = {};
          for (const row of data) {
            const val = (row as Record<string, string>)[key] ?? "unknown";
            counts[val] = (counts[val] || 0) + 1;
          }
          return counts;
        };

        const stats = {
          total_responses: total,
          by_role: countBy("role"),
          by_ecosystem: countBy("ecosystem"),
          by_requires_portfolio: countBy("requires_portfolio"),
          by_review_time: countBy("review_time"),
          by_preferred_format: countBy("preferred_format"),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
        };
      }
    );

    // Tool 2: Get importance rankings
    server.tool(
      "get-importance-rankings",
      "Get averaged importance ratings across all survey responses. Criteria: visual_ui, process, usability, writing, results, technical (scale 1-6).",
      {},
      async () => {
        const { data, error } = await supabase
          .from("responses")
          .select("importance_ratings");

        if (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }

        const criteria = [
          "visual_ui",
          "process",
          "usability",
          "writing",
          "results",
          "technical",
        ];
        const sums: Record<string, number> = {};
        const counts: Record<string, number> = {};

        for (const c of criteria) {
          sums[c] = 0;
          counts[c] = 0;
        }

        for (const row of data) {
          const ratings = row.importance_ratings as Record<string, number> | null;
          if (!ratings) continue;
          for (const c of criteria) {
            if (ratings[c] != null) {
              sums[c] += ratings[c];
              counts[c]++;
            }
          }
        }

        const averages: Record<string, number> = {};
        for (const c of criteria) {
          averages[c] = counts[c] > 0
            ? Math.round((sums[c] / counts[c]) * 100) / 100
            : 0;
        }

        const ranked = Object.entries(averages)
          .sort(([, a], [, b]) => b - a)
          .map(([criterion, avg], i) => ({
            rank: i + 1,
            criterion,
            average: avg,
            responses: counts[criterion],
          }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { total_responses: data.length, rankings: ranked },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Tool 3: Search/filter responses
    server.tool(
      "search-responses",
      "Search and filter survey responses by role, ecosystem, or country. Returns matching responses with all fields.",
      {
        role: z
          .enum([
            "design_manager",
            "recruiter",
            "developer",
            "ux_ui_designer",
          ])
          .optional()
          .describe("Filter by respondent role"),
        ecosystem: z
          .enum([
            "consultora",
            "startup",
            "cliente_final",
            "agencia",
            "autonoma",
          ])
          .optional()
          .describe("Filter by work ecosystem"),
        country: z
          .string()
          .optional()
          .describe("Filter by work country (partial match, case-insensitive)"),
        limit: z
          .number()
          .min(1)
          .max(50)
          .default(10)
          .describe("Max results to return (default 10, max 50)"),
      },
      async ({ role, ecosystem, country, limit }) => {
        let query = supabase
          .from("responses")
          .select(
            "id, created_at, role, ecosystem, work_country, requires_portfolio, review_time, preferred_format, importance_ratings, missing_features, red_flags, open_feedback"
          )
          .order("created_at", { ascending: false })
          .limit(limit);

        if (role) query = query.eq("role", role);
        if (ecosystem) query = query.eq("ecosystem", ecosystem);
        if (country) query = query.ilike("work_country", `%${country}%`);

        const { data, error } = await query;

        if (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { count: data.length, responses: data },
                null,
                2
              ),
            },
          ],
        };
      }
    );
  },
  {},
  {
    basePath: "/",
    maxDuration: 60,
    verboseLogs: true,
  }
);

// MCP endpoint
app.all("/mcp/*", async (c) => {
  return await handler(c.req.raw);
});

// Welcome page
app.get("/", (c) => {
  return c.json({
    name: "Dashboard Portfolios MCP Server",
    version: "1.0.0",
    description:
      "MCP server exposing survey data from the Dashboard Portfolios project",
    mcp_endpoint: "/mcp",
    tools: [
      "get-survey-stats",
      "get-importance-rankings",
      "search-responses",
    ],
  });
});

export default app;
