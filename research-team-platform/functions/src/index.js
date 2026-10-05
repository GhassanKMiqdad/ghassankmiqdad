import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";

import {
  DEADLINE_ACTIVE_STATUSES,
  addCalendarDays,
  dateKeyInTimeZone,
  deadlineNotificationId,
} from "./deadline-helpers.js";

initializeApp();

const TIME_ZONE = process.env.APP_TIMEZONE || "UTC";
const PAGE_SIZE = 200;
const LEGACY_ACTIVE_STATUSES = ["todo", "review"];

function isAlreadyExists(error) {
  return error?.code === 6 || error?.code === "already-exists" || error?.code === "ALREADY_EXISTS";
}

async function createMissingNotifications(query, kind) {
  const db = getFirestore();
  const writer = db.bulkWriter();
  writer.onWriteError((error) => !isAlreadyExists(error) && error.failedAttempts < 4);

  let cursor;
  let scanned = 0;
  let created = 0;
  try {
    while (true) {
      let pageQuery = query.limit(PAGE_SIZE);
      if (cursor) pageQuery = pageQuery.startAfter(cursor);
      const page = await pageQuery.get();
      if (page.empty) break;

      scanned += page.size;
      const candidates = [];
      const memberRefs = new Map();
      for (const task of page.docs) {
        const data = task.data();
        const userId = typeof data.assigned_to === "string" ? data.assigned_to : "";
        const projectId = typeof data.project_id === "string" ? data.project_id : "";
        const dueDate = typeof data.due_date === "string" ? data.due_date : "";
        if (!userId || !projectId || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) continue;

        const teamId = typeof data.team_id === "string" ? data.team_id : "";
        const projectMember = db.collection("project_members").doc(`${projectId}_${userId}`);
        memberRefs.set(projectMember.path, projectMember);
        let teamMember;
        let team;
        if (teamId) {
          teamMember = db.collection("team_members").doc(`${teamId}_${userId}`);
          team = db.collection("teams").doc(teamId);
          memberRefs.set(teamMember.path, teamMember);
          memberRefs.set(team.path, team);
        }
        candidates.push({ task, data, userId, projectId, dueDate, teamId, projectMember, teamMember, team });
      }

      const memberSnapshots = memberRefs.size ? await db.getAll(...memberRefs.values()) : [];
      const byPath = new Map(memberSnapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
      const writes = [];
      for (const candidate of candidates) {
        const projectMembership = byPath.get(candidate.projectMember.path);
        if (
          !projectMembership?.exists ||
          projectMembership.get("status") !== "active" ||
          projectMembership.get("project_id") !== candidate.projectId ||
          projectMembership.get("user_id") !== candidate.userId
        ) {
          continue;
        }
        if (candidate.teamId) {
          const teamMembership = byPath.get(candidate.teamMember.path);
          const team = byPath.get(candidate.team.path);
          if (
            !teamMembership?.exists ||
            teamMembership.get("status") !== "active" ||
            teamMembership.get("projectId") !== candidate.projectId ||
            teamMembership.get("teamId") !== candidate.teamId ||
            teamMembership.get("userId") !== candidate.userId ||
            !team?.exists ||
            team.get("projectId") !== candidate.projectId ||
            team.get("status") !== "active"
          ) {
            continue;
          }
        }

        const id = deadlineNotificationId(kind, candidate.task.id, candidate.userId, candidate.dueDate);
        const notification = {
          id,
          user_id: candidate.userId,
          project_id: candidate.projectId,
          task_id: candidate.task.id,
          task_title: typeof candidate.data.title === "string" ? candidate.data.title : "",
          type: kind,
          href: `/projects/${candidate.projectId}/tasks/${candidate.task.id}`,
          due_date: candidate.dueDate,
          created_at: new Date().toISOString(),
          read_at: null,
        };
        writes.push(
          writer
            .create(db.collection("notifications").doc(id), notification)
            .then(() => {
              created += 1;
            })
            .catch((error) => {
              if (!isAlreadyExists(error)) throw error;
            }),
        );
      }
      await Promise.all(writes);
      cursor = page.docs.at(-1);
      if (page.size < PAGE_SIZE) break;
    }
  } finally {
    await writer.close();
  }

  return { scanned, created };
}

async function processDeadlineKind(tasks, dueDateOperator, date, kind) {
  const results = [];
  const statuses = [...new Set([...DEADLINE_ACTIVE_STATUSES, ...LEGACY_ACTIVE_STATUSES])];
  for (const status of statuses) {
    const query = tasks
      .where("status", "==", status)
      .where("due_date", dueDateOperator, date)
      .orderBy("due_date", "asc");
    results.push(await createMissingNotifications(query, kind));
  }
  return results.reduce(
    (total, result) => ({ scanned: total.scanned + result.scanned, created: total.created + result.created }),
    { scanned: 0, created: 0 },
  );
}

export const scheduledDeadlineNotifications = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: TIME_ZONE,
    region: "us-central1",
    retryCount: 3,
    maxInstances: 1,
    timeoutSeconds: 540,
  },
  async () => {
    const db = getFirestore();
    const today = dateKeyInTimeZone(new Date(), TIME_ZONE);
    const tomorrow = addCalendarDays(today, 1);
    const tasks = db.collection("tasks");

    const upcoming = await processDeadlineKind(tasks, "==", tomorrow, "deadline_approaching");
    const overdue = await processDeadlineKind(tasks, "<", today, "task_overdue");
    logger.info("Deadline notifications processed", { today, tomorrow, upcoming, overdue });
  },
);
