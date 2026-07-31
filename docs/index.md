---
layout: home

hero:
  name: "Lens and Sync"
  text: "Food analysis & knowledge sync"
  tagline: DishLens turns a photo into a recipe. DriveSync turns your Drive files into a searchable knowledge base.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: API reference
      link: /reference/dish-lens

features:
  - icon: 🍽️
    title: dish-lens
    details: Upload a dish photo and get back recipe suggestions, nutritional data, and a persistent chat history. Backed by Google Vision, Anthropic Claude, and Edamam.
  - icon: 🔄
    title: drive-sync
    details: Periodically indexes your Google Drive files using OpenAI embeddings and Pinecone. Exposes a semantic search endpoint for RAG-style retrieval.
  - icon: 🔐
    title: Shared auth
    details: JWT access + refresh token rotation, password-based registration, email verification, OTP login, and password reset — all in one shared package.
  - icon: 📦
    title: Monorepo
    details: pnpm workspaces + Turborepo. Six shared packages (auth, config, db, logger, types, utils) eliminate duplication between the two services.
---
