import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { DocumentTable } from "@/components/documents/document-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { getI18n } from "@/lib/i18n/server";
import { toAccessDTO } from "@/lib/permissions/access";
import { can } from "@/lib/permissions/policy";
import { parsePageParam } from "@/lib/search-params";
import { getMyProjectsAccess } from "@/server/access";
import { listDocuments } from "@/server/queries/documents";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.documents.title };
}

export default async function AllDocumentsPage(props: PageProps<"/documents">) {
  const [{ t }, access] = await Promise.all([getI18n(), getMyProjectsAccess()]);
  const allowed = access.filter((item) => can(item, "documents.view"));
  if (allowed.length === 0) return <AccessDenied />;

  const { page, project } = parsePageParam(await props.searchParams);
  const documents = await listDocuments({ page, projectId: project });

  return (
    <div className="space-y-6">
      <PageHeader title={t.documents.title} description={t.documents.subtitle} />
      {documents.items.length === 0 ? (
        <EmptyState icon={FileText} title={t.documents.empty} description={t.documents.emptyHint} />
      ) : (
        <>
          <DocumentTable
            documents={documents.items}
            accessByProject={Object.fromEntries(allowed.map((item) => [item.projectId, toAccessDTO(item)]))}
            showProject
          />
          <Pagination page={documents.page} pageSize={documents.pageSize} total={documents.total} />
        </>
      )}
    </div>
  );
}
