import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { AdminUsersTable } from "@/components/settings/admin-users-table";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { PasswordSettings } from "@/components/settings/password-settings";
import { ProfileForm } from "@/components/settings/profile-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { requireCurrentProfile } from "@/server/auth";
import { listPlatformUsers } from "@/server/queries/admin";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.settings.title };
}

export default async function SettingsPage() {
  const profile = await requireCurrentProfile();
  const i18n = await getI18n();
  const { t, fmt } = i18n;
  const users = profile.isPlatformAdmin ? await listPlatformUsers() : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t.settings.title} description={t.settings.subtitle} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.settings.profile.title}</CardTitle>
            <CardDescription>{t.settings.profile.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm fullName={profile.fullName} email={profile.email} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.settings.password.title}</CardTitle>
            <CardDescription>{t.settings.password.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordSettings />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.settings.preferences.title}</CardTitle>
            <CardDescription>{t.settings.preferences.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <AppearanceSettings />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.settings.account.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {fmt(t.settings.account.memberSince, { date: i18n.date(profile.createdAt) })}
            </p>
            <div className="flex flex-wrap gap-2">
              {profile.isPlatformAdmin ? (
                <Badge variant="info">
                  <ShieldCheck aria-hidden />
                  {t.settings.account.platformAdmin}
                </Badge>
              ) : null}
              {profile.canCreateProjects ? (
                <Badge variant="secondary">{t.settings.account.canCreateProjects}</Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {profile.isPlatformAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.settings.admin.title}</CardTitle>
            <CardDescription>{t.settings.admin.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminUsersTable users={users} currentUserId={profile.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
