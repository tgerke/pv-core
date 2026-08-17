// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import remarkHeadingId from "remark-heading-id";
import starlightLinksValidator from "starlight-links-validator";

export default defineConfig({
  site: "https://tgerke.github.io",
  base: "/pv-core",
  markdown: {
    remarkPlugins: [remarkHeadingId],
  },
  integrations: [
    starlight({
      title: "pv-core",
      description:
        "A safety database for clinical trials where the regulatory clock is a query, not a tracker spreadsheet",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/tgerke/pv-core" }],
      customCss: ["./src/styles/custom.css"],
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
      sidebar: [
        { label: "Getting started", items: ["getting-started"] },
        {
          label: "User guide",
          items: [
            "user-guide",
            "user-guide/intake-and-data-entry",
            "user-guide/coding-and-assessment",
            "user-guide/clocks-and-submissions",
            "user-guide/dsur",
            "user-guide/attachments",
            "user-guide/administration",
          ],
        },
        {
          label: "Technical guide",
          items: ["data-model", "compliance", "validation", "sql-access", "roadmap"],
        },
        { label: "Cookbook", items: ["cookbook"] },
        { label: "Reference", items: ["glossary", "decisions"] },
      ],
    }),
  ],
});
