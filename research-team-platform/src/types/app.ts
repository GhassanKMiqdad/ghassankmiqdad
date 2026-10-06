import type {
  MemberStatus,
  PermissionKey,
  ProjectRole,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from "@/lib/permissions/catalog";

/**
 * Data Transfer Objects returned by the server data-access layer. They are
 * plain, serializable and contain only what the UI needs.
 */

export type UserRef = {
  id: string;
  name: string;
  email: string | null;
};

export type ProjectListItem = {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  priority: TaskPriority;
  startDate: string | null;
  deadline: string | null;
  updatedAt: string;
  role: ProjectRole;
  memberCount: number | null;
  taskTotal: number;
  taskCompleted: number;
};

export type ProjectDetails = {
  id: string;
  name: string;
  description: string;
  researchGoal: string;
  researchType: string;
  researchObjectives: string;
  researchQuestions: string;
  methodology: string;
  status: ProjectStatus;
  priority: TaskPriority;
  startDate: string | null;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: UserRef | null;
};

export type TaskListItem = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  assignee: UserRef | null;
  assignedToId: string | null;
  teamId: string | null;
  isOverdue: boolean;
};

export type TaskDetails = TaskListItem & {
  description: string;
  expectedOutput: string;
  requiredDeliverables: string;
  completedAt: string | null;
  createdBy: UserRef | null;
  progress: number;
  workNotes: string;
  submissionVersion: number;
  latestSubmissionId: string | null;
};

export type MemberOption = {
  id: string;
  name: string;
  role: ProjectRole;
};

export type DocumentItem = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
};

export type CommentItem = {
  id: string;
  projectId: string;
  taskId: string | null;
  content: string;
  author: UserRef | null;
  authorId: string | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
};

export type TeamMember = {
  userId: string;
  fullName: string;
  email: string | null;
  displayName: string;
  role: ProjectRole;
  status: MemberStatus;
  joinedAt: string;
  lastSignInAt: string | null;
  permissions: PermissionKey[];
  assignedOpenTasks: number;
  assignedTotalTasks: number;
  lastActivityAt: string | null;
};

export type ActivityItem = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type DashboardStats = {
  totalProjects: number;
  activeProjects: number;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  overdueTasks: number;
  canViewTeam: boolean;
  teamMembers: number;
  tasksByStatus: Record<TaskStatus, number>;
  tasksByMember: { userId: string; name: string; total: number; open: number; completed: number }[];
  projectProgress: { projectId: string; name: string; status: ProjectStatus; total: number; completed: number }[];
};

export type PlatformUser = {
  id: string;
  email: string | null;
  fullName: string;
  isPlatformAdmin: boolean;
  canCreateProjects: boolean;
  createdAt: string;
  lastSignInAt: string | null;
};

export type NotificationType =
  | "task_assigned"
  | "task_submitted"
  | "revision_requested"
  | "submission_approved"
  | "submission_rejected"
  | "team_assigned"
  | "milestone_assigned"
  | "task_due_soon"
  | "task_overdue";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  taskId: string;
  taskTitle: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};
