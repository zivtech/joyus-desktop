#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const TEXT_EXTENSIONS = new Set([
  '.cfg',
  '.csv',
  '.env',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.toml',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
]);

const PLACEHOLDER_RE = /\b(REPLACE_ME|PLACEHOLDER|YOUR_|ENV_VAR|EXAMPLE|example|xxx|xxxx|redacted|<[^>]+>|\[[^\]]+\])\b/;

const PATTERNS = [
  {
    name: 'auth-header',
    regex: /Authorization:\s*(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  },
  {
    name: 'cookie-header',
    regex: /\b(Set-)?Cookie:\s*[^\n\r]{8,}/gi,
  },
  {
    name: 'google-api-key',
    regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  },
  {
    name: 'aws-access-key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: 'private-key-block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: 'credential-url',
    regex: /https?:\/\/[^\s:@/]+:[^\s@/]+@[^\s)]+/gi,
  },
  {
    name: 'labeled-secret',
    regex: /\b(api[_ -]?key|apikey|secret|token|password|client[_ -]?secret|auth[_ -]?header|cookie)\b\s*[:=]\s*["']?[^"'\s`]{8,}/gi,
  },
  {
    name: 'labeled-base64',
    regex: /\b(base64|basic auth|http basic auth)\b[^\n\r]{0,80}\b[A-Za-z0-9+/]{30,}={0,2}\b/gi,
  },
  {
    name: 'basic-auth-pair',
    regex: /\bHTTP Basic Auth\b[^\n\r]{0,200}\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s*`?\s*:\s*`?[^`\s]{8,}`?/gi,
  },
  {
    name: 'inline-basic-auth-secret',
    regex: /\bHTTP Basic Auth\b[^\n\r]{0,120}:\s*[A-Za-z0-9._~+/-]{8,}/gi,
  },
  {
    name: 'private-token-prefix',
    regex: /\b(ghp|github_pat|glpat|xox[baprs]|sk-[A-Za-z0-9])[A-Za-z0-9_-]{16,}\b/g,
  },
];

function usage() {
  console.log(`Usage: node scripts/scan-sensitive-output.mjs [--help] <file-or-dir>...

Fails when generated docs contain likely credentials, API keys, auth headers,
cookies, private keys, or private tokens. Findings intentionally do not print
matched secret values.

Options:
  --help                Show this help.
  --allow-placeholder   Ignore obvious placeholder values. Enabled by default.
  --strict-placeholder  Also report placeholder-looking matches.
`);
}

function walk(target, files = []) {
  if (!fs.existsSync(target)) {
    return files;
  }

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const name = path.basename(target);
    if (IGNORED_DIRS.has(name)) {
      return files;
    }

    for (const entry of fs.readdirSync(target)) {
      walk(path.join(target, entry), files);
    }
    return files;
  }

  if (!stat.isFile()) {
    return files;
  }

  const ext = path.extname(target);
  if (TEXT_EXTENSIONS.has(ext)) {
    files.push(target);
  }

  return files;
}

function lineNumberForIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function lineTextForIndex(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

function scanFile(file, allowPlaceholders) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }

  const findings = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const value = match[0];
      const lineText = lineTextForIndex(text, match.index);
      if (/^\s*regex:\s*\//.test(lineText)) {
        continue;
      }
      if (pattern.name === 'labeled-base64' && path.basename(file).startsWith('lighthouse-')) {
        continue;
      }
      if (allowPlaceholders && PLACEHOLDER_RE.test(value)) {
        continue;
      }

      findings.push({
        file,
        line: lineNumberForIndex(text, match.index),
        pattern: pattern.name,
      });
    }
  }

  return findings;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const allowPlaceholders = !args.includes('--strict-placeholder');
const targets = args.filter((arg) => !arg.startsWith('--'));
const files = targets.flatMap((target) => walk(path.resolve(target)));
const findings = files.flatMap((file) => scanFile(file, allowPlaceholders));

if (findings.length > 0) {
  console.error(`Sensitive output scan failed with ${findings.length} finding(s).`);
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.pattern}`);
  }
  process.exit(1);
}

console.log(`Sensitive output scan passed for ${files.length} file(s).`);
