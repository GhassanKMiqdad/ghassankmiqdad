export type MigrationMode = "dry-run" | "apply";

export type MigrationArguments = {
  help: boolean;
  mode: MigrationMode;
};

export function parseMigrationArguments(args: readonly string[]): MigrationArguments {
  const valueFlags = ["--confirm-apply=", "--confirm-production="] as const;
  const allowed = new Set(["--help", "--dry-run", "--apply"]);
  const unknown = args.filter(
    (argument) => !allowed.has(argument) && !valueFlags.some((prefix) => argument.startsWith(prefix)),
  );
  if (unknown.length > 0) throw new Error(`Unknown migration argument: ${unknown[0]}.`);

  for (const prefix of valueFlags) {
    const values = args.filter((argument) => argument.startsWith(prefix));
    if (values.length > 1 || values.some((argument) => argument.slice(prefix.length).trim().length === 0)) {
      throw new Error(`Invalid or repeated migration confirmation argument: ${prefix}<project-id>.`);
    }
  }

  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run");
  if (apply && dryRun) throw new Error("Choose exactly one migration mode; --apply and --dry-run cannot be combined.");
  if (!apply && args.some((argument) => valueFlags.some((prefix) => argument.startsWith(prefix)))) {
    throw new Error("Migration confirmation flags are valid only with --apply.");
  }

  return { help: args.includes("--help"), mode: apply ? "apply" : "dry-run" };
}
