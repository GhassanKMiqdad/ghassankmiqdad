import type { Metadata } from "next";
import { ExternalLink, Megaphone } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TaskCode } from "@/components/shared/badges";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { requireSessionUser } from "@/server/auth";
import { listPublications } from "@/server/queries/teams";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.results.title };
}

/**
 * Team results: only the sanitized publication of each completed task
 * (RLS limits rows to the viewer's teams). Drafts, earlier versions, review
 * notes and private notes are never part of a publication.
 */
export default async function ResultsPage() {
  await requireSessionUser();
  const [i18n, items] = await Promise.all([getI18n(), listPublications({ limit: 200 })]);
  const { t, fmt } = i18n;

  return (
    <div className="space-y-6">
      <PageHeader title={t.results.title} description={t.results.subtitle} />
      {items.length === 0 ? (
        <EmptyState icon={Megaphone} title={t.results.empty} description={t.results.emptyHint} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <Card key={item.taskId}>
              <CardHeader className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <TaskCode code={item.code} />
                  {item.teamName ? <span className="text-xs text-muted-foreground">{item.teamName}</span> : null}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {fmt(t.results.completedOn, { date: i18n.date(item.completedAt) })}
                  </span>
                </div>
                <h2 dir="auto" className="text-base font-semibold">
                  {item.title}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t.results.responsible}: {item.responsibleName ?? t.common.unknownUser}
                  {item.responsibleTitle ? ` — ${item.responsibleTitle}` : ""}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">{t.results.finalResult}</h3>
                  <p dir="auto" className="text-start text-sm whitespace-pre-wrap">
                    {item.finalResult}
                  </p>
                </div>
                {item.links.length > 0 ? (
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium">{t.results.deliverables}</h3>
                    <ul className="space-y-1">
                      {item.links.map((link) => (
                        <li key={link}>
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            dir="ltr"
                            className="inline-flex max-w-full items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                            <span className="truncate">{link}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {item.teamComment ? (
                  <div className="rounded-md bg-muted/50 p-3 text-sm">
                    <span className="font-medium">{t.results.teamComment}: </span>
                    <span dir="auto" className="whitespace-pre-wrap">
                      {item.teamComment}
                    </span>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">{fmt(t.results.version, { version: item.version })}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
