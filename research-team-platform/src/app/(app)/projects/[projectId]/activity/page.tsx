import type { Metadata } from "next";

import { ActivityFilters } from "@/components/activity/activity-filters";
import { ActivityList } from "@/components/activity/activity-list";
import { AccessDenied } from "@/components/shared/access-denied";
import { Pagination } from "@/components/shared/pagination";
import { Card, CardContent } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { parseActivitySearchParams } from "@/lib/search-params";
import { getProjectAccess } from "@/server/access";
import { ACTIVITY_ENTITY_TYPES, listActivity } from "@/server/queries/activity";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.activity.title };
}

const PROJECT_ENTITY_TYPES = ACTIVITY_ENTITY_TYPES.filter((type) => type !== "platform_user");

export default async function ProjectActivityPage(props: PageProps<"/projects/[projectId]/activity">) {
  const { projectId } = await props.params;
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null;

  const { t } = await getI18n();
  if (!can(access, "activity.view")) return <AccessDenied />;

  const filters = parseActivitySearchParams(await props.searchParams, PROJECT_ENTITY_TYPES);
  const activity = await listActivity({ projectId, entityType: filters.entity, page: filters.page });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t.activity.projectSubtitle}</p>
        <ActivityFilters entityTypes={PROJECT_ENTITY_TYPES} />
      </div>
      <Card>
        <CardContent>
          <ActivityList items={activity.items} />
        </CardContent>
      </Card>
      <Pagination page={activity.page} pageSize={activity.pageSize} total={activity.total} />
    </div>
  );
}
