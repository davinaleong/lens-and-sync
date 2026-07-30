import OpenAI from "openai";
import { config } from "../config.js";

export const openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });
