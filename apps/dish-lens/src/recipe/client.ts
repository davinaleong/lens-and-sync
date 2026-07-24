import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export const anthropicClient = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
