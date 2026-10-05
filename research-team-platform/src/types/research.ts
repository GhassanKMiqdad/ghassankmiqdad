export type ProjectResearcher = {
  id: string;
  name: string;
  email: string | null;
};

export type ProjectTeam = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: "active" | "archived";
  memberIds: string[];
  leadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectMilestone = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  dueDate: string | null;
  status: "open" | "completed" | "archived";
  teamId: string | null;
  researcherIds: string[];
  createdAt: string;
  updatedAt: string;
};
