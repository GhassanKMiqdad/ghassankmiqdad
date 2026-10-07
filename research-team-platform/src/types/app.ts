import type {
  DurationUnit,
  MemberStatus,
  PermissionKey,
  ProjectRole,
  ProjectStatus,
  ReviewDecision,
  ScheduleStatus,
  SubmissionStatus,
  TaskPriority,
  TaskStatus,
  TaskVisibility,
  TeamMemberStatus,
  TeamRole,
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
  status: ProjectStatus;
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
  teamId: string | null;
  code: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  planningMonth: number;
  planningWeek: number | null;
  plannedStartAt: string | null;
  plannedDuration: number | null;
  durationUnit: DurationUnit | null;
  dueAt: string | null;
  dueAtOverridden: boolean;
  actualStartAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  progress: number;
  visibility: TaskVisibility;
  /** Computed by the database with its clock (public.schedule_status). */
  scheduleStatus: ScheduleStatus;
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  assignee: UserRef | null;
  assignedToId: string | null;
  /** Job title of the responsible member in the task's team (when visible). */
  assigneeTitle: string | null;
  /** Responsible roster entry (may exist before the person has an account). */
  responsibleMemberId: string | null;
  /** Assignee name, or the roster name while the person has no account yet. */
  responsibleName: string | null;
  /** True while the responsible roster member has no linked account. */
  responsiblePending: boolean;
  isOverdue: boolean;
};

export type TaskDetails = TaskListItem & {
  description: string;
  originalInstructions: string;
  expectedOutput: string;
  completionCriteria: string;
  workNotes: string;
  createdBy: UserRef | null;
  teamName: string | null;
};

export type ReviewItem = {
  id: string;
  submissionId: string;
  decision: ReviewDecision;
  comment: string;
  requiredChanges: string;
  additionalInstructions: string;
  previousDueAt: string | null;
  newDueAt: string | null;
  reviewer: UserRef | null;
  createdAt: string;
};

export type SubmissionItem = {
  id: string;
  version: number;
  summary: string;
  links: string[];
  notes: string;
  status: SubmissionStatus;
  isFinal: boolean;
  submittedBy: UserRef | null;
  submittedAt: string;
  reviews: ReviewItem[];
};

export type DependencyItem = {
  taskId: string;
  code: string;
  title: string;
  status: TaskStatus;
  done: boolean;
};

export type TaskOption = { id: string; code: string; title: string };

export type PublicationItem = {
  taskId: string;
  projectId: string;
  projectName: string | null;
  teamId: string | null;
  teamName: string | null;
  code: string;
  title: string;
  responsibleName: string | null;
  responsibleTitle: string | null;
  finalResult: string;
  links: string[];
  teamComment: string;
  version: number;
  completedAt: string;
};

export type NotificationItem = {
  id: string;
  type: string;
  projectId: string | null;
  taskId: string | null;
  data: Record<string, unknown>;
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
};

export type TeamSummary = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  projects: { id: string; name: string }[];
};

export type TeamRosterMember = {
  id: string;
  teamId: string;
  userId: string | null;
  displayName: string;
  memberCode: string;
  jobTitle: string;
  role: TeamRole;
  status: TeamMemberStatus;
  /** Directors only. */
  inviteEmail: string | null;
  accountEmail: string | null;
};

export type ExecutionReportRow = {
  userId: string;
  name: string;
  total: number;
  completed: number;
  completedOnTime: number;
  overdue: number;
  inReview: number;
  revisions: number;
  submissions: number;
  avgStartDelayHours: number | null;
  avgCompletionDelayHours: number | null;
};

export type MemberOption = {
  id: string;
  name: string;
  role: ProjectRole;
  /** Member code and job title in the project's team, when the project has one. */
  code?: string | null;
  jobTitle?: string | null;
  /** A roster entry without an account yet (id is the roster entry id). */
  pending?: boolean;
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
  dueSoonTasks: number;
  awaitingReview: number;
  awaitingCompletion: number;
  canViewTeam: boolean;
  teamMembers: number;
  tasksByStatus: Record<TaskStatus, number>;
  tasksByPriority: Record<TaskPriority, number>;
  tasksByMember: { userId: string; name: string; total: number; open: number; completed: number; overdue: number }[];
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
