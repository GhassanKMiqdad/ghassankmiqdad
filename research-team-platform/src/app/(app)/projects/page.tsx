import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";

import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";
import { requireCurrentProfile } from "@/server/auth";
import { listMyProjects } from "@/server/queries/projects";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.projects.title };
}

export default async function ProjectsPage() {
  const profile = await requireCurrentProfile();
  const [i18n, projects] = await Promise.all([getI18n(), listMyProjects()]);
  const { t } = i18n;

  const newButton = profile.canCreateProjects ? (
    <Button asChild>
      <Link href="/projects/new">
        <Plus aria-hidden />
        {t.projects.new}
      </Link>
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t.projects.title} description={t.projects.subtitle} actions={newButton} />
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={t.projects.empty}
          description={profile.canCreateProjects ? t.projects.emptyCreate : t.projects.emptyNoRights}
          action={newButton}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} i18n={i18n} />
          ))}
        </div>
      )}
    </div>
  );
}
