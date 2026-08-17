import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();
app.get("/health", (c) => c.json({ status: "ok", service: "pv-core-api" }));

const port = Number(process.env.API_PORT ?? 8789);
serve({ fetch: app.fetch, port });
console.log(`pv-core api listening on :${port}`);
