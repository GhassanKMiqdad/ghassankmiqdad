import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

import { classifyTaskReminders, reminderNotificationId, utcDateParts, type ReminderKind } from "./reminder-logic.js";

initializeApp();

const PAGE_SIZE = 500;
const MAX_TASKS_PER_RUN = 10_000;
const ACTIVE_STATUSES = ["todo", "accepted", "in_progress", "revision_required"];

async function createReminder(
  task: FirebaseFirestore.QueryDocumentSnapshot,
  kind: ReminderKind,
  runDate: string,
): Promise<boolean> {
  const userId = task.get("assigned_to");
  const projectId = task.get("project_id");
  if (typeof userId !== "string" || typeof projectId !== "string") return false;
  const id = reminderNotificationId(kind, task.id, userId, runDate);
  try {
    await getFirestore()
      .collection("notifications")
      .doc(id)
      .create({
        id,
        user_id: userId,
        project_id: projectId,
        type: kind,
        task_id: task.id,
        task_title: typeof task.get("title") === "string" ? task.get("title") : "",
        href: `/projects/${projectId}/tasks/${task.id}`,
        read_at: null,
        created_at: FieldValue.serverTimestamp(),
        scheduled_for: runDate,
      });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === 6) return false;
    throw error;
  }
}

async function scanTasks(
  query: FirebaseFirestore.Query,
  kindForTask: (task: FirebaseFirestore.QueryDocumentSnapshot) => ReminderKind[],
  runDate: string,
): Promise<{ scanned: number; notified: number }> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let scanned = 0;
  let notified = 0;
  while (scanned < MAX_TASKS_PER_RUN) {
    let pageQuery = query.orderBy("due_date", "asc").limit(PAGE_SIZE);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await pageQuery.get();
    if (page.empty) break;
    scanned += page.size;
    for (const task of page.docs) {
      const kinds = kindForTask(task);
      for (const kind of kinds) {
        if (await createReminder(task, kind, runDate)) notified += 1;
      }
    }
    cursor = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }
  if (scanned >= MAX_TASKS_PER_RUN) {
    throw new Error(
      `Reminder safety cap reached (${MAX_TASKS_PER_RUN}); inspect scheduled execution and shard the query before increasing the cap.`,
    );
  }
  return { scanned, notified };
}

export const sendResearchDeadlineReminders = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Etc/UTC", region: "us-central1", retryCount: 3 },
  async () => {
    const db = getFirestore();
    const now = new Date();
    const { today, tomorrow } = utcDateParts(now);
    const upcomingQuery = db
      .collection("tasks")
      .where("status", "in", ACTIVE_STATUSES)
      .where("due_date", "==", tomorrow);
    const overdueQuery = db.collection("tasks").where("status", "in", ACTIVE_STATUSES).where("due_date", "<", today);
    const upcoming = await scanTasks(
      upcomingQuery,
      (task) => classifyTaskReminders({ ...task.data(), id: task.id }, today, tomorrow),
      today,
    );
    const overdue = await scanTasks(
      overdueQuery,
      (task) => classifyTaskReminders({ ...task.data(), id: task.id }, today, tomorrow),
      today,
    );
    logger.info("Research deadline reminder run complete", { today, upcoming, overdue });
  },
);
