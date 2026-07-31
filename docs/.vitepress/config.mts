import { defineConfig } from "vitepress";

// Set VITEPRESS_BASE to /<repo-name>/ when deploying to GitHub Pages
// for a project repo (e.g. /lens-and-sync/). Defaults to / for custom domains.
const base = process.env.VITEPRESS_BASE ?? "/";

export default defineConfig({
  base,
  title: "Lens and Sync",
  description: "DishLens food-analysis API and DriveSync RAG pipeline — developer documentation.",
  head: [["link", { rel: "icon", type: "image/svg+xml", href: `${base}favicon.svg` }]],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Lens and Sync",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", items: [
        { text: "DishLens API", link: "/reference/dish-lens" },
        { text: "DriveSync API", link: "/reference/drive-sync" },
        { text: "Environment variables", link: "/reference/environment-variables" },
      ]},
      { text: "Packages", link: "/packages/" },
    ],

    sidebar: {
      "/guide/": [
        { text: "Guide", items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Architecture", link: "/guide/architecture" },
          { text: "Deployment", link: "/guide/deployment" },
        ]},
      ],
      "/reference/": [
        { text: "API Reference", items: [
          { text: "DishLens", link: "/reference/dish-lens" },
          { text: "DriveSync", link: "/reference/drive-sync" },
          { text: "Environment variables", link: "/reference/environment-variables" },
        ]},
      ],
      "/packages/": [
        { text: "Shared packages", items: [
          { text: "Overview", link: "/packages/" },
          { text: "shared-auth", link: "/packages/#shared-auth" },
          { text: "shared-config", link: "/packages/#shared-config" },
          { text: "shared-db", link: "/packages/#shared-db" },
          { text: "shared-logger", link: "/packages/#shared-logger" },
          { text: "shared-types", link: "/packages/#shared-types" },
          { text: "shared-utils", link: "/packages/#shared-utils" },
        ]},
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/davinaleong/lens-and-sync" },
    ],

    footer: {
      message: "Released under the MIT License.",
    },

    search: { provider: "local" },

    editLink: {
      pattern: "https://github.com/davinaleong/lens-and-sync/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },

  markdown: {
    lineNumbers: true,
  },

  // localhost links in docs are intentional examples, not real hrefs
  ignoreDeadLinks: [/^http:\/\/localhost/],
});
