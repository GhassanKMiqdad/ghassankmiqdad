import type { Metadata } from "next";

import { ProjectForm } from "@/components/projects/project-form";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { requireCurrentProfile } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.projects.createTitle };
}

export default async function NewProjectPage() {
  const profile = await requireCurrentProfile();
  const { t } = await getI18n();

  if (!profile.canCreateProjects) {
    return <AccessDenied message={t.errors.PROJECT_CREATE_FORBIDDEN} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t.projects.createTitle} description={t.projects.createSubtitle} />
      <Card>
        <CardContent>
          <ProjectForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
