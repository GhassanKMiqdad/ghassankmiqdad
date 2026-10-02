import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { DocumentTable } from "@/components/documents/document-table";
import { UploadDocumentDialog } from "@/components/documents/upload-document-dialog";
import { AccessDenied } from "@/components/shared/access-denied";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/pagination";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import { can } from "@/lib/permissions/policy";
import { parsePageParam } from "@/lib/search-params";
import { getProjectAccess } from "@/server/access";
import { listDocuments } from "@/server/queries/documents";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.documents.title };
}

export default async function ProjectDocumentsPage(props: PageProps<"/projects/[projectId]/documents">) {
  const { projectId } = await props.params;
  const access = await getProjectAccess(projectId);
  if (!access || !can(access, "project.view")) return null;

  const { t } = await getI18n();
  if (!can(access, "documents.view")) return <AccessDenied />;

  const { page } = parsePageParam(await props.searchParams);
  const documents = await listDocuments({ projectId, page });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t.documents.projectSubtitle}</p>
        {can(access, "documents.upload") ? <UploadDocumentDialog projectId={projectId} /> : null}
      </div>
      {documents.items.length === 0 ? (
        <EmptyState icon={FileText} title={t.documents.empty} description={t.documents.emptyHint} />
      ) : (
        <>
          <DocumentTable documents={documents.items} accessByProject={{ [projectId]: toAccessDTO(access) }} />
          <Pagination page={documents.page} pageSize={documents.pageSize} total={documents.total} />
        </>
      )}
    </div>
  );
}
