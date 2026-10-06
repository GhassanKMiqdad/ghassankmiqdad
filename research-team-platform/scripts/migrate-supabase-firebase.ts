import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { UserImportRecord } from "firebase-admin/auth";

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
import { parseMigrationArguments } from "./migration/cli";
import {
  createSourceClient,
  downloadSourceObject,
  listStorageObjects,
  readAuthUsers,
  readTableRows,
  SOURCE_BUCKET,
  type SourceStorageObject,
} from "./migration/source";
import { getFirebaseTarget, normalizeFirestoreValue } from "./migration/target";

const FIRESTORE_BATCH_SIZE = 350;
const AUTH_LOOKUP_SIZE = 50;
const MAX_FILE_BYTES = Number(process.env.MIGRATION_MAX_OBJECT_BYTES ?? 50 * 1024 * 1024);
const TABLES = [
  "profiles",
  "projects",
  "project_members",
  "user_permissions",
  "tasks",
  "documents",
  "comments",
  "activity_logs",
] as const;
type Counter = { source: number; planned: number; created: number; skipped: number; conflicts: number; failed: number };
type Issue = { entity: string; id?: string; severity: "blocking" | "review" | "error"; message: string };
type Report = {
  runId: string;
  mode: "dry-run" | "apply";
  sourceBucket: string;
  targetProjectId: string;
  startedAt: string;
  finishedAt?: string;
  entities: Record<string, Counter>;
  issues: Issue[];
  permissionDowngrades: Array<{ membershipId: string; removed: string[] }>;
  notes: string[];
};

function makeCounter(): Counter {
  return { source: 0, planned: 0, created: 0, skipped: 0, conflicts: 0, failed: 0 };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function issue(report: Report, entity: string, id: string | undefined, severity: Issue["severity"], message: string) {
  report.issues.push({ entity, ...(id ? { id } : {}), severity, message });
}

function mapSourceItems<T>(
  report: Report,
  entity: string,
  values: readonly T[],
  getId: (value: T) => string,
  mapper: (value: T) => MappedDocument,
): MappedDocument[] {
  const documents: MappedDocument[] = [];
  for (const value of values) {
    const id = getId(value);
    try {
      documents.push(mapper(value));
    } catch (error) {
      issue(
        report,
        entity,
        id,
        "blocking",
        error instanceof Error
          ? `Source mapping validation failed: ${error.message}`
          : "Source mapping validation failed.",
      );
    }
  }
  return documents;
}

function equalEmail(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

async function saveReport(report: Report): Promise<void> {
  const reportPath = resolve(process.env.MIGRATION_REPORT_PATH?.trim() || `migration-reports/${report.runId}.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  const tempPath = `${reportPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, reportPath);
}

function logSummary(report: Report) {
  const summary = {
    runId: report.runId,
    mode: report.mode,
    sourceBucket: report.sourceBucket,
    targetProjectId: report.targetProjectId,
    entities: report.entities,
    blockingIssues: report.issues.filter((item) => item.severity === "blocking").length,
    reviewIssues: report.issues.filter((item) => item.severity === "review").length,
    errors: report.issues.filter((item) => item.severity === "error").length,
  };
  console.log(JSON.stringify(summary, null, 2));
}

function normalizeTarget(value: unknown): LegacyRow {
  const normalized = normalizeFirestoreValue(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? (normalized as LegacyRow) : {};
}

async function writeMappedDocuments(
  documents: MappedDocument[],
  report: Report,
  target: ReturnType<typeof getFirebaseTarget>,
): Promise<void> {
  for (const group of chunks(documents, FIRESTORE_BATCH_SIZE)) {
    const refs = group.map((document) => target.db.collection(document.collection).doc(document.id));
    const snapshots = await target.db.getAll(...refs);
    const toCreate: Array<{ ref: (typeof refs)[number]; document: MappedDocument }> = [];
    let groupConflict = false;
    for (let index = 0; index < group.length; index += 1) {
      const document = group[index]!;
      const snapshot = snapshots[index]!;
      const counter = report.entities[document.collection] ?? (report.entities[document.collection] = makeCounter());
      if (!snapshot.exists) {
        counter.planned += 1;
        if (report.mode === "apply") toCreate.push({ ref: refs[index]!, document });
        continue;
      }
      const existing = normalizeTarget(snapshot.data());
      if (isSafeSubsetEqual(document.data, existing)) {
        counter.skipped += 1;
      } else {
        groupConflict = true;
        counter.conflicts += 1;
        issue(
          report,
          document.collection,
          document.id,
          "blocking",
          "Target document exists with different values; left unchanged.",
        );
      }
    }
    if (report.mode === "apply" && groupConflict) {
      throw new Error("A Firestore conflict appeared after migration preflight; stopped before writing this batch.");
    }
    if (toCreate.length > 0) {
      const batch = target.db.batch();
      for (const item of toCreate) batch.create(item.ref, item.document.data);
      try {
        await batch.commit();
        for (const item of toCreate) report.entities[item.document.collection]!.created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Firestore batch error.";
        for (const item of toCreate) {
          report.entities[item.document.collection]!.failed += 1;
          issue(
            report,
            item.document.collection,
            item.document.id,
            "error",
            `Create-only Firestore batch failed: ${message}`,
          );
        }
        if (report.mode === "apply")
          throw new Error("A create-only Firestore batch failed; later migration stages were stopped.");
      }
    }
  }
}

async function preflightTargetDocuments(
  documents: MappedDocument[],
  report: Report,
  target: ReturnType<typeof getFirebaseTarget>,
): Promise<void> {
  const sourceKeys = new Set<string>();
  for (const document of documents) {
    const key = `${document.collection}/${document.id}`;
    if (sourceKeys.has(key)) {
      issue(
        report,
        document.collection,
        document.id,
        "blocking",
        "Duplicate source rows map to the same Firestore document ID.",
      );
    }
    sourceKeys.add(key);
  }
  for (const group of chunks(documents, FIRESTORE_BATCH_SIZE)) {
    const refs = group.map((document) => target.db.collection(document.collection).doc(document.id));
    const snapshots = await target.db.getAll(...refs);
    group.forEach((document, index) => {
      const snapshot = snapshots[index]!;
      if (snapshot.exists && !isSafeSubsetEqual(document.data, normalizeTarget(snapshot.data()))) {
        issue(
          report,
          document.collection,
          document.id,
          "blocking",
          "Target document exists with different values; no migration writes have started.",
        );
      }
    });
  }
}

async function preflightAuthUsers(
  users: SourceAuthUser[],
  profilesById: Map<string, LegacyRow>,
  report: Report,
  target: ReturnType<typeof getFirebaseTarget>,
): Promise<{ importRecords: UserImportRecord[]; readyUserIds: Set<string>; claimSyncUserIds: Set<string> }> {
  const importRecords: UserImportRecord[] = [];
  const readyUserIds = new Set<string>();
  const claimSyncUserIds = new Set<string>();
  const sourceEmails = new Map<string, string>();

  for (const group of chunks(users, AUTH_LOOKUP_SIZE)) {
    const identifiers = group.flatMap((user) => [{ uid: user.id }, ...(user.email ? [{ email: user.email }] : [])]);
    const existing = await target.auth.getUsers(identifiers);
    const byId = new Map(existing.users.map((user) => [user.uid, user]));
    const byEmail = new Map(
      existing.users.filter((user) => user.email).map((user) => [user.email!.toLowerCase(), user]),
    );

    for (const sourceUser of group) {
      const uid = sourceUser.id;
      const email = sourceUser.email?.trim().toLowerCase();
      if (!email) {
        report.entities.auth_users!.conflicts += 1;
        issue(
          report,
          "auth_users",
          uid,
          "blocking",
          "Source account has no email; the target app currently supports email/password sign-in only.",
        );
        continue;
      }
      if (email) {
        const priorSourceUid = sourceEmails.get(email);
        if (priorSourceUid && priorSourceUid !== uid) {
          report.entities.auth_users!.conflicts += 1;
          issue(
            report,
            "auth_users",
            uid,
            "blocking",
            "Duplicate source email maps to multiple user IDs; manual reconciliation required.",
          );
          continue;
        }
        sourceEmails.set(email, uid);
      }
      const existingById = byId.get(uid);
      const existingByEmail = email ? byEmail.get(email) : undefined;
      const desiredPlatformAdmin =
        mapProfile(profilesById.get(uid) ?? null, sourceUser).data.is_platform_admin === true;
      if (existingById) {
        if (!equalEmail(existingById.email, sourceUser.email)) {
          report.entities.auth_users!.conflicts += 1;
          issue(report, "auth_users", uid, "blocking", "Target UID exists with a different email; left unchanged.");
          continue;
        }
        if ((existingById.customClaims?.platform_admin === true) !== desiredPlatformAdmin) claimSyncUserIds.add(uid);
        readyUserIds.add(uid);
        report.entities.auth_users!.skipped += 1;
        continue;
      }
      if (existingByEmail && existingByEmail.uid !== uid) {
        report.entities.auth_users!.conflicts += 1;
        issue(
          report,
          "auth_users",
          uid,
          "blocking",
          "Target email is already bound to a different UID; no duplicate account created.",
        );
        continue;
      }
      const mapped = mapAuthUser(sourceUser, profilesById.get(uid)) as UserImportRecord;
      importRecords.push(mapped);
      if (desiredPlatformAdmin) claimSyncUserIds.add(uid);
      report.entities.auth_users!.planned += 1;
      readyUserIds.add(uid);
    }
  }
  report.entities.auth_users!.source = users.length;
  report.entities.platform_admin_claims!.source = users.filter(
    (user) => mapProfile(profilesById.get(user.id) ?? null, user).data.is_platform_admin === true,
  ).length;
  report.entities.platform_admin_claims!.planned = claimSyncUserIds.size;
  return { importRecords, readyUserIds, claimSyncUserIds };
}

async function syncImportedPlatformAdminClaims(
  userIds: Set<string>,
  profilesById: Map<string, LegacyRow>,
  sourceUsersById: Map<string, SourceAuthUser>,
  report: Report,
  target: ReturnType<typeof getFirebaseTarget>,
): Promise<void> {
  if (report.mode === "dry-run") {
    report.notes.push(
      `${report.entities.platform_admin_claims!.planned} Firebase Auth custom claim(s) would be synchronized from source profile flags. Updated users must sign in again for their ID token to contain the new claim.`,
    );
    return;
  }
  for (const userId of userIds) {
    try {
      const user = await target.auth.getUser(userId);
      const sourceUser = sourceUsersById.get(userId);
      if (!sourceUser) continue;
      const shouldBeAdmin = mapProfile(profilesById.get(userId) ?? null, sourceUser).data.is_platform_admin === true;
      const claims = { ...(user.customClaims ?? {}) };
      if (shouldBeAdmin) claims.platform_admin = true;
      else delete claims.platform_admin;
      await target.auth.setCustomUserClaims(userId, claims);
      report.entities.platform_admin_claims!.created += 1;
    } catch (error) {
      report.entities.platform_admin_claims!.failed += 1;
      issue(
        report,
        "platform_admin_claims",
        userId,
        "error",
        error instanceof Error
          ? `Custom-claim synchronization failed: ${error.message}`
          : "Custom-claim synchronization failed.",
      );
    }
  }
}

async function importAuthUsers(
  records: UserImportRecord[],
  report: Report,
  target: ReturnType<typeof getFirebaseTarget>,
): Promise<Set<string>> {
  const imported = new Set<string>();
  if (report.mode === "dry-run") {
    records.forEach((record) => imported.add(record.uid));
    return imported;
  }
  for (const group of chunks(records, 1000)) {
    const result = await target.auth.importUsers(group);
    const failedIndexes = new Set<number>();
    for (const entry of result.errors) {
      failedIndexes.add(entry.index);
      report.entities.auth_users!.failed += 1;
      issue(
        report,
        "auth_users",
        group[entry.index]?.uid,
        "error",
        `Firebase Auth import failed: ${entry.error.message}`,
      );
    }
    group.forEach((record, index) => {
      if (failedIndexes.has(index)) return;
      imported.add(record.uid);
      report.entities.auth_users!.created += 1;
    });
  }
  return imported;
}

async function seedTargetCatalogs(
  report: Report,
  target: ReturnType<typeof getFirebaseTarget>,
  sourcePermissions: LegacyRow[],
): Promise<void> {
  const catalogs = mapPermissionCatalogs(sourcePermissions);
  report.entities.catalogs!.source = catalogs.length;
  await writeMappedDocuments(catalogs, report, target);
}

async function preflightSourceRelationships(
  report: Report,
  data: {
    authUsers: SourceAuthUser[];
    profiles: LegacyRow[];
    projects: LegacyRow[];
    members: LegacyRow[];
    tasks: LegacyRow[];
    documents: LegacyRow[];
    comments: LegacyRow[];
    storage: SourceStorageObject[];
  },
): Promise<void> {
  const userIds = new Set(data.authUsers.map((user) => user.id));
  const projectIds = new Set(data.projects.map((row) => String(row.id)));
  const memberPairs = new Set(data.members.map((row) => `${row.project_id}|${row.user_id}`));
  const taskIds = new Set(data.tasks.map((row) => String(row.id)));
  const filePaths = new Set(data.storage.map((file) => file.path));

  for (const profile of data.profiles) {
    if (!userIds.has(String(profile.id)))
      issue(report, "profiles", String(profile.id), "blocking", "Profile has no corresponding Supabase Auth user.");
  }
  for (const project of data.projects) {
    if (project.created_by && !userIds.has(String(project.created_by))) {
      issue(
        report,
        "projects",
        String(project.id),
        "blocking",
        "Project creator does not exist in the source Auth user set.",
      );
    }
  }
  for (const member of data.members) {
    if (!projectIds.has(String(member.project_id)))
      issue(report, "project_members", String(member.id), "blocking", "Membership references a missing project.");
    if (!userIds.has(String(member.user_id)))
      issue(report, "project_members", String(member.id), "blocking", "Membership references a missing Auth user.");
  }
  for (const task of data.tasks) {
    if (!projectIds.has(String(task.project_id)))
      issue(report, "tasks", String(task.id), "blocking", "Task references a missing project.");
    if (task.assigned_to && !memberPairs.has(`${task.project_id}|${task.assigned_to}`)) {
      issue(report, "tasks", String(task.id), "blocking", "Task assignee is not a member of the same source project.");
    }
    if (task.created_by && !userIds.has(String(task.created_by)))
      issue(report, "tasks", String(task.id), "blocking", "Task creator is missing from the source Auth user set.");
  }
  for (const document of data.documents) {
    if (!projectIds.has(String(document.project_id)))
      issue(report, "documents", String(document.id), "blocking", "Document references a missing project.");
    if (!filePaths.has(String(document.storage_path)))
      issue(
        report,
        "documents",
        String(document.id),
        "blocking",
        "Document metadata references a missing source Storage object.",
      );
    if (document.uploaded_by && !userIds.has(String(document.uploaded_by)))
      issue(
        report,
        "documents",
        String(document.id),
        "blocking",
        "Document uploader is missing from the source Auth user set.",
      );
  }
  for (const comment of data.comments) {
    if (!projectIds.has(String(comment.project_id)))
      issue(report, "comments", String(comment.id), "blocking", "Comment references a missing project.");
    if (comment.task_id && !taskIds.has(String(comment.task_id)))
      issue(report, "comments", String(comment.id), "blocking", "Comment references a missing task.");
    if (comment.author_id && !userIds.has(String(comment.author_id)))
      issue(
        report,
        "comments",
        String(comment.id),
        "blocking",
        "Comment author is missing from the source Auth user set.",
      );
  }
}

function hashMd5(value: Buffer): string {
  return createHash("md5").update(value).digest("base64");
}

function objectMimeType(file: SourceStorageObject, documentMimeByPath: Map<string, string>): string {
  const stored = file.metadata.mimetype ?? file.metadata.contentType;
  return typeof stored === "string" ? stored : (documentMimeByPath.get(file.path) ?? "application/octet-stream");
}

async function preflightStorageObjects(
  client: ReturnType<typeof createSourceClient>,
  files: SourceStorageObject[],
  documentMimeByPath: Map<string, string>,
  report: Report,
  target: ReturnType<typeof getFirebaseTarget>,
): Promise<void> {
  const seenPaths = new Set<string>();
  const queue = [...files];
  const worker = async () => {
    for (;;) {
      const sourceFile = queue.shift();
      if (!sourceFile) return;
      const path = sourceFile.path;
      if (seenPaths.has(path)) {
        issue(report, "storage", path, "blocking", "Duplicate source Storage object path.");
        continue;
      }
      seenPaths.add(path);
      try {
        const sourceBytes = await downloadSourceObject(client, path);
        if (sourceBytes.byteLength > MAX_FILE_BYTES) {
          issue(report, "storage", path, "blocking", `Object exceeds MIGRATION_MAX_OBJECT_BYTES (${MAX_FILE_BYTES}).`);
          continue;
        }
        const listedSize = Number(sourceFile.metadata.size ?? 0);
        if (listedSize > 0 && listedSize !== sourceBytes.byteLength) {
          issue(report, "storage", path, "blocking", "Listed source object size differs from downloaded bytes.");
          continue;
        }
        const file = target.bucket.file(path);
        const [exists] = await file.exists();
        if (!exists) continue;
        const [targetBytes] = await file.download();
        const [metadata] = await file.getMetadata();
        if (
          createHash("sha256").update(sourceBytes).digest("hex") !==
          createHash("sha256").update(targetBytes).digest("hex")
        ) {
          issue(
            report,
            "storage",
            path,
            "blocking",
            "Target Storage object exists with different bytes; no migration writes have started.",
          );
          continue;
        }
        const expectedMimeType = objectMimeType(sourceFile, documentMimeByPath);
        if (metadata.contentType !== expectedMimeType) {
          issue(
            report,
            "storage",
            path,
            "blocking",
            "Target Storage object has matching bytes but different content type; no migration writes have started.",
          );
        }
      } catch (error) {
        issue(report, "storage", path, "error", error instanceof Error ? error.message : "Storage preflight failed.");
      }
    }
  };
  await Promise.all(Array.from({ length: 3 }, () => worker()));
}

async function copyStorage(
  client: ReturnType<typeof createSourceClient>,
  files: SourceStorageObject[],
  documentMimeByPath: Map<string, string>,
  report: Report,
  target: ReturnType<typeof getFirebaseTarget>,
): Promise<Set<string>> {
  const readyPaths = new Set<string>();
  const counter = (report.entities.storage ??= makeCounter());
  counter.source = files.length;
  const queue = [...files];
  const worker = async () => {
    for (;;) {
      const sourceFile = queue.shift();
      if (!sourceFile) return;
      const storagePath = sourceFile.path;
      try {
        const sourceBytes = await downloadSourceObject(client, storagePath);
        if (sourceBytes.byteLength > MAX_FILE_BYTES) {
          counter.failed += 1;
          issue(
            report,
            "storage",
            storagePath,
            "blocking",
            `Object exceeds MIGRATION_MAX_OBJECT_BYTES (${MAX_FILE_BYTES}); not transferred.`,
          );
          continue;
        }
        const file = target.bucket.file(storagePath);
        const [exists] = await file.exists();
        const md5 = hashMd5(sourceBytes);
        if (exists) {
          const [metadata] = await file.getMetadata();
          const sameBytes = Number(metadata.size) === sourceBytes.byteLength && metadata.md5Hash === md5;
          if (sameBytes) {
            counter.skipped += 1;
            readyPaths.add(storagePath);
          } else {
            counter.conflicts += 1;
            issue(
              report,
              "storage",
              storagePath,
              "blocking",
              "Target object exists with different content; it was not overwritten.",
            );
          }
          continue;
        }
        counter.planned += 1;
        if (report.mode === "dry-run") {
          readyPaths.add(storagePath);
          continue;
        }
        const mimeType = objectMimeType(sourceFile, documentMimeByPath);
        const custom = sourceFile.metadata.metadata;
        const customMetadata =
          custom && typeof custom === "object"
            ? Object.fromEntries(
                Object.entries(custom).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
              )
            : undefined;
        await file.save(sourceBytes, {
          resumable: false,
          validation: "crc32c",
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: mimeType,
            ...(customMetadata ? { metadata: customMetadata } : {}),
          },
        });
        const [savedMetadata] = await file.getMetadata();
        if (Number(savedMetadata.size) !== sourceBytes.byteLength || savedMetadata.md5Hash !== md5) {
          counter.failed += 1;
          issue(report, "storage", storagePath, "blocking", "Post-upload size/checksum verification failed.");
          continue;
        }
        counter.created += 1;
        readyPaths.add(storagePath);
      } catch (error) {
        counter.failed += 1;
        issue(
          report,
          "storage",
          storagePath,
          "error",
          error instanceof Error ? error.message : "Unknown Storage transfer error.",
        );
      }
    }
  };
  await Promise.all(Array.from({ length: 3 }, () => worker()));
  return readyPaths;
}

let activeReport: Report | null = null;

async function main() {
  const args = parseMigrationArguments(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Safe Supabase → Firebase migration. Default mode is --dry-run. Apply requires --apply, --confirm-apply=<target>, a frozen source, and a project-specific production confirmation when applicable.",
    );
    return;
  }
  const apply = args.mode === "apply";
  const targetProjectId = requiredEnv("FIREBASE_MIGRATION_PROJECT_ID");
  const productionProjectId = process.env.FIREBASE_PRODUCTION_PROJECT_ID?.trim();
  if (apply) {
    if (process.env.MIGRATION_SOURCE_FROZEN !== "1")
      throw new Error(
        "Apply requires MIGRATION_SOURCE_FROZEN=1 after writes to the source application have been frozen.",
      );
    if (!productionProjectId)
      throw new Error("Apply requires FIREBASE_PRODUCTION_PROJECT_ID so staging and production can be distinguished.");
    if (!process.argv.includes(`--confirm-apply=${targetProjectId}`)) {
      throw new Error(`Apply requires the exact target confirmation flag --confirm-apply=${targetProjectId}.`);
    }
    if (
      targetProjectId === productionProjectId &&
      !process.argv.includes(`--confirm-production=${productionProjectId}`)
    ) {
      throw new Error(`Production apply also requires --confirm-production=${productionProjectId}.`);
    }
  }

  const report: Report = {
    runId: new Date().toISOString().replace(/[:.]/g, "-"),
    mode: apply ? "apply" : "dry-run",
    sourceBucket: SOURCE_BUCKET,
    targetProjectId,
    startedAt: new Date().toISOString(),
    entities: Object.fromEntries(
      [...TABLES, "auth_users", "platform_admin_claims", "storage", "catalogs", "permissions", "role_permissions"].map(
        (entity) => [entity, makeCounter()],
      ),
    ),
    issues: [],
    permissionDowngrades: [],
    notes: [
      "The source Supabase client is used only for list/read/download operations. No source writes or deletes are implemented.",
      "Firebase Auth accounts are imported without password hashes. Users must complete the Firebase password-reset flow; OAuth/provider identities require manual re-linking.",
      "The trusted platform_admin custom claim is synchronized from source profiles; affected users must sign in again before direct Firestore/Storage Rules recognize the new platform role.",
      "Firestore target records are create-only. Existing equal records are skipped; different records are reported and never overwritten.",
      "Run this repeatedly to resume: already imported identical records/files are skipped after checksum comparison.",
      "Legacy permissions outside the target role template are removed; researchers receive only assigned-work progress/note/submit rights plus source grants still permitted by their role.",
      "The source schema has no versioned submission/review tables; current task state is copied, but submission history cannot be reconstructed.",
    ],
  };
  activeReport = report;
  const save = () => saveReport(report);

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
    storageFiles,
    sourcePermissions,
    sourceRolePermissions,
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
    listStorageObjects(source),
    readTableRows(source, "permissions", "key"),
    readTableRows(source, "role_permissions", ["role", "permission_key"]),
  ]);

  const profilesById = new Map(profiles.map((row) => [String(row.id), row]));
  const providerAccounts = sourceUsers.filter((user) =>
    (user.identities ?? []).some((identity) => identity.provider && identity.provider !== "email"),
  ).length;
  if (providerAccounts > 0) {
    report.notes.push(
      `${providerAccounts} account(s) include non-email identity providers. Their email accounts can be reset, but external provider identities require manual Firebase re-linking.`,
    );
    issue(
      report,
      "auth_users",
      undefined,
      "review",
      `${providerAccounts} non-email provider identity/identities are not imported as OAuth credentials.`,
    );
  }
  const grantsByMember = new Map<string, string[]>();
  for (const grant of sourceGrants) {
    const key = `${grant.project_id}|${grant.user_id}`;
    const current = grantsByMember.get(key) ?? [];
    current.push(String(grant.permission_key ?? ""));
    grantsByMember.set(key, current);
  }
  const mimeByPath = new Map(
    documents.map((row) => [String(row.storage_path), String(row.mime_type ?? "application/octet-stream")]),
  );
  await preflightSourceRelationships(report, {
    authUsers: sourceUsers,
    profiles,
    projects,
    members,
    tasks,
    documents,
    comments,
    storage: storageFiles,
  });
  const sourceUserIds = new Set(sourceUsers.map((user) => user.id));
  const orphanProfiles = profiles.filter((profile) => !sourceUserIds.has(String(profile.id)));
  for (const row of orphanProfiles)
    issue(report, "profiles", String(row.id), "blocking", "Profile has no source Auth account and cannot be imported.");

  const profileDocuments = mapSourceItems(
    report,
    "profiles",
    sourceUsers,
    (user) => user.id,
    (user) => mapProfile(profilesById.get(user.id) ?? null, user),
  );
  const projectDocuments = mapSourceItems(report, "projects", projects, (row) => String(row.id), mapProject);
  const taskDocuments = mapSourceItems(report, "tasks", tasks, (row) => String(row.id), mapTask);
  const documentDocuments = mapSourceItems(report, "documents", documents, (row) => String(row.id), mapDocument);
  const commentDocuments = mapSourceItems(report, "comments", comments, (row) => String(row.id), mapComment);
  const activityDocuments = mapSourceItems(
    report,
    "activity_logs",
    activityLogs,
    (row) => String(row.id),
    mapActivityLog,
  );
  const catalogDocuments = mapPermissionCatalogs(sourcePermissions);
  const membershipDocuments: MappedDocument[] = [];
  const membershipGrantDocuments: MappedDocument[] = [];
  for (const row of members) {
    const id = `${row.project_id}_${row.user_id}`;
    try {
      const mapped = mapMembership(row, grantsByMember.get(`${row.project_id}|${row.user_id}`) ?? []);
      membershipDocuments.push(mapped.membership);
      membershipGrantDocuments.push(...mapped.grants);
      if (mapped.removedPermissions.length > 0) {
        report.permissionDowngrades.push({ membershipId: id, removed: mapped.removedPermissions });
        issue(
          report,
          "project_members",
          id,
          "review",
          `Legacy permissions removed for least-privilege mapping: ${mapped.removedPermissions.join(", ")}.`,
        );
      }
    } catch (error) {
      issue(
        report,
        "project_members",
        id,
        "blocking",
        error instanceof Error
          ? `Source mapping validation failed: ${error.message}`
          : "Source mapping validation failed.",
      );
    }
  }

  const storageByPath = new Map(storageFiles.map((file) => [file.path, file]));
  for (const row of documents) {
    const path = String(row.storage_path);
    const listedSize = Number(storageByPath.get(path)?.metadata.size ?? 0);
    if (Number(row.size_bytes ?? 0) !== 0 && listedSize !== 0 && Number(row.size_bytes) !== listedSize) {
      issue(
        report,
        "documents",
        String(row.id),
        "blocking",
        "Document metadata size differs from its source Storage object.",
      );
    }
  }
  const allMappedDocuments = [
    ...catalogDocuments,
    ...profileDocuments,
    ...projectDocuments,
    ...membershipDocuments,
    ...membershipGrantDocuments,
    ...taskDocuments,
    ...documentDocuments,
    ...commentDocuments,
    ...activityDocuments,
  ];

  report.entities.profiles!.source = sourceUsers.length;
  report.entities.auth_users!.source = sourceUsers.length;
  report.entities.projects!.source = projects.length;
  report.entities.project_members!.source = members.length;
  report.entities.user_permissions!.source = sourceGrants.length;
  report.entities.tasks!.source = tasks.length;
  report.entities.documents!.source = documents.length;
  report.entities.comments!.source = comments.length;
  report.entities.activity_logs!.source = activityLogs.length;
  report.entities.storage!.source = storageFiles.length;
  report.entities.permissions!.source = sourcePermissions.length;
  report.entities.role_permissions!.source = sourceRolePermissions.length;
  await save();

  if (apply && report.issues.some((item) => item.severity === "blocking")) {
    report.finishedAt = new Date().toISOString();
    await save();
    logSummary(report);
    throw new Error("Source relationship preflight found blocking issues; no target writes were started.");
  }

  const authPreflight = await preflightAuthUsers(sourceUsers, profilesById, report, target);
  if (apply && report.issues.some((item) => item.entity === "auth_users" && item.severity === "blocking")) {
    report.finishedAt = new Date().toISOString();
    await save();
    logSummary(report);
    throw new Error("Target Auth preflight found UID/email conflicts; no target writes were started.");
  }
  await preflightTargetDocuments(allMappedDocuments, report, target);
  await preflightStorageObjects(source, storageFiles, mimeByPath, report, target);
  if (apply && report.issues.some((item) => item.severity === "blocking" || item.severity === "error")) {
    report.finishedAt = new Date().toISOString();
    await save();
    logSummary(report);
    throw new Error(
      "Read-only Auth, Firestore, or Storage preflight found blocking issues; no target writes were started.",
    );
  }

  const readyUserIds = await importAuthUsers(authPreflight.importRecords, report, target);
  if (apply && report.entities.auth_users!.failed > 0) {
    report.finishedAt = new Date().toISOString();
    await save();
    logSummary(report);
    throw new Error(
      "Firebase Auth import reported failures; re-run after resolving them before migrating Firestore records.",
    );
  }
  for (const user of sourceUsers) if (authPreflight.readyUserIds.has(user.id)) readyUserIds.add(user.id);
  await syncImportedPlatformAdminClaims(
    new Set([...authPreflight.claimSyncUserIds].filter((uid) => readyUserIds.has(uid))),
    profilesById,
    new Map(sourceUsers.map((user) => [user.id, user])),
    report,
    target,
  );
  if (apply && report.entities.platform_admin_claims!.failed > 0) {
    report.finishedAt = new Date().toISOString();
    await save();
    logSummary(report);
    throw new Error(
      "Firebase Auth custom-claim synchronization failed; no Firestore or Storage migration writes were started.",
    );
  }
  await save();

  await seedTargetCatalogs(report, target, sourcePermissions);
  await save();
  await writeMappedDocuments(
    profileDocuments.filter((document) => readyUserIds.has(document.id)),
    report,
    target,
  );
  await save();
  await writeMappedDocuments(projectDocuments, report, target);
  await save();

  const readyMembershipDocuments = membershipDocuments.filter((document) =>
    readyUserIds.has(String(document.data.user_id)),
  );
  const readyMembershipGrantDocuments = membershipGrantDocuments.filter((document) =>
    readyUserIds.has(String(document.data.user_id)),
  );
  await writeMappedDocuments(readyMembershipDocuments, report, target);
  await writeMappedDocuments(readyMembershipGrantDocuments, report, target);
  await save();

  await writeMappedDocuments(taskDocuments, report, target);
  await save();

  const fileReadyPaths = await copyStorage(source, storageFiles, mimeByPath, report, target);
  await save();
  const verifiedDocumentDocuments = documentDocuments.filter((document) => {
    const path = String(document.data.storage_path);
    if (fileReadyPaths.has(path)) return true;
    issue(
      report,
      "documents",
      document.id,
      "blocking",
      "Document metadata was not written because its binary object was not verified in the target.",
    );
    return false;
  });
  await writeMappedDocuments(verifiedDocumentDocuments, report, target);
  await save();
  await writeMappedDocuments(commentDocuments, report, target);
  await save();
  await writeMappedDocuments(activityDocuments, report, target);
  await save();

  const currentRoleTemplates = new Set(
    catalogDocuments
      .filter((item) => item.collection === "role_permissions")
      .map((item) => `${item.data.role}|${item.data.permission_key}`),
  );
  const legacyRoleTemplates = new Set(sourceRolePermissions.map((row) => `${row.role}|${row.permission_key}`));
  const changedRoles = [...new Set([...legacyRoleTemplates, ...currentRoleTemplates])].filter(
    (key) => legacyRoleTemplates.has(key) !== currentRoleTemplates.has(key),
  );
  report.notes.push(
    `Source reference catalogs permissions/role_permissions were not copied; Firebase catalogs were seeded from the current source-controlled permission definitions (${catalogDocuments.filter((item) => item.collection === "permissions").length} keys and ${new Set(catalogDocuments.filter((item) => item.collection === "role_permissions").map((item) => item.data.role)).size} roles).`,
  );
  report.notes.push(
    `Legacy role-template differences require review: ${changedRoles.length} role/permission combinations differ from the Firebase code catalog.`,
  );
  report.notes.push(
    "No legacy notifications, versioned submissions, or versioned review records exist in the retained SQL schema; these collections are not synthesized.",
  );
  report.finishedAt = new Date().toISOString();
  await save();
  logSummary(report);
  if (report.issues.some((item) => item.severity === "blocking" || item.severity === "error")) {
    process.exitCode = 2;
  }
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : "Migration failed with an unknown error.";
  if (activeReport && !activeReport.finishedAt) {
    issue(activeReport, "migration", undefined, "error", message);
    activeReport.finishedAt = new Date().toISOString();
    try {
      await saveReport(activeReport);
      logSummary(activeReport);
    } catch {
      console.error("Could not persist the final migration report.");
    }
  }
  console.error(message);
  process.exitCode = 1;
});
