import { Pinecone, type Index } from "@pinecone-database/pinecone";
import { config } from "../config.js";

const pinecone = new Pinecone({ apiKey: config.PINECONE_API_KEY });

export const vectorIndex: Index = pinecone.index(config.PINECONE_INDEX_NAME).namespace(config.PINECONE_NAMESPACE);
