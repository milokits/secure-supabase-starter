#!/usr/bin/env node
// After `vite build`: make sure nothing secret or source-revealing ended up in dist/.
// Fails the build if it finds a service_role key, a Supabase secret key, other common secret
// key patterns, or .map files. Values are never printed in full.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

export const RULES = [
  [/\bsb_secret_[A-Za-z0-9_-]{20,}/g, "Supabase secret key"],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g, "Stripe live secret key"],
  [/\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g, "OpenAI key"],
  [/\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}/g, "Anthropic key"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "AWS access key"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g, "GitHub token"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "private key"],
];
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

export function scanText(text) {
  const found = [];
  for (const [re, name] of RULES) for (const m of text.matchAll(re)) found.push(`${name} ${m[0].slice(0, 8)}…`);
  for (const m of text.matchAll(JWT)) {
    try { if (JSON.parse(Buffer.from(m[0].split(".")[1], "base64url").toString()).role === "service_role") found.push("Supabase service_role key eyJ…"); } catch {}
  }
  return found;
}
function walk(dir) { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }

export function checkDir(dir) {
  const problems = [];
  for (const file of walk(dir)) {
    if (extname(file) === ".map") { problems.push(`${file}: source map would be public`); continue; }
    if (![".js", ".mjs", ".html", ".css", ".json", ".txt"].includes(extname(file))) continue;
    for (const f of scanText(readFileSync(file, "utf8"))) problems.push(`${file}: ${f}`);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || "dist";
  const problems = checkDir(dir);
  if (problems.length) {
    console.error("Bundle check FAILED. These would be public to every visitor:\n  - " + problems.join("\n  - ") + "\nRotate any exposed key and move it to a server-side function.");
    process.exitCode = 1;
  } else console.log(`Bundle check passed: no secret keys or source maps in ${dir}/`);
}
