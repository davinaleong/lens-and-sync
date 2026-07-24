import { ImageAnnotatorClient } from "@google-cloud/vision";
import { config } from "../config.js";

export const visionClient = new ImageAnnotatorClient({
  keyFilename: config.GOOGLE_CLOUD_CREDENTIALS_JSON,
  projectId: config.GOOGLE_CLOUD_PROJECT_ID,
});
