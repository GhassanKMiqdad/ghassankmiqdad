#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyToFirestoreEmulator, parseExport, sha256, validateAndMap } from "./engine.mjs";

function usage() {
  return `Supabase-to-Firebase migration planner (no cloud writes by default)

Usage:
  node scripts/migration/cli.mjs --input <export.json|export.jsonl> [options]

Options:
  --format auto|json|jsonl    Input format (default: inferred from extension/content)
  --report <path>             Write a JSON validation/reconciliation report
  --apply                     Explicitly write to the local Firestore Emulator only
  --target-project <demo-id>  Required with --apply; must begin demo-
  --checkpoint <path>         Required with --apply; resume state written atomically
  --help                      Show this help

Apply also requires FIRESTORE_EMULATOR_HOST=localhost:<port> (or loopback).`;
}
function parseArgs(args) {
  const options = { format: "auto", apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (["--input", "--format", "--report", "--target-project", "--checkpoint"].includes(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}
async function outputReport(report, outputPath) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(resolve(outputPath), text, { mode: 0o600 });
  else process.stdout.write(text);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.input) throw new Error(`--input is required.\n\n${usage()}`);
  if (!new Set(["auto", "json", "jsonl"]).has(options.format))
    throw new Error("--format must be auto, json, or jsonl.");
  if (options.apply && (!options.targetProject || !options.checkpoint)) {
    throw new Error("--apply requires both --target-project demo-… and --checkpoint <path>.");
  }
  if (!options.apply && (options.targetProject || options.checkpoint)) {
    throw new Error(
      "--target-project and --checkpoint are apply-only; default operation is a side-effect-free dry run.",
    );
  }
  const inputPath = resolve(options.input);
  const text = await readFile(inputPath, "utf8");
  const format = options.format === "auto" && /\.(jsonl|ndjson)$/i.test(inputPath) ? "jsonl" : options.format;
  const parsed = parseExport(text, format);
  const { records, report } = validateAndMap(parsed, sha256(text));
  if (report.issues.some((entry) => entry.severity === "error")) {
    await outputReport(report, options.report);
    process.exitCode = 1;
    return;
  }
  if (!options.apply) {
    await outputReport(report, options.report);
    if (options.report)
      process.stdout.write(
        `Dry run valid: report saved to ${resolve(options.report)}. No Firebase connection or data writes were made.\n`,
      );
    return;
  }
  report.mode = "apply";
  try {
    const result = await applyToFirestoreEmulator(records, {
      targetProject: options.targetProject,
      checkpointPath: resolve(options.checkpoint),
      inputSha256: sha256(text),
    });
    report.apply = {
      imported: result.imported,
      alreadyPresent: result.alreadyPresent,
      completed: result.completed,
      checkpoint: resolve(options.checkpoint),
    };
    report.reconciliation.completedTargetRows = result.completed;
    report.reconciliation.remainingTargetRows = Math.max(
      0,
      report.reconciliation.expectedTargetRows - result.completed,
    );
    await outputReport(report, options.report);
    process.stdout.write(
      `Emulator apply completed ${result.completed}/${report.reconciliation.expectedTargetRows} rows. No production Firebase target is supported.\n`,
    );
  } catch (error) {
    report.valid = false;
    report.issues.push({
      severity: "error",
      code: "APPLY_REFUSED_OR_FAILED",
      table: "<apply>",
      row: null,
      message: error instanceof Error ? error.message : "Apply failed.",
    });
    await outputReport(report, options.report);
    process.exitCode = 1;
  }
}
main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
