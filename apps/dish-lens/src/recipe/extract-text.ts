import type Anthropic from "@anthropic-ai/sdk";

// Shared by every Claude call site in this app (recipe generation, chat,
// multi-dish adjudication) - the "thinking" content block some models emit
// ahead of the actual response means the text block is never simply
// `message.content[0]`. Deliberately has no other imports (unlike
// `client.ts`, which pulls in `config.ts` and its eager env validation) so
// every caller stays unit-testable against a hand-built fake client with no
// environment set up.
export function extractText(message: Anthropic.Message): string | undefined {
  const textBlock = message.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  return textBlock?.text;
}
