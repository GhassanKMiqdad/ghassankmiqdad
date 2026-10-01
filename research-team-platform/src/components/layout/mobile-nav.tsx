"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { Brand } from "@/components/layout/brand";
import { NavLinks, type NavKey } from "@/components/layout/nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n/provider";

export function MobileNav({ visible }: { visible: NavKey[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t.nav.openMenu}>
          <Menu aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="start" className="w-72 bg-sidebar p-0" closeLabel={t.common.close}>
        <SheetHeader className="border-b">
          <SheetTitle asChild>
            <div>
              <Brand name={t.app.name} />
            </div>
          </SheetTitle>
        </SheetHeader>
        <div className="p-3">
          <NavLinks visible={visible} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
