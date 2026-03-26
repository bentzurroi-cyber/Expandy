import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { IconPicker } from "@/components/settings/IconPicker";
import { ColorBadge } from "@/components/expense/ColorBadge";
import { useI18n } from "@/context/I18nContext";
import type { PaymentMethod } from "@/data/mock";

type Kind = "payment" | "destination";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Kind;
  items: PaymentMethod[];
  selectedId: string;
  onSelectId: (id: string) => void;
  onAdd: (name: string) => string | null;
  onUpdate: (id: string, patch: { name?: string; iconKey?: string; color?: string }) => void;
  onDelete: (id: string, moveToId?: string) => void;
  usageCount: Map<string, number>;
  builtInIds: Set<string>;
  title: string;
  description: string;
};

export function ManagePaymentMethodsDialog({
  open,
  onOpenChange,
  kind,
  items,
  selectedId,
  onSelectId,
  onAdd,
  onUpdate,
  onDelete,
  usageCount,
  builtInIds,
  title,
  description,
}: Props) {
  const { t, dir, lang } = useI18n();
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [moveToId, setMoveToId] = useState<string>("");
  const [newName, setNewName] = useState("");

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name, "he")),
    [items],
  );

  const editing = useMemo(
    () => (editId ? sorted.find((x) => x.id === editId) ?? null : null),
    [editId, sorted],
  );

  const deletePrompt =
    lang === "he"
      ? "יש תנועות שמשתמשות באמצעי תשלום זה. בחרו חלופה להעברה לפני מחיקה."
      : "There are transactions using this payment method. Choose an alternative to reassign them to before deleting.";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir={dir} className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {sorted.map((m) => {
              const builtin = builtInIds.has(m.id);
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-3"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-start"
                    onClick={() => onSelectId(m.id)}
                  >
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${m.color}1A` }}
                      aria-hidden
                    >
                      <CategoryGlyph iconKey={m.iconKey} className="size-4" />
                    </span>
                    <ColorBadge color={m.color} />
                    <span className="min-w-0 truncate text-sm font-medium">
                      {m.name}
                    </span>
                    {m.id === selectedId ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {lang === "he" ? "נבחר" : "Selected"}
                      </span>
                    ) : null}
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditId(m.id)}
                    >
                      {lang === "he" ? "עריכה" : "Edit"}
                    </Button>
                    {!builtin ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={lang === "he" ? "מחיקה" : "Delete"}
                        onClick={() => {
                          const count = usageCount.get(m.id) ?? 0;
                          if (count <= 0) {
                            onDelete(m.id);
                            if (selectedId === m.id) {
                              const fallback = sorted.find((x) => x.id !== m.id)?.id;
                              if (fallback) onSelectId(fallback);
                            }
                            return;
                          }
                          setDeleteId(m.id);
                          const fallback = sorted.find((x) => x.id !== m.id)?.id ?? "";
                          setMoveToId(fallback);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="pm-new">
                  {lang === "he"
                    ? kind === "destination"
                      ? "הוסף חשבון יעד"
                      : "הוסף אמצעי תשלום"
                    : kind === "destination"
                      ? "Add destination account"
                      : "Add payment method"}
                </Label>
                <Input
                  id="pm-new"
                  placeholder={lang === "he" ? "שם..." : "Name..."}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const id = onAdd(newName.trim());
                  if (id) onSelectId(id);
                  setNewName("");
                }}
                disabled={!newName.trim()}
              >
                {t.add}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {lang === "he"
                ? "טיפ: אחרי יצירה אפשר לערוך צבע ואייקון."
                : "Tip: after creating, you can edit color and icon."}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit modal */}
      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditId(null)}>
        <DialogContent dir={dir}>
          <DialogHeader>
            <DialogTitle>{lang === "he" ? "עריכת פריט" : "Edit item"}</DialogTitle>
            <DialogDescription>{editing?.name ?? ""}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pm-name">{lang === "he" ? "שם" : "Name"}</Label>
                <Input
                  id="pm-name"
                  value={editing.name}
                  onChange={(e) => onUpdate(editing.id, { name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pm-color">{lang === "he" ? "צבע" : "Color"}</Label>
                <input
                  id="pm-color"
                  type="color"
                  value={editing.color}
                  onChange={(e) => onUpdate(editing.id, { color: e.target.value })}
                  className="h-10 w-12 cursor-pointer rounded-md border border-border bg-transparent p-1"
                />
              </div>
              <div className="space-y-2">
                <Label>{lang === "he" ? "אייקון" : "Icon"}</Label>
                <IconPicker
                  value={editing.iconKey}
                  onChange={(k) => onUpdate(editing.id, { iconKey: k })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditId(null)}>
                  {t.cancel}
                </Button>
                <Button type="button" onClick={() => setEditId(null)}>
                  {lang === "he" ? "סיום" : "Done"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Safe delete */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lang === "he" ? "מחיקה עם העברה" : "Delete with reassignment"}
            </AlertDialogTitle>
            <AlertDialogDescription>{deletePrompt}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="move-to-method">
              {lang === "he" ? "העבר אל" : "Move to"}
            </Label>
            <Select value={moveToId} onValueChange={setMoveToId}>
              <SelectTrigger id="move-to-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {sorted
                  .filter((m) => m.id !== deleteId)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id} textValue={m.name}>
                      <span className="flex items-center gap-2">
                        <CategoryGlyph iconKey={m.iconKey} className="size-4" />
                        <ColorBadge color={m.color} />
                        <SelectItemText>{m.name}</SelectItemText>
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteId || !moveToId) return;
                onDelete(deleteId, moveToId);
                if (selectedId === deleteId) onSelectId(moveToId);
                setDeleteOpen(false);
              }}
            >
              {lang === "he" ? "מחק" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

