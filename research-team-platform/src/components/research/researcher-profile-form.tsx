"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";

import { useServerAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { updateResearcherProfileAction } from "@/server/actions/research";
import type { ResearcherRecord } from "@/types/research";

export function ResearcherProfileForm({ researcher }: { researcher: ResearcherRecord }) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useServerAction();
  const [fullName, setFullName] = useState(researcher.fullName);
  const [phone, setPhone] = useState(researcher.phone ?? "");
  const [avatarUrl, setAvatarUrl] = useState(researcher.avatarUrl ?? "");
  const [specialization, setSpecialization] = useState(researcher.specialization);
  const [skills, setSkills] = useState(researcher.skills.join(", "));
  const [academicBackground, setAcademicBackground] = useState(researcher.academicBackground);
  const [status, setStatus] = useState<ResearcherRecord["status"]>(researcher.status);
  const [notes, setNotes] = useState(researcher.notes);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await run(
      () =>
        updateResearcherProfileAction(researcher.id, {
          fullName,
          phone,
          avatarUrl,
          specialization,
          skills: skills
            .split(",")
            .map((skill) => skill.trim())
            .filter(Boolean),
          academicBackground,
          status,
          notes,
        }),
      { success: status === "active" ? t.researchers.updated : t.researchers.accessRevoked },
    );
    if (result?.ok) router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="researcher-name">{t.researchers.fullName}</Label>
          <Input
            id="researcher-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={120}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="researcher-email">{t.researchers.email}</Label>
          <Input id="researcher-email" value={researcher.email ?? ""} readOnly dir="ltr" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="researcher-phone">{t.researchers.phone}</Label>
          <Input
            id="researcher-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={40}
            dir="ltr"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="researcher-avatar">{t.researchers.avatarUrl}</Label>
          <Input
            id="researcher-avatar"
            type="url"
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            dir="ltr"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="researcher-specialization">{t.researchers.specialization}</Label>
          <Input
            id="researcher-specialization"
            value={specialization}
            onChange={(event) => setSpecialization(event.target.value)}
            maxLength={200}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="researcher-skills">{t.researchers.skills}</Label>
          <Input
            id="researcher-skills"
            value={skills}
            onChange={(event) => setSkills(event.target.value)}
            maxLength={2500}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="researcher-academic">{t.researchers.academicBackground}</Label>
          <Textarea
            id="researcher-academic"
            rows={3}
            value={academicBackground}
            onChange={(event) => setAcademicBackground(event.target.value)}
            maxLength={3000}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="researcher-status">{t.researchers.status}</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as ResearcherRecord["status"])}>
            <SelectTrigger id="researcher-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t.researchers.active}</SelectItem>
              <SelectItem value="inactive">{t.researchers.inactive}</SelectItem>
              <SelectItem value="suspended">{t.researchers.suspended}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="researcher-notes">{t.researchers.notes}</Label>
          <Textarea
            id="researcher-notes"
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={5000}
          />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save aria-hidden />}
        {t.researchers.save}
      </Button>
    </form>
  );
}
