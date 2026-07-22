import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exampleFile = path.join(appDir, ".env.example");

const keys = readFileSync(exampleFile, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("=")[0]);

const missing = [];
const present = [];

for (const key of keys) {
  const value = process.env[key];
  (value === undefined || value.trim() === "" ? missing : present).push(key);
}

console.log("dish-lens — env check\n");
console.log(`Set (${present.length}/${keys.length}):`);
for (const key of present) console.log(`  ✓ ${key}`);

if (missing.length > 0) {
  console.log(`\nMissing or empty (${missing.length}):`);
  for (const key of missing) console.log(`  ✗ ${key}`);
  process.exitCode = 1;
} else {
  console.log("\nAll vars from .env.example are set.");
}
