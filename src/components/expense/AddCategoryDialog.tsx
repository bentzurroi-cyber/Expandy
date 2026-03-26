import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconPicker } from "@/components/settings/IconPicker";
import { useI18n } from "@/context/I18nContext";

export function AddCategoryDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (input: { name: string; iconKey: string; color: string }) => void;
}) {
  const { t, dir } = useI18n();
  const [name, setName] = useState("");
  const [iconKey, setIconKey] = useState("tag");
  const [color, setColor] = useState("#94a3b8");

  const canSubmit = useMemo(() => name.trim().length > 0, [name]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setName("");
          setIconKey("tag");
          setColor("#94a3b8");
        }
      }}
    >
      <DialogContent dir={dir}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="add-cat-name">{t.categoryNameLabel}</Label>
            <Input
              id="add-cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t.pickIcon}</p>
            <IconPicker value={iconKey} onChange={setIconKey} />
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {dir === "rtl" ? "צבע" : "Color"}
            </p>
            <div className="flex items-center justify-between gap-3">
              <Input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 p-1"
                aria-label={dir === "rtl" ? "בחירת צבע" : "Pick color"}
              />
              <div className="flex flex-wrap justify-end gap-2">
                {[
                  "#22c55e",
                  "#06b6d4",
                  "#3b82f6",
                  "#a855f7",
                  "#f59e0b",
                  "#ef4444",
                  "#14b8a6",
                  "#fb7185",
                  "#94a3b8",
                  "#64748b",
                  "#fbbf24",
                  "#84cc16",
                ].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="size-6 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={!canSubmit}
              onClick={() => {
                onConfirm({ name: name.trim(), iconKey, color });
                onOpenChange(false);
              }}
            >
              {confirmLabel || t.add}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

