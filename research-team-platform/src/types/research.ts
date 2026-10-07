export type ResearchTeam = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: "active" | "archived";
  leadId: string | null;
  memberCount: number;
  openTaskCount: number;
  createdAt: string;
};

export type ResearchTeamMember = {
  userId: string;
  fullName: string;
  email: string | null;
  role: "lead" | "member";
  status: "active" | "inactive";
};

export type ResearchMilestone = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  deadline: string | null;
  responsibleTeamId: string | null;
  responsibleResearcherId: string | null;
  status: "pending" | "in_progress" | "at_risk" | "completed";
  createdBy: string;
  updatedAt: string;
};

export type TaskSubmission = {
  id: string;
  taskId: string;
  version: number;
  submittedBy: string;
  notes: string;
  documentIds: string[];
  documents: { id: string; title: string; fileName: string }[];
  createdAt: string;
};

export type TaskReview = {
  id: string;
  taskId: string;
  submissionId: string;
  reviewerId: string;
  decision: "approved" | "revision_required" | "rejected";
  feedback: string;
  createdAt: string;
};

export type ResearcherRecord = {
  id: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  specialization: string;
  skills: string[];
  academicBackground: string;
  status: "active" | "inactive" | "suspended";
  notes: string;
  createdAt: string;
  lastSignInAt: string | null;
  assignedProjects: { id: string; name: string }[];
  assignedTeams: { id: string; projectId: string; name: string }[];
  activeTaskCount: number;
  completedTaskCount: number;
  overdueTaskCount: number;
};
