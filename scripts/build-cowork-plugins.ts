#!/usr/bin/env npx tsx
/**
 * build-cowork-plugins.ts
 *
 * Transforms skills from zivtech-meta-skills into Cowork-compatible plugin format.
 * Reads each skill's SKILL.md, applies adaptations for Cowork's web environment
 * (no CLI tools), and writes the result to plugins/ directory.
 *
 * Usage:
 *   npx tsx scripts/build-cowork-plugins.ts --source <path-to-zivtech-meta-skills> [--output plugins/]
 *
 * The script:
 * 1. Discovers all skills in the source repo
 * 2. Reads each SKILL.md file
 * 3. Applies Cowork adaptations (replaces CLI tool references)
 * 4. Writes adapted plugin files to output directory
 * 5. Generates a manifest of all processed plugins
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

interface SkillMeta {
  name: string;
  description: string;
  sourcePath: string;
  lines: number;
  category: 'compatible' | 'minor-adaptation' | 'major-adaptation' | 'excluded';
}

interface BuildResult {
  processed: number;
  adapted: number;
  excluded: number;
  errors: string[];
}

// Skills excluded from Cowork distribution (infrastructure/meta)
const EXCLUDED_SKILLS = new Set([
  'spec-kitty-bridge',
  'test-builder',
  'test-critic',
]);

// CLI tool patterns to replace for Cowork compatibility
// Patterns match actual skill content: "Use Read to...", "Use Grep to...", etc.
const CLI_TOOL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /- Use Read to (load|examine|inspect|view|check|read) /gi,
    replacement: '- Review the provided ',
  },
  {
    pattern: /Use Read to (load|examine|inspect|view|check|read) /gi,
    replacement: 'Review the provided ',
  },
  {
    pattern: /- Use Grep(?:\/Glob)? to (verify|find|search|check|locate|confirm) /gi,
    replacement: '- In the provided code, $1 ',
  },
  {
    pattern: /Use Grep(?:\/Glob)? to (verify|find|search|check|locate|confirm) /gi,
    replacement: 'In the provided code, $1 ',
  },
  {
    pattern: /- Use Bash (?:with git )?to (verify|check|analyze|trace|run|examine) /gi,
    replacement: '- Ask the user to $1 ',
  },
  {
    pattern: /Use Bash (?:with git )?to (verify|check|analyze|trace|run|examine) /gi,
    replacement: 'Ask the user to $1 ',
  },
  {
    pattern: /- Read broadly around referenced code/gi,
    replacement: '- Review the broader context around referenced code',
  },
  {
    pattern: /- Read context around /gi,
    replacement: '- Review the context around ',
  },
];

function parseYamlFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (kvMatch) {
      meta[kvMatch[1]] = kvMatch[2];
    }
  }

  return { meta, body: match[2] };
}

function discoverSkills(sourceDir: string): SkillMeta[] {
  const skills: SkillMeta[] = [];

  // Standard skill directories (top-level)
  for (const entry of readdirSync(sourceDir)) {
    const skillPath = join(sourceDir, entry, '.claude', 'skills');
    if (existsSync(skillPath) && statSync(skillPath).isDirectory()) {
      for (const skillDir of readdirSync(skillPath)) {
        const skillFile = join(skillPath, skillDir, 'SKILL.md');
        if (existsSync(skillFile)) {
          const content = readFileSync(skillFile, 'utf-8');
          const { meta } = parseYamlFrontmatter(content);
          skills.push({
            name: meta.name || skillDir,
            description: meta.description || '',
            sourcePath: skillFile,
            lines: content.split('\n').length,
            category: EXCLUDED_SKILLS.has(meta.name || skillDir) ? 'excluded' : 'compatible',
          });
        }
      }
    }
  }

  // Subdirectory skills (zivtech-data-skills, zivtech-proposal-skills, integration, meta)
  const subDirs = [
    'zivtech-data-skills/critic',
    'zivtech-data-skills/planner',
    'zivtech-proposal-skills/planner',
    'integration/spec-kitty-bridge',
    'meta/test-builder',
    'meta/test-critic',
  ];

  for (const subDir of subDirs) {
    const base = join(sourceDir, subDir, '.claude', 'skills');
    if (existsSync(base) && statSync(base).isDirectory()) {
      for (const skillDir of readdirSync(base)) {
        const skillFile = join(base, skillDir, 'SKILL.md');
        if (existsSync(skillFile)) {
          const content = readFileSync(skillFile, 'utf-8');
          const { meta } = parseYamlFrontmatter(content);
          const name = meta.name || skillDir;
          // Avoid duplicates
          if (!skills.some((s) => s.name === name)) {
            skills.push({
              name,
              description: meta.description || '',
              sourcePath: skillFile,
              lines: content.split('\n').length,
              category: EXCLUDED_SKILLS.has(name) ? 'excluded' : 'compatible',
            });
          }
        }
      }
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function adaptForCowork(content: string): { adapted: string; changeCount: number } {
  let adapted = content;
  let changeCount = 0;

  for (const { pattern, replacement } of CLI_TOOL_PATTERNS) {
    const before = adapted;
    adapted = adapted.replace(pattern, replacement);
    if (adapted !== before) {
      changeCount++;
    }
  }

  return { adapted, changeCount };
}

function buildPlugins(sourceDir: string, outputDir: string): BuildResult {
  const result: BuildResult = { processed: 0, adapted: 0, excluded: 0, errors: [] };

  mkdirSync(outputDir, { recursive: true });

  const skills = discoverSkills(sourceDir);
  const manifest: Array<{ name: string; description: string; lines: number; adapted: boolean }> = [];

  for (const skill of skills) {
    if (skill.category === 'excluded') {
      result.excluded++;
      continue;
    }

    try {
      const content = readFileSync(skill.sourcePath, 'utf-8');
      const { adapted, changeCount } = adaptForCowork(content);

      const outputPath = join(outputDir, `${skill.name}.md`);
      writeFileSync(outputPath, adapted);

      manifest.push({
        name: skill.name,
        description: skill.description,
        lines: skill.lines,
        adapted: changeCount > 0,
      });

      result.processed++;
      if (changeCount > 0) {
        result.adapted++;
      }
    } catch (err) {
      result.errors.push(`${skill.name}: ${err}`);
    }
  }

  // Write manifest
  const manifestPath = join(outputDir, '_manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ generated: new Date().toISOString(), plugins: manifest }, null, 2));

  return result;
}

// CLI entry point
const args = process.argv.slice(2);
const sourceIdx = args.indexOf('--source');
const outputIdx = args.indexOf('--output');

const sourceDir = sourceIdx >= 0 ? args[sourceIdx + 1] : '';
const outputDir = outputIdx >= 0 ? args[outputIdx + 1] : 'plugins';

if (!sourceDir) {
  console.error('Usage: npx tsx scripts/build-cowork-plugins.ts --source <path-to-zivtech-meta-skills> [--output plugins/]');
  process.exit(1);
}

if (!existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`);
  process.exit(1);
}

console.log(`Building Cowork plugins from: ${sourceDir}`);
console.log(`Output directory: ${outputDir}`);

const result = buildPlugins(sourceDir, outputDir);

console.log(`\nResults:`);
console.log(`  Processed: ${result.processed}`);
console.log(`  Adapted:   ${result.adapted} (CLI tool references replaced)`);
console.log(`  Excluded:  ${result.excluded} (infrastructure skills)`);
if (result.errors.length > 0) {
  console.log(`  Errors:    ${result.errors.length}`);
  for (const err of result.errors) {
    console.log(`    - ${err}`);
  }
}
console.log(`\nManifest written to: ${outputDir}/_manifest.json`);
