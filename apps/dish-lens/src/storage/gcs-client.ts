import { Storage } from "@google-cloud/storage";
import { config } from "../config.js";

const storage = new Storage({
  credentials: config.GOOGLE_CLOUD_CREDENTIALS_JSON,
  projectId: config.GOOGLE_CLOUD_PROJECT_ID,
});

export const uploadsBucket = storage.bucket(config.GCS_BUCKET_NAME);
