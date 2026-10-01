import type { Metadata } from "next";

import { ActivityFilters } from "@/components/activity/activity-filters";
import { ActivityList } from "@/components/activity/activity-list";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { can } from "@/lib/permissions/policy";
import { parseActivitySearchParams } from "@/lib/search-params";
import { getMyProjectsAccess } from "@/server/access";
import { requireCurrentProfile } from "@/server/auth";
import { ACTIVITY_ENTITY_TYPES, listActivity } from "@/server/queries/activity";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.activity.title };
}

export default async function ActivityPage(props: PageProps<"/activity">) {
  const profile = await requireCurrentProfile();
  const [{ t }, access] = await Promise.all([getI18n(), getMyProjectsAccess()]);
  const auditable = access.filter((item) => can(item, "activity.view"));
  const fullAccess = auditable.length > 0 || profile.isPlatformAdmin;

  const filters = parseActivitySearchParams(await props.searchParams, ACTIVITY_ENTITY_TYPES);
  // Without activity.view anywhere, RLS limits the log to the user's own actions.
  const activity = await listActivity({
    projectId: filters.project,
    entityType: filters.entity,
    page: filters.page,
    actorId: fullAccess ? undefined : profile.id,
  });

  const entityTypes = profile.isPlatformAdmin
    ? ACTIVITY_ENTITY_TYPES
    : ACTIVITY_ENTITY_TYPES.filter((type) => type !== "platform_user");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.activity.title}
        description={t.activity.subtitle}
        actions={
          <ActivityFilters
            entityTypes={entityTypes}
            projects={auditable.map((item) => ({ id: item.projectId, name: item.projectName }))}
          />
        }
      />
      {!fullAccess ? (
        <Alert variant="info">
          <AlertDescription>{t.activity.ownOnlyNotice}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent>
          <ActivityList items={activity.items} showProject />
        </CardContent>
      </Card>
      <Pagination page={activity.page} pageSize={activity.pageSize} total={activity.total} />
    </div>
  );
}
