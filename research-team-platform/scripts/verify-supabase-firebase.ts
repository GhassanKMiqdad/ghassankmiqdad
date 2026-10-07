import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";

import {
  mapActivityLog,
  mapAuthUser,
  mapComment,
  mapDocument,
  mapMembership,
  mapPermissionCatalogs,
  mapProfile,
  mapProject,
  mapTask,
  isSafeSubsetEqual,
  type LegacyRow,
  type MappedDocument,
  type SourceAuthUser,
} from "./migration/mapping";
import {
  createSourceClient,
  downloadSourceObject,
  listStorageObjects,
  readAuthUsers,
  readTableRows,
  SOURCE_BUCKET,
} from "./migration/source";
import { getFirebaseTarget, normalizeFirestoreValue } from "./migration/target";

const FIRESTORE_PAGE_SIZE = 400;
const SAMPLE_LIMIT = 500;
const VERIFY_CONCURRENCY = 3;
type Finding = { severity: "blocking" | "review"; entity: string; id?: string; detail: string };
type CollectionResult = {
  sourceRows: number;
  expectedTargetRows: number;
  actualTargetRows: number;
  missing: number;
  mismatched: number;
  unexpected: number;
};
type VerificationReport = {
  runId: string;
  generatedAt: string;
  sourceBucket: string;
  targetProjectId: string;
  checksumVerification: boolean;
  collections: Record<string, CollectionResult>;
  auth: {
    sourceUsers: number;
    targetUsers: number;
    missing: number;
    mismatched: number;
    unexpected: number;
    passwordResetRequired: number;
  };
  storage: {
    sourceObjects: number;
    targetObjects: number;
    missing: number;
    sizeMismatched: number;
    checksumMismatched: number;
    unexpected: number;
    sourceBytes: number;
    targetBytes: number;
  };
  statusCounts: Record<string, Record<string, number>>;
  catalogDifferences: {
    addedPermissionKeys: string[];
    removedPermissionKeys: string[];
    changedRolePermissions: string[];
  };
  brokenReferences: number;
  findingCounts: { blocking: number; review: number };
  findings: Finding[];
  notes: string[];
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function addFinding(
  report: VerificationReport,
  severity: Finding["severity"],
  entity: string,
  id: string | undefined,
  detail: string,
) {
  report.findingCounts[severity] += 1;
  if (report.findings.length < SAMPLE_LIMIT) report.findings.push({ severity, entity, ...(id ? { id } : {}), detail });
}

function freshCollectionResult(): CollectionResult {
  return { sourceRows: 0, expectedTargetRows: 0, actualTargetRows: 0, missing: 0, mismatched: 0, unexpected: 0 };
}

function asRecord(value: unknown): LegacyRow {
  const normalized = normalizeFirestoreValue(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? (normalized as LegacyRow) : {};
}

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function bumpCount(target: Record<string, number>, value: unknown) {
  const key = String(value ?? "<null>");
  target[key] = (target[key] ?? 0) + 1;
}

async function readTargetCollection(
  target: ReturnType<typeof getFirebaseTarget>,
  collection: string,
): Promise<Map<string, LegacyRow>> {
  const records = new Map<string, LegacyRow>();
  const ref = target.db.collection(collection);
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    const base = ref.orderBy(FieldPath.documentId());
    const query = cursor ? base.startAfter(cursor).limit(FIRESTORE_PAGE_SIZE) : base.limit(FIRESTORE_PAGE_SIZE);
    const snapshot = await query.get();
    for (const document of snapshot.docs) records.set(document.id, asRecord(document.data()));
    if (snapshot.docs.length < FIRESTORE_PAGE_SIZE) return records;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}

async function readAllTargetAuthUsers(target: ReturnType<typeof getFirebaseTarget>) {
  const users: Awaited<ReturnType<typeof target.auth.listUsers>>["users"] = [];
  let pageToken: string | undefined;
  do {
    const page = await target.auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

function buildExpectedCollections(input: {
  authUsers: SourceAuthUser[];
  profiles: LegacyRow[];
  projects: LegacyRow[];
  members: LegacyRow[];
  grants: LegacyRow[];
  tasks: LegacyRow[];
  documents: LegacyRow[];
  comments: LegacyRow[];
  activityLogs: LegacyRow[];
  legacyPermissions: LegacyRow[];
}) {
  const profilesById = new Map(input.profiles.map((profile) => [String(profile.id), profile]));
  const grantsByMember = new Map<string, string[]>();
  for (const grant of input.grants) {
    const key = `${grant.project_id}|${grant.user_id}`;
    const list = grantsByMember.get(key) ?? [];
    list.push(String(grant.permission_key ?? ""));
    grantsByMember.set(key, list);
  }
  const expected = new Map<string, MappedDocument[]>();
  const add = (document: MappedDocument) =>
    expected.set(document.collection, [...(expected.get(document.collection) ?? []), document]);

  input.authUsers.forEach((user) => add(mapProfile(profilesById.get(user.id) ?? null, user)));
  input.projects.forEach((row) => add(mapProject(row)));
  for (const row of input.members) {
    const result = mapMembership(row, grantsByMember.get(`${row.project_id}|${row.user_id}`) ?? []);
    add(result.membership);
    result.grants.forEach(add);
  }
  input.tasks.forEach((row) => add(mapTask(row)));
  input.documents.forEach((row) => add(mapDocument(row)));
  input.comments.forEach((row) => add(mapComment(row)));
  input.activityLogs.forEach((row) => add(mapActivityLog(row)));
  mapPermissionCatalogs(input.legacyPermissions).forEach(add);
  return { expected, profilesById, grantsByMember };
}

function compareCollection(
  report: VerificationReport,
  collection: string,
  expectedDocs: MappedDocument[],
  targetDocs: Map<string, LegacyRow>,
  sourceRows: number,
) {
  const result = (report.collections[collection] ??= freshCollectionResult());
  result.sourceRows = sourceRows;
  result.expectedTargetRows = expectedDocs.length;
  result.actualTargetRows = targetDocs.size;
  const expectedIds = new Set(expectedDocs.map((document) => document.id));
  for (const document of expectedDocs) {
    const actual = targetDocs.get(document.id);
    if (!actual) {
      result.missing += 1;
      addFinding(report, "blocking", collection, document.id, "Expected mapped record is missing from Firebase.");
    } else if (!isSafeSubsetEqual(document.data, actual)) {
      result.mismatched += 1;
      addFinding(
        report,
        "blocking",
        collection,
        document.id,
        "Firebase record differs from the safe source projection.",
      );
    }
  }
  for (const id of targetDocs.keys()) {
    if (!expectedIds.has(id)) {
      result.unexpected += 1;
      addFinding(report, "review", collection, id, "Firebase contains a record not present in the source projection.");
    }
  }
}

function checkBrokenReferences(report: VerificationReport, targetDocs: Map<string, Map<string, LegacyRow>>) {
  const profiles = targetDocs.get("profiles") ?? new Map<string, LegacyRow>();
  const projects = targetDocs.get("projects") ?? new Map<string, LegacyRow>();
  const memberships = targetDocs.get("project_members") ?? new Map<string, LegacyRow>();
  const tasks = targetDocs.get("tasks") ?? new Map<string, LegacyRow>();
  const documents = targetDocs.get("documents") ?? new Map<string, LegacyRow>();
  const storagePaths = new Set<string>();

  for (const [id, project] of projects) {
    if (project.created_by && !profiles.has(String(project.created_by))) {
      report.brokenReferences += 1;
      addFinding(report, "blocking", "projects", id, "created_by does not resolve to a Firebase profile.");
    }
  }
  for (const [id, member] of memberships) {
    if (!projects.has(String(member.project_id)) || !profiles.has(String(member.user_id))) {
      report.brokenReferences += 1;
      addFinding(report, "blocking", "project_members", id, "Project or user reference is missing in Firebase.");
    }
  }
  for (const [id, task] of tasks) {
    if (!projects.has(String(task.project_id)) || (task.created_by && !profiles.has(String(task.created_by)))) {
      report.brokenReferences += 1;
      addFinding(report, "blocking", "tasks", id, "Project or creator reference is missing in Firebase.");
    }
    if (task.assigned_to && !memberships.has(`${task.project_id}_${task.assigned_to}`)) {
      report.brokenReferences += 1;
      addFinding(report, "blocking", "tasks", id, "Assignee membership is missing in Firebase.");
    }
  }
  for (const [id, document] of documents) {
    if (
      !projects.has(String(document.project_id)) ||
      (document.uploaded_by && !profiles.has(String(document.uploaded_by)))
    ) {
      report.brokenReferences += 1;
      addFinding(report, "blocking", "documents", id, "Project or uploader profile reference is missing in Firebase.");
    }
    if (typeof document.storage_path === "string") storagePaths.add(document.storage_path);
  }
  const comments = targetDocs.get("comments") ?? new Map<string, LegacyRow>();
  for (const [id, comment] of comments) {
    if (!projects.has(String(comment.project_id)) || (comment.task_id && !tasks.has(String(comment.task_id)))) {
      report.brokenReferences += 1;
      addFinding(report, "blocking", "comments", id, "Project or task reference is missing in Firebase.");
    }
    if (comment.author_id && !profiles.has(String(comment.author_id))) {
      report.brokenReferences += 1;
      addFinding(report, "blocking", "comments", id, "Author profile reference is missing in Firebase.");
    }
  }
  return storagePaths;
}

function currentCatalogDelta(legacyPermissions: LegacyRow[], legacyRoles: LegacyRow[]) {
  const currentCatalogs = mapPermissionCatalogs(legacyPermissions);
  const currentKeys = new Set(
    currentCatalogs.filter((item) => item.collection === "permissions").map((item) => item.id),
  );
  const legacyKeys = new Set(legacyPermissions.map((row) => String(row.key)));
  const currentRoles = new Set(
    currentCatalogs
      .filter((item) => item.collection === "role_permissions")
      .map((item) => `${item.data.role}|${item.data.permission_key}`),
  );
  const legacyRoleKeys = new Set(legacyRoles.map((row) => `${row.role}|${row.permission_key}`));
  return {
    currentCatalogs,
    addedPermissionKeys: [...currentKeys].filter((key) => !legacyKeys.has(key)).sort(),
    removedPermissionKeys: [...legacyKeys].filter((key) => !currentKeys.has(key)).sort(),
    changedRolePermissions: [...new Set([...currentRoles, ...legacyRoleKeys])]
      .filter((key) => currentRoles.has(key) !== legacyRoleKeys.has(key))
      .sort(),
  };
}

function escapeMarkdown(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function renderMarkdownReport(report: VerificationReport): string {
  const lines = [
    "# Supabase → Firebase Verification Report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Target project: \`${escapeMarkdown(report.targetProjectId)}\``,
    `- Source bucket: \`${escapeMarkdown(report.sourceBucket)}\``,
    `- Storage checksum verification: ${report.checksumVerification ? "enabled (SHA-256)" : "skipped"}`,
    "",
    "## Collection reconciliation",
    "",
    "| Collection | Source rows | Expected target | Actual target | Missing | Mismatched | Unexpected |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(report.collections)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([name, result]) =>
          `| ${escapeMarkdown(name)} | ${result.sourceRows} | ${result.expectedTargetRows} | ${result.actualTargetRows} | ${result.missing} | ${result.mismatched} | ${result.unexpected} |`,
      ),
    "",
    "## Authentication",
    "",
    `- Source users: ${report.auth.sourceUsers}`,
    `- Firebase users: ${report.auth.targetUsers}`,
    `- Missing / mismatched / unexpected: ${report.auth.missing} / ${report.auth.mismatched} / ${report.auth.unexpected}`,
    `- Password reset required: ${report.auth.passwordResetRequired}`,
    "",
    "## Storage",
    "",
    `- Source / Firebase objects: ${report.storage.sourceObjects} / ${report.storage.targetObjects}`,
    `- Missing / size-mismatched / checksum-mismatched / unexpected: ${report.storage.missing} / ${report.storage.sizeMismatched} / ${report.storage.checksumMismatched} / ${report.storage.unexpected}`,
    `- Source / Firebase bytes: ${report.storage.sourceBytes} / ${report.storage.targetBytes}`,
    `- Broken document/storage references: ${report.brokenReferences}`,
    `- Blocking / review findings: ${report.findingCounts.blocking} / ${report.findingCounts.review}`,
    "",
    "## Workflow status counts",
    "",
  ];
  for (const [collection, counts] of Object.entries(report.statusCounts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(
      `- **${escapeMarkdown(collection)}:** ${
        Object.entries(counts)
          .map(([status, count]) => `${escapeMarkdown(status)}=${count}`)
          .join(", ") || "none"
      }`,
    );
  }
  lines.push("", "## Permission catalog differences", "");
  lines.push(
    `- Added permission keys: ${report.catalogDifferences.addedPermissionKeys.map(escapeMarkdown).join(", ") || "none"}`,
  );
  lines.push(
    `- Removed permission keys: ${report.catalogDifferences.removedPermissionKeys.map(escapeMarkdown).join(", ") || "none"}`,
  );
  lines.push(
    `- Changed role grants: ${report.catalogDifferences.changedRolePermissions.map(escapeMarkdown).join(", ") || "none"}`,
  );
  lines.push("", "## Findings", "");
  if (report.findingCounts.blocking + report.findingCounts.review === 0) {
    lines.push("No findings.");
  } else {
    lines.push(
      `Showing up to ${SAMPLE_LIMIT} sampled findings; totals are ${report.findingCounts.blocking} blocking and ${report.findingCounts.review} review.`,
    );
    lines.push("| Severity | Entity | ID/path | Detail |", "| --- | --- | --- | --- |");
    for (const finding of report.findings) {
      lines.push(
        `| ${escapeMarkdown(finding.severity)} | ${escapeMarkdown(finding.entity)} | ${escapeMarkdown(finding.id ?? "—")} | ${escapeMarkdown(finding.detail)} |`,
      );
    }
  }
  lines.push("", "## Notes", "", ...report.notes.map((note) => `- ${escapeMarkdown(note)}`), "");
  return lines.join("\n");
}

async function saveReport(report: VerificationReport): Promise<{ jsonPath: string; markdownPath: string }> {
  const jsonPath = resolve(
    process.env.MIGRATION_VERIFY_REPORT_PATH?.trim() || `migration-reports/verification-${report.runId}.json`,
  );
  const markdownPath = jsonPath.replace(/\.json$/i, ".md");
  const finalMarkdownPath = markdownPath === jsonPath ? `${jsonPath}.md` : markdownPath;
  await mkdir(dirname(jsonPath), { recursive: true });
  const jsonTempPath = `${jsonPath}.tmp`;
  const markdownTempPath = `${finalMarkdownPath}.tmp`;
  await writeFile(jsonTempPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(jsonTempPath, jsonPath);
  await writeFile(markdownTempPath, renderMarkdownReport(report), { mode: 0o600 });
  await rename(markdownTempPath, finalMarkdownPath);
  return { jsonPath, markdownPath: finalMarkdownPath };
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Read-only Supabase → Firebase reconciliation. Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIREBASE_MIGRATION_PROJECT_ID, and matching Firebase Admin credentials. Use --skip-checksums only for a size/path-only pass.",
    );
    return;
  }
  const targetProjectId = requiredEnv("FIREBASE_MIGRATION_PROJECT_ID");
  const skipChecksums = process.argv.includes("--skip-checksums");
  const report: VerificationReport = {
    runId: new Date().toISOString().replace(/[:.]/g, "-"),
    generatedAt: new Date().toISOString(),
    sourceBucket: SOURCE_BUCKET,
    targetProjectId,
    checksumVerification: !skipChecksums,
    collections: {},
    auth: { sourceUsers: 0, targetUsers: 0, missing: 0, mismatched: 0, unexpected: 0, passwordResetRequired: 0 },
    storage: {
      sourceObjects: 0,
      targetObjects: 0,
      missing: 0,
      sizeMismatched: 0,
      checksumMismatched: 0,
      unexpected: 0,
      sourceBytes: 0,
      targetBytes: 0,
    },
    statusCounts: {},
    catalogDifferences: { addedPermissionKeys: [], removedPermissionKeys: [], changedRolePermissions: [] },
    brokenReferences: 0,
    findingCounts: { blocking: 0, review: 0 },
    findings: [],
    notes: [
      "This command is read-only: it never writes to Supabase, Firebase Auth, Firestore, or Cloud Storage.",
      "Reports compare a source projection with Firebase. Run against a frozen staging snapshot before cutover; records created after cutover appear as unexpected and require review.",
      "Password hashes are not available through Supabase's Auth Admin API; every imported password account requires a Firebase password reset. OAuth identities require manual re-linking.",
      "Permission catalogs and role templates are compared against current code. Legacy grants outside safe role templates are intentionally not expected in Firebase.",
    ],
  };

  const source = createSourceClient();
  const target = getFirebaseTarget(targetProjectId);
  const [
    profiles,
    sourceUsers,
    sourceGrants,
    projects,
    members,
    tasks,
    documents,
    comments,
    activityLogs,
    legacyPermissions,
    legacyRolePermissions,
    sourceFiles,
    targetAuthUsers,
  ] = await Promise.all([
    readTableRows(source, "profiles"),
    readAuthUsers(source),
    readTableRows(source, "user_permissions"),
    readTableRows(source, "projects"),
    readTableRows(source, "project_members"),
    readTableRows(source, "tasks"),
    readTableRows(source, "documents"),
    readTableRows(source, "comments"),
    readTableRows(source, "activity_logs"),
    readTableRows(source, "permissions", "key"),
    readTableRows(source, "role_permissions", ["role", "permission_key"]),
    listStorageObjects(source),
    readAllTargetAuthUsers(target),
  ]);

  const { expected, profilesById } = buildExpectedCollections({
    authUsers: sourceUsers,
    profiles,
    projects,
    members,
    grants: sourceGrants,
    tasks,
    documents,
    comments,
    activityLogs,
    legacyPermissions,
  });
  const catalogDelta = currentCatalogDelta(legacyPermissions, legacyRolePermissions);
  report.catalogDifferences = {
    addedPermissionKeys: catalogDelta.addedPermissionKeys,
    removedPermissionKeys: catalogDelta.removedPermissionKeys,
    changedRolePermissions: catalogDelta.changedRolePermissions,
  };
  if (
    catalogDelta.addedPermissionKeys.length ||
    catalogDelta.removedPermissionKeys.length ||
    catalogDelta.changedRolePermissions.length
  ) {
    addFinding(
      report,
      "review",
      "permission_catalog",
      undefined,
      "Firebase uses the current code catalog; legacy permission or role-template differences require explicit acceptance.",
    );
  }

  const collectionNames = new Set([...expected.keys(), "user_permissions", "permissions", "role_permissions"]);
  const targetDocs = new Map<string, Map<string, LegacyRow>>();
  for (const collection of collectionNames) targetDocs.set(collection, await readTargetCollection(target, collection));

  const sourceCounts: Record<string, number> = {
    profiles: sourceUsers.length,
    projects: projects.length,
    project_members: members.length,
    user_permissions: sourceGrants.length,
    tasks: tasks.length,
    documents: documents.length,
    comments: comments.length,
    activity_logs: activityLogs.length,
    permissions: legacyPermissions.length,
    role_permissions: legacyRolePermissions.length,
  };
  for (const collection of collectionNames) {
    compareCollection(
      report,
      collection,
      expected.get(collection) ?? [],
      targetDocs.get(collection) ?? new Map(),
      sourceCounts[collection] ?? 0,
    );
  }

  const targetUsersById = new Map(targetAuthUsers.map((user) => [user.uid, user]));
  const targetUsersByEmail = new Map(
    targetAuthUsers.filter((user) => user.email).map((user) => [user.email!.toLowerCase(), user]),
  );
  const sourceEmails = new Map<string, string>();
  report.auth.sourceUsers = sourceUsers.length;
  report.auth.targetUsers = targetAuthUsers.length;
  report.auth.passwordResetRequired = sourceUsers.length;
  for (const sourceUser of sourceUsers) {
    const actual = targetUsersById.get(sourceUser.id);
    if (!actual) {
      report.auth.missing += 1;
      addFinding(report, "blocking", "auth_users", sourceUser.id, "Source Auth UID is missing from Firebase.");
      continue;
    }
    if (!equalAuth(actual, sourceUser, profilesById.get(sourceUser.id) ?? null)) {
      report.auth.mismatched += 1;
      addFinding(
        report,
        "blocking",
        "auth_users",
        sourceUser.id,
        "Email, email-verification, or disabled state differs from the source projection.",
      );
    }
    const email = sourceUser.email?.trim().toLowerCase();
    if (email) {
      const prior = sourceEmails.get(email);
      if (prior && prior !== sourceUser.id)
        addFinding(report, "blocking", "auth_users", sourceUser.id, "Duplicate source email maps to multiple UIDs.");
      sourceEmails.set(email, sourceUser.id);
      const byEmail = targetUsersByEmail.get(email);
      if (byEmail && byEmail.uid !== sourceUser.id)
        addFinding(report, "blocking", "auth_users", sourceUser.id, "Firebase email belongs to a different UID.");
    }
  }
  const sourceUidSet = new Set(sourceUsers.map((user) => user.id));
  report.auth.unexpected = targetAuthUsers.filter((user) => !sourceUidSet.has(user.uid)).length;
  if (report.auth.unexpected > 0)
    addFinding(
      report,
      "review",
      "auth_users",
      undefined,
      `${report.auth.unexpected} Firebase Auth user(s) are not present in the source snapshot.`,
    );
  for (const profileId of profilesById.keys()) {
    if (!sourceUidSet.has(profileId))
      addFinding(report, "blocking", "profiles", profileId, "Source profile has no corresponding Supabase Auth user.");
  }

  for (const row of projects) bumpCount((report.statusCounts.projects ??= {}), row.status);
  for (const row of members) bumpCount((report.statusCounts.project_members ??= {}), row.status);
  for (const row of tasks) bumpCount((report.statusCounts.tasks ??= {}), row.status);
  for (const collection of ["projects", "project_members", "tasks"]) {
    const targetCounts: Record<string, number> = {};
    for (const row of targetDocs.get(collection)?.values() ?? []) bumpCount(targetCounts, row.status);
    report.statusCounts[`firebase.${collection}`] = targetCounts;
  }

  const fileReferences = checkBrokenReferences(report, targetDocs);
  const targetFileResults = await target.bucket.getFiles({ autoPaginate: true });
  const targetFiles = new Map(
    targetFileResults[0].map((file) => [
      file.name,
      { size: Number(file.metadata.size ?? 0), md5: file.metadata.md5Hash },
    ]),
  );
  report.storage.sourceObjects = sourceFiles.length;
  report.storage.targetObjects = targetFiles.size;
  report.storage.sourceBytes = sourceFiles.reduce((sum, file) => sum + Number(file.metadata.size ?? 0), 0);
  report.storage.targetBytes = [...targetFiles.values()].reduce((sum, file) => sum + file.size, 0);
  const sourcePaths = new Set(sourceFiles.map((file) => file.path));
  for (const sourceFile of sourceFiles) {
    const actual = targetFiles.get(sourceFile.path);
    if (!actual) {
      report.storage.missing += 1;
      addFinding(
        report,
        "blocking",
        "storage",
        sourceFile.path,
        "Source Storage object is missing from Firebase Storage.",
      );
      continue;
    }
    const sourceSize = Number(sourceFile.metadata.size ?? 0);
    if (sourceSize !== 0 && actual.size !== sourceSize) {
      report.storage.sizeMismatched += 1;
      addFinding(report, "blocking", "storage", sourceFile.path, "Source and Firebase object sizes differ.");
    }
  }
  report.storage.unexpected = [...targetFiles.keys()].filter((path) => !sourcePaths.has(path)).length;
  if (report.storage.unexpected > 0)
    addFinding(
      report,
      "review",
      "storage",
      undefined,
      `${report.storage.unexpected} Firebase object(s) are not present in the source bucket snapshot.`,
    );
  for (const path of fileReferences) {
    if (!targetFiles.has(path)) {
      report.brokenReferences += 1;
      addFinding(
        report,
        "blocking",
        "documents",
        path,
        "Firestore document references a missing Firebase Storage object.",
      );
    }
  }

  if (!skipChecksums) {
    const queue = [...sourceFiles];
    const worker = async () => {
      for (;;) {
        const sourceFile = queue.shift();
        if (!sourceFile) return;
        try {
          const sourceBytes = await downloadSourceObject(source, sourceFile.path);
          const [targetBytes] = await target.bucket.file(sourceFile.path).download();
          if (digest(sourceBytes) !== digest(Buffer.from(targetBytes))) {
            report.storage.checksumMismatched += 1;
            addFinding(report, "blocking", "storage", sourceFile.path, "Source and Firebase object checksums differ.");
          }
        } catch (error) {
          report.storage.checksumMismatched += 1;
          addFinding(
            report,
            "blocking",
            "storage",
            sourceFile.path,
            error instanceof Error ? error.message : "Could not checksum the target object.",
          );
        }
      }
    };
    await Promise.all(Array.from({ length: VERIFY_CONCURRENCY }, () => worker()));
  }

  report.generatedAt = new Date().toISOString();
  const reportPaths = await saveReport(report);
  const blocking = report.findingCounts.blocking;
  const reviews = report.findingCounts.review;
  console.log(
    JSON.stringify(
      {
        ...reportPaths,
        targetProjectId,
        checksumVerification: !skipChecksums,
        collections: report.collections,
        auth: report.auth,
        storage: report.storage,
        brokenReferences: report.brokenReferences,
        blockingFindings: blocking,
        reviewFindings: reviews,
        findingSamples: report.findings.slice(0, 25),
      },
      null,
      2,
    ),
  );
  if (blocking > 0 || reviews > 0) process.exitCode = 2;
}

function equalAuth(
  actual: { email?: string; emailVerified: boolean; disabled: boolean; displayName?: string },
  source: SourceAuthUser,
  profile: LegacyRow | null,
): boolean {
  const expected = mapAuthUser(source, profile);
  return (
    (actual.email ?? "").toLowerCase() === (expected.email ?? "").toLowerCase() &&
    actual.emailVerified === Boolean(expected.emailVerified) &&
    actual.disabled === Boolean(expected.disabled) &&
    (actual.displayName ?? "") === (expected.displayName ?? "")
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Verification failed with an unknown error.");
  process.exitCode = 1;
});
