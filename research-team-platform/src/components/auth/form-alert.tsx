import { CircleAlert, CircleCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

export function FormAlert({ message, tone = "error" }: { message: string | null; tone?: "error" | "success" }) {
  if (!message) return null;
  return (
    <Alert variant={tone === "error" ? "destructive" : "info"} aria-live="polite">
      {tone === "error" ? <CircleAlert aria-hidden /> : <CircleCheck aria-hidden />}
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
