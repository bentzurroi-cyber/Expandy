import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Plus, GripVertical } from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DatePickerField } from "@/components/expense/DatePickerField";
import { CategoryGlyph, CurrencyGlyph } from "@/components/expense/FinanceGlyphs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Category, CurrencyDef, EntryType, PaymentMethod } from "@/data/mock";
import { useI18n } from "@/context/I18nContext";
import { currencyOptionLabel, formatIls } from "@/lib/format";
import { ColorBadge } from "./ColorBadge";
import { useExpenses } from "@/context/ExpensesContext";
import { cn } from "@/lib/utils";
import { reorderFirstBlock } from "@/lib/reorderCategoryIds";

const ADD_CATEGORY = "__add_category__";
const ADD_METHOD = "__add_method__";
const MANAGE_METHOD = "__manage_method__";
const ADD_CURRENCY = "__add_currency__";

function SortableGridCategoryTile({
  id,
  jiggle,
  dragLabel,
  accentStyle,
  children,
}: {
  id: string;
  jiggle?: boolean;
  dragLabel: string;
  accentStyle?: CSSProperties;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
    zIndex: isDragging ? 2 : undefined,
    ...accentStyle,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative flex min-h-[4.5rem] flex-col rounded-xl border border-border/70 bg-background px-2 py-3 text-center",
        jiggle && "entry-category-grid-wiggle",
      )}
    >
      <button
        type="button"
        className="absolute start-1 top-1 z-10 rounded-md bg-background/95 p-0.5 shadow-sm ring-1 ring-border/40"
        aria-label={dragLabel}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5 text-muted-foreground" />
      </button>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 pt-2">
        {children}
      </div>
    </div>
  );
}

function SortableDialogCategoryRow({
  id,
  dragLabel,
  children,
}: {
  id: string;
  dragLabel: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 2 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border border-border/70 px-2 py-2",
        isDragging && "shadow-md ring-1 ring-border",
      )}
    >
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/60"
        aria-label={dragLabel}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4 cursor-grab" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export type ExpenseFormFieldsProps = {
  idPrefix: string;
  amount: string;
  onAmountChange: (v: string) => void;
  currency: string;
  onCurrencyChange: (v: string) => void;
  categoryId: string;
  onCategoryIdChange: (v: string) => void;
  paymentMethodId: string;
  onPaymentMethodIdChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  /** YYYY-MM-DD */
  date?: string;
  onDateChange?: (v: string) => void;
  showDate?: boolean;
  entryType: EntryType;
  installments?: number;
  onInstallmentsChange?: (v: number) => void;
  recurringMonthly?: boolean;
  onRecurringMonthlyChange?: (v: boolean) => void;
  categoryOptions: Category[];
  currencies: CurrencyDef[];
  methods: PaymentMethod[];
  onAddExpenseCategory?: () => void;
  onAddIncomeSource?: () => void;
  onAddPaymentMethod?: () => void;
  onAddDestinationAccount?: () => void;
  onManagePaymentMethods?: () => void;
  onManageDestinationAccounts?: () => void;
  onAddCurrency?: () => void;
  onHint?: (message: string | null) => void;
  /** Persist custom category / income source order (Entry form grid + dialog). */
  onReorderCategories?: (orderedIds: string[]) => void;
  quickAccessCount?: number;
  onQuickAccessCountChange?: (count: number) => void;
  /** Entry screen can render amount/currency in a hero section. */
  showAmountCurrency?: boolean;
  /** Visual layout: default classic form vs fintech list rows. */
  layout?: "form" | "list";
  /** Entry screen can show a category grid instead of a dropdown. */
  categoryPicker?: "select" | "grid";
};

export function ExpenseFormFields({
  idPrefix,
  amount,
  onAmountChange,
  currency,
  onCurrencyChange,
  categoryId,
  onCategoryIdChange,
  paymentMethodId,
  onPaymentMethodIdChange,
  note,
  onNoteChange,
  date = "",
  onDateChange,
  showDate = false,
  entryType,
  installments = 1,
  onInstallmentsChange,
  recurringMonthly = false,
  onRecurringMonthlyChange,
  categoryOptions,
  currencies,
  methods,
  onAddExpenseCategory,
  onAddIncomeSource,
  onAddPaymentMethod,
  onAddDestinationAccount,
  onManagePaymentMethods,
  onManageDestinationAccounts,
  onAddCurrency,
  onHint,
  onReorderCategories,
  quickAccessCount = 8,
  onQuickAccessCountChange,
  showAmountCurrency = true,
  layout = "form",
  categoryPicker = "select",
}: ExpenseFormFieldsProps) {
  const { expenses } = useExpenses();
  const { t, dir } = useI18n();

  const currencyOptions = useMemo(() => {
    const list = [...currencies];
    if (currency && !list.some((c) => c.code === currency)) {
      list.push({
        code: currency,
        labelHe: currency,
        symbol: "¤",
        iconKey: "badge-cent",
      });
    }
    return list;
  }, [currencies, currency]);

  const categoryOptionsResolved = useMemo(() => {
    const list = [...categoryOptions];
    if (categoryId && !list.some((c) => c.id === categoryId)) {
      list.push({
        id: categoryId,
        name: categoryId,
        color: "#737373",
        iconKey: "tag",
      });
    }
    return list;
  }, [categoryOptions, categoryId]);

  const methodsResolved = useMemo(() => {
    const list = [...methods];
    if (paymentMethodId && !list.some((m) => m.id === paymentMethodId)) {
      list.push({
        id: paymentMethodId,
        name: paymentMethodId,
        color: "#737373",
        iconKey: entryType === "income" ? "wallet" : "credit-card",
      });
    }
    return list;
  }, [methods, paymentMethodId, entryType]);

  const quickCount = Math.max(1, Math.min(8, Math.floor(quickAccessCount)));

  const categoryGridTop = useMemo(() => {
    // Keep this grid strictly aligned with the user's custom category order.
    return categoryOptionsResolved.slice(0, quickCount);
  }, [categoryOptionsResolved, quickCount]);

  const [isEditingOrder, setIsEditingOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    setIsEditingOrder(false);
  }, [entryType]);

  const fullCategoryIds = useMemo(
    () => categoryOptionsResolved.map((c) => c.id),
    [categoryOptionsResolved],
  );

  const handleGridCategoryDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!onReorderCategories || !isEditingOrder) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const fullIds = categoryOptionsResolved.map((c) => c.id);
      onReorderCategories(
        reorderFirstBlock(fullIds, String(active.id), String(over.id), quickCount),
      );
    },
    [onReorderCategories, isEditingOrder, categoryOptionsResolved, quickCount],
  );

  const handleDialogCategoryDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!onReorderCategories || !isEditingOrder) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const fullIds = categoryOptionsResolved.map((c) => c.id);
      const oldIndex = fullIds.indexOf(String(active.id));
      const newIndex = fullIds.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      onReorderCategories(arrayMove(fullIds, oldIndex, newIndex));
    },
    [onReorderCategories, isEditingOrder, categoryOptionsResolved],
  );

  const dragLabelGrid =
    entryType === "income"
      ? t.settingsDragReorderIncome
      : t.settingsDragReorderCategory;

  const currencyMeta = useMemo(() => {
    const c = currencyOptions.find((x) => x.code === currency);
    return (
      c ?? {
        code: currency,
        labelHe: currency,
        symbol: "¤",
        iconKey: "badge-cent",
      }
    );
  }, [currency, currencyOptions]);

  const selectedCategory = useMemo(
    () => categoryOptionsResolved.find((c) => c.id === categoryId),
    [categoryId, categoryOptionsResolved],
  );

  const selectedMethod = useMemo(
    () => methodsResolved.find((m) => m.id === paymentMethodId),
    [paymentMethodId, methodsResolved],
  );

  const installmentPreview = useMemo(() => {
    if (entryType !== "expense" || !onInstallmentsChange) return null;
    const n = Math.max(1, Math.floor(installments));
    if (n <= 1) return null;
    const normalized = amount.replace(",", ".").trim();
    const parsed = parseFloat(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const unit = Math.round((parsed / n) * 100) / 100;
    if (currency === "ILS") {
      return `${formatIls(unit)} ${t.installmentEach}`;
    }
    return `${unit.toLocaleString("he-IL")} ${currencyMeta.symbol} ${t.installmentEach}`;
  }, [
    entryType,
    onInstallmentsChange,
    installments,
    amount,
    currency,
    currencyMeta.symbol,
  ]);

  const noteSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const e of expenses) {
      const n = e.note.trim();
      if (!n) continue;
      seen.add(n);
    }
    // Keep UI stable and nice for Hebrew search.
    return [...seen].sort((a, b) => a.localeCompare(b, "he"));
  }, [expenses]);

  const [notesOpen, setNotesOpen] = useState(false);
  const [allCategoriesOpen, setAllCategoriesOpen] = useState(false);

  const filteredNoteSuggestions = useMemo(() => {
    const q = note.trim();
    if (!q) return [];
    const qn = q.toLowerCase();

    const startsWith: string[] = [];
    const includes: string[] = [];
    for (const s of noteSuggestions) {
      const sn = s.toLowerCase();
      if (sn.startsWith(qn)) startsWith.push(s);
      else if (sn.includes(qn)) includes.push(s);
      if (startsWith.length + includes.length >= 8) break;
    }
    return [...startsWith, ...includes].slice(0, 8);
  }, [note, noteSuggestions]);

  const showNoteDropdown = notesOpen && filteredNoteSuggestions.length > 0;
  const [notePopoverOpen, setNotePopoverOpen] = useState(false);
  const [installmentsOpen, setInstallmentsOpen] = useState(false);

  function onCategoryChange(value: string) {
    if (value === ADD_CATEGORY) {
      if (entryType === "income") {
        onAddIncomeSource?.();
        return;
      }
      onAddExpenseCategory?.();
      return;
    }
    onCategoryIdChange(value);
    onHint?.(null);
  }

  function onMethodChange(value: string) {
    if (value === ADD_METHOD) {
      if (entryType === "income") {
        onAddDestinationAccount?.();
        return;
      }
      onAddPaymentMethod?.();
      return;
    }
    if (value === MANAGE_METHOD) {
      if (entryType === "income") {
        onManageDestinationAccounts?.();
        return;
      }
      onManagePaymentMethods?.();
      return;
    }
    onPaymentMethodIdChange(value);
    onHint?.(null);
  }

  function onCurrencySelect(value: string) {
    if (value === ADD_CURRENCY) {
      onAddCurrency?.();
      return;
    }
    onCurrencyChange(value);
  }

  /** Shared padding for Entry/Edit list rows (category, payment, date row, notes, installments). */
  const rowPad = "px-5 py-5";

  const Row = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div
      className={cn(
        "flex w-full min-h-[3.5rem] items-center justify-between gap-3 text-base leading-relaxed",
        rowPad,
        className,
      )}
    >
      {children}
    </div>
  );

  if (layout === "list") {
    const renderCategoryGrid = categoryPicker === "grid";
    return (
      <div className="w-full overflow-hidden rounded-2xl border border-border/70 bg-background p-0">
        {showDate && onDateChange ? (
          <>
            <DatePickerField
              id={`${idPrefix}-date`}
              label={t.dateLabel}
              value={date}
              onChange={onDateChange}
              variant="row"
              hideLabel
            />
            <div className="h-px w-full bg-border/70" />
          </>
        ) : null}

        {renderCategoryGrid ? (
          <>
            <div className="px-5 py-5">
              <div className="mb-3 flex items-center justify-between gap-2 text-base leading-relaxed text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CategoryGlyph
                    iconKey={selectedCategory?.iconKey ?? "tag"}
                    className="size-4"
                  />
                  <span>
                    {entryType === "income" ? t.incomeSource : t.category}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isEditingOrder && onQuickAccessCountChange ? (
                    <div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 px-1 py-0.5">
                      <button
                        type="button"
                        className="rounded-full px-1.5 text-sm leading-relaxed text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        onClick={() => onQuickAccessCountChange(Math.max(1, quickCount - 1))}
                        aria-label={t.decreaseQuickAccessCount}
                      >
                        -
                      </button>
                      <span className="min-w-[1.25rem] text-center text-sm leading-relaxed tabular-nums text-foreground">
                        {quickCount}
                      </span>
                      <button
                        type="button"
                        className="rounded-full px-1.5 text-sm leading-relaxed text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        onClick={() => onQuickAccessCountChange(Math.min(8, quickCount + 1))}
                        aria-label={t.increaseQuickAccessCount}
                      >
                        +
                      </button>
                    </div>
                  ) : null}
                  {onReorderCategories ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 px-2 text-sm leading-relaxed text-muted-foreground hover:text-foreground"
                      onClick={() => setIsEditingOrder((v) => !v)}
                    >
                      {isEditingOrder ? t.categoryDoneOrderEdit : t.categoryEditOrder}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {isEditingOrder && onReorderCategories ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleGridCategoryDragEnd}
                  >
                    <SortableContext
                      items={categoryGridTop.map((c) => c.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="contents">
                        {categoryGridTop.map((c) => {
                          const active = c.id === categoryId;
                          return (
                            <SortableGridCategoryTile
                              key={c.id}
                              id={c.id}
                              jiggle
                              dragLabel={dragLabelGrid}
                              accentStyle={{
                                backgroundImage: `linear-gradient(180deg, ${c.color}1A, transparent)`,
                                borderColor: active ? undefined : `${c.color}55`,
                              }}
                            >
                              <CategoryGlyph
                                iconKey={c.iconKey}
                                className="size-5 text-foreground"
                              />
                              <span className="w-full truncate text-sm leading-relaxed text-foreground">
                                {c.name}
                              </span>
                            </SortableGridCategoryTile>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <>
                    {categoryGridTop.map((c) => {
                      const active = c.id === categoryId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onCategoryIdChange(c.id)}
                          className={cn(
                            "flex flex-col items-center justify-center gap-2 rounded-xl border border-border/70 bg-background px-2 py-3 text-center transition-colors",
                            "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active && "border-primary/40 bg-muted/30",
                          )}
                          style={{
                            backgroundImage: `linear-gradient(180deg, ${c.color}1A, transparent)`,
                            borderColor: active ? undefined : `${c.color}55`,
                          }}
                          aria-pressed={active}
                        >
                          <CategoryGlyph iconKey={c.iconKey} className="size-5 text-foreground" />
                          <span className="w-full truncate text-sm leading-relaxed text-foreground">
                            {c.name}
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}
                <Dialog open={allCategoriesOpen} onOpenChange={setAllCategoriesOpen}>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background px-2 py-3 text-center transition-colors",
                        "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <span className="text-base leading-relaxed text-muted-foreground">עוד...</span>
                    </button>
                  </DialogTrigger>
                  <DialogContent dir={dir}>
                    <DialogHeader>
                      <DialogTitle>
                        {entryType === "income" ? t.incomeSource : t.category}
                      </DialogTitle>
                    </DialogHeader>
                    {isEditingOrder && onReorderCategories ? (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDialogCategoryDragEnd}
                      >
                        <SortableContext
                          items={fullCategoryIds}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-2 pb-2">
                            <p className="text-sm leading-relaxed text-muted-foreground">{t.quickAccessSectionLabel}</p>
                            {categoryOptionsResolved.slice(0, quickCount).map((c) => (
                              <SortableDialogCategoryRow
                                key={`full-${c.id}`}
                                id={c.id}
                                dragLabel={dragLabelGrid}
                              >
                                <div className="flex w-full items-center gap-2 text-start">
                                  <CategoryGlyph iconKey={c.iconKey} className="size-4" />
                                  <ColorBadge color={c.color} />
                                  <span className="truncate text-base leading-relaxed">{c.name}</span>
                                </div>
                              </SortableDialogCategoryRow>
                            ))}
                          </div>
                          <div className="max-h-[40vh] space-y-2 overflow-auto pt-2">
                            <p className="text-sm leading-relaxed text-muted-foreground">{t.moreSectionLabel}</p>
                            {categoryOptionsResolved.slice(quickCount).map((c) => (
                              <SortableDialogCategoryRow
                                key={`full-more-${c.id}`}
                                id={c.id}
                                dragLabel={dragLabelGrid}
                              >
                                <div className="flex w-full items-center gap-2 text-start">
                                  <CategoryGlyph iconKey={c.iconKey} className="size-4" />
                                  <ColorBadge color={c.color} />
                                  <span className="truncate text-base leading-relaxed">{c.name}</span>
                                </div>
                              </SortableDialogCategoryRow>
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    ) : (
                      <div className="max-h-[60vh] space-y-2 overflow-auto">
                        {categoryOptionsResolved.slice(quickCount).map((c) => (
                          <button
                            key={`full-${c.id}`}
                            type="button"
                            onClick={() => {
                              onCategoryIdChange(c.id);
                              setAllCategoriesOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-start transition-colors",
                              "hover:bg-accent/40",
                              c.id === categoryId && "bg-muted/30",
                            )}
                          >
                            <CategoryGlyph iconKey={c.iconKey} className="size-4" />
                            <ColorBadge color={c.color} />
                            <span className="truncate text-base leading-relaxed">{c.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAllCategoriesOpen(false);
                        onCategoryChange(ADD_CATEGORY);
                      }}
                    >
                      {entryType === "income" ? t.addIncomeSource : t.addCategory}
                    </Button>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            <div className="h-px w-full bg-border/70" />
          </>
        ) : (
          <>
            <Select value={categoryId} onValueChange={onCategoryChange}>
              <SelectTrigger
                id={`${idPrefix}-category`}
                className={cn(
                  "h-auto w-full min-h-[3.5rem] rounded-none border-0 bg-transparent text-base leading-relaxed",
                  rowPad,
                )}
              >
                <div className="flex w-full min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    {selectedCategory ? (
                      <>
                        <CategoryGlyph iconKey={selectedCategory.iconKey} className="size-4" />
                        <ColorBadge color={selectedCategory.color} />
                      </>
                    ) : (
                      <CategoryGlyph iconKey="tag" className="size-4" />
                    )}
                    <span className="truncate">
                      {entryType === "income" ? t.incomeSource : t.category}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "min-w-0 truncate",
                      selectedCategory ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {selectedCategory?.name ??
                      (entryType === "income"
                        ? t.incomeSourcePlaceholder
                        : t.categoryPlaceholder)}
                  </div>
                </div>
              </SelectTrigger>
              <SelectContent position="popper">
                {categoryOptionsResolved.map((c) => (
                  <SelectItem key={c.id} value={c.id} textValue={c.name}>
                    <span className="flex items-center gap-2">
                      <CategoryGlyph iconKey={c.iconKey} />
                      <ColorBadge color={c.color} />
                      <SelectItemText>{c.name}</SelectItemText>
                    </span>
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem
                  value={ADD_CATEGORY}
                  textValue={entryType === "income" ? t.addIncomeSource : t.addCategory}
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <SelectItemText>
                      {entryType === "income" ? t.addIncomeSource : t.addCategory}
                    </SelectItemText>
                    <Plus className="size-3.5 shrink-0" aria-hidden />
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <div className="h-px w-full bg-border/70" />
          </>
        )}

        <Select value={paymentMethodId} onValueChange={onMethodChange}>
          <SelectTrigger
            id={`${idPrefix}-payment`}
            className={cn(
              "h-auto w-full min-h-[3.5rem] rounded-none border-0 bg-transparent text-base leading-relaxed",
              rowPad,
            )}
          >
            <div className="flex w-full min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                {selectedMethod ? (
                  <>
                    <CategoryGlyph iconKey={selectedMethod.iconKey} className="size-4" />
                    <ColorBadge color={selectedMethod.color} />
                  </>
                ) : (
                  <ColorBadge color="#737373" />
                )}
                <span className="truncate">
                  {entryType === "income" ? t.destinationAccount : t.paymentMethod}
                </span>
              </div>
              <div
                className={cn(
                  "min-w-0 truncate",
                  selectedMethod ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {selectedMethod?.name ??
                  (entryType === "income"
                    ? t.destinationAccountPlaceholder
                    : t.paymentPlaceholder)}
              </div>
            </div>
          </SelectTrigger>
          <SelectContent position="popper">
            {methodsResolved.map((m) => (
              <SelectItem key={m.id} value={m.id} textValue={m.name}>
                <span className="flex items-center gap-2">
                  <CategoryGlyph iconKey={m.iconKey} className="size-4" />
                  <ColorBadge color={m.color} />
                  <SelectItemText>{m.name}</SelectItemText>
                </span>
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem
              value={ADD_METHOD}
              textValue={entryType === "income" ? t.addDestinationAccount : t.addPaymentMethod}
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <SelectItemText>
                  {entryType === "income" ? t.addDestinationAccount : t.addPaymentMethod}
                </SelectItemText>
                <Plus className="size-3.5 shrink-0" aria-hidden />
              </span>
            </SelectItem>
            {(entryType === "income"
              ? onManageDestinationAccounts
              : onManagePaymentMethods) ? (
              <>
                <SelectSeparator />
                <SelectItem value={MANAGE_METHOD} textValue="manage">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <SelectItemText>
                      {entryType === "income" ? "ניהול חשבונות" : "ניהול אמצעי תשלום"}
                    </SelectItemText>
                  </span>
                </SelectItem>
              </>
            ) : null}
          </SelectContent>
        </Select>
        <div className="h-px w-full bg-border/70" />

        {entryType === "expense" && onInstallmentsChange && !recurringMonthly ? (
          <>
            <Popover open={installmentsOpen} onOpenChange={setInstallmentsOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="w-full text-start"
                  onClick={() => setInstallmentsOpen(true)}
                >
                  <Row>
                    <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                      <span className="size-4 shrink-0 rounded-sm border border-border/70 bg-muted/40" />
                      <span className="truncate">{t.installments}</span>
                    </div>
                    <div className="min-w-0 truncate text-foreground">
                      <span dir="ltr" className="tabular-nums">
                        {String(Math.floor(installments))}
                      </span>
                    </div>
                  </Row>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto min-w-[14rem] p-4"
                align="end"
                dir={dir}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
                    <div className="flex items-stretch overflow-hidden rounded-xl border border-input bg-background">
                      <button
                        type="button"
                        className="px-3 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          onInstallmentsChange(Math.max(1, Math.floor(installments) - 1))
                        }
                        aria-label={t.decrementInstallments}
                      >
                        −
                      </button>
                      <div
                        id={`${idPrefix}-installments`}
                        dir="ltr"
                        className="flex w-[6.5rem] items-center justify-center tabular-nums text-base leading-relaxed"
                      >
                        {Math.max(1, Math.floor(installments))}
                      </div>
                      <button
                        type="button"
                        className="px-3 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          onInstallmentsChange(Math.max(1, Math.floor(installments) + 1))
                        }
                        aria-label={t.incrementInstallments}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    onClick={() => setInstallmentsOpen(false)}
                  >
                    אישור
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <div className="h-px w-full bg-border/70" />
          </>
        ) : null}

        {onRecurringMonthlyChange ? (
          <>
            <Row>
              <span className="text-base leading-relaxed text-muted-foreground">
                {entryType === "income" ? t.recurringIncome : t.recurringExpense}
              </span>
              <Switch
                id={`${idPrefix}-recurring`}
                checked={recurringMonthly}
                onCheckedChange={(v: boolean) => {
                  const next = Boolean(v);
                  onRecurringMonthlyChange(next);
                  if (next && onInstallmentsChange) onInstallmentsChange(1);
                }}
              />
            </Row>
            <div className="h-px w-full bg-border/70" />
          </>
        ) : null}

        <Popover open={notePopoverOpen} onOpenChange={setNotePopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-full text-start"
              onClick={() => setNotePopoverOpen(true)}
            >
              <Row>
                <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span className="size-4 shrink-0 rounded-sm border border-border/70 bg-muted/40" />
                  <span className="truncate">{t.note}</span>
                </div>
                <div className="min-w-0 truncate text-foreground">
                  {note.trim() ? note.trim() : t.notePlaceholder}
                </div>
              </Row>
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(92vw,26rem)] p-5"
            align="end"
            dir={dir}
          >
            <div className="flex flex-col gap-4">
              <Label htmlFor={`${idPrefix}-note`}>{t.note}</Label>
              <div className="relative">
                <Textarea
                  id={`${idPrefix}-note`}
                  placeholder={t.notePlaceholder}
                  value={note}
                  onChange={(e) => onNoteChange(e.target.value)}
                  rows={4}
                  className="min-h-[6.5rem]"
                  onFocus={() => setNotesOpen(true)}
                  onBlur={() => setNotesOpen(false)}
                  autoFocus
                />
                {showNoteDropdown ? (
                  <div
                    className="absolute left-0 right-0 top-full z-[100000] mt-1.5 rounded-2xl border border-muted/30 bg-popover p-2 shadow-xl animate-in fade-in-0 zoom-in-95"
                    dir={dir}
                  >
                    <div className="max-h-56 space-y-1 overflow-auto">
                      {filteredNoteSuggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="w-full rounded-xl px-4 py-3 text-start text-base leading-relaxed text-foreground transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onNoteChange(s);
                            setNotesOpen(false);
                            setNotePopoverOpen(false);
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                className="mt-1 w-full"
                onClick={() => setNotePopoverOpen(false)}
              >
                אישור
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div className="flex w-full box-border flex-col gap-5">
      {showAmountCurrency ? (
        <div className="w-full box-border space-y-2">
          <Label htmlFor={`${idPrefix}-amount`}>{t.amountAndCurrency}</Label>
          <div className="flex w-full box-border gap-2">
            <div className="relative w-full min-w-0 flex-1 box-border">
              <span
                className="pointer-events-none absolute start-3 top-1/2 z-[1] -translate-y-1/2 text-sm tabular-nums text-muted-foreground"
                aria-hidden
              >
                {currencyMeta.symbol}
              </span>
              <Input
                id={`${idPrefix}-amount`}
                inputMode="decimal"
                placeholder={t.amountPlaceholder}
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                dir="ltr"
                className="pe-8 text-base tabular-nums"
                autoComplete="transaction-amount"
              />
            </div>
            <Select value={currency} onValueChange={onCurrencySelect}>
              <SelectTrigger className="min-h-11 w-[min(100%,9.5rem)] shrink-0">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <CurrencyGlyph iconKey={currencyMeta.iconKey} className="size-3.5" />
                  <SelectValue placeholder={currencyOptionLabel(currencyMeta)} />
                </div>
              </SelectTrigger>
              <SelectContent position="popper">
                {currencyOptions.map((c) => {
                  const label = currencyOptionLabel(c);
                  return (
                    <SelectItem key={c.code} value={c.code} textValue={label}>
                      <SelectItemText>{label}</SelectItemText>
                    </SelectItem>
                  );
                })}
                {onAddCurrency ? (
                  <>
                    <SelectSeparator />
                    <SelectItem value={ADD_CURRENCY} textValue={t.addCurrency}>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <SelectItemText>{t.addCurrency}</SelectItemText>
                        <Plus className="size-3.5 shrink-0" aria-hidden />
                      </span>
                    </SelectItem>
                  </>
                ) : null}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {showDate && onDateChange ? (
        <DatePickerField
          id={`${idPrefix}-date`}
          label={t.dateLabel}
          value={date}
          onChange={onDateChange}
        />
      ) : null}

      <div className="w-full box-border space-y-2">
        <Label htmlFor={`${idPrefix}-category`}>
          {entryType === "income" ? t.incomeSource : t.category}
        </Label>
        <Select value={categoryId} onValueChange={onCategoryChange}>
          <SelectTrigger id={`${idPrefix}-category`} className="min-h-11 w-full">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {selectedCategory ? (
                <>
                  <CategoryGlyph iconKey={selectedCategory.iconKey} className="size-4" />
                  <ColorBadge color={selectedCategory.color} />
                </>
              ) : null}
              <SelectValue
                placeholder={
                  entryType === "income"
                    ? t.incomeSourcePlaceholder
                    : t.categoryPlaceholder
                }
              />
            </div>
          </SelectTrigger>
          <SelectContent position="popper">
            {categoryOptionsResolved.map((c) => (
              <SelectItem key={c.id} value={c.id} textValue={c.name}>
                <span className="flex items-center gap-2">
                  <CategoryGlyph iconKey={c.iconKey} />
                  <ColorBadge color={c.color} />
                  <SelectItemText>{c.name}</SelectItemText>
                </span>
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem
              value={ADD_CATEGORY}
              textValue={entryType === "income" ? t.addIncomeSource : t.addCategory}
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <SelectItemText>
                  {entryType === "income" ? t.addIncomeSource : t.addCategory}
                </SelectItemText>
                <Plus className="size-3.5 shrink-0" aria-hidden />
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-full box-border space-y-2">
        <Label htmlFor={`${idPrefix}-payment`}>
          {entryType === "income" ? t.destinationAccount : t.paymentMethod}
        </Label>
        <Select value={paymentMethodId} onValueChange={onMethodChange}>
          <SelectTrigger id={`${idPrefix}-payment`} className="min-h-11 w-full">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {selectedMethod ? (
                <>
                  <CategoryGlyph iconKey={selectedMethod.iconKey} className="size-4" />
                  <ColorBadge color={selectedMethod.color} />
                </>
              ) : null}
              <SelectValue
                placeholder={
                  entryType === "income"
                    ? t.destinationAccountPlaceholder
                    : t.paymentPlaceholder
                }
              />
            </div>
          </SelectTrigger>
          <SelectContent position="popper">
            {methodsResolved.map((m) => (
              <SelectItem key={m.id} value={m.id} textValue={m.name}>
                <span className="flex items-center gap-2">
                  <CategoryGlyph iconKey={m.iconKey} className="size-4" />
                  <ColorBadge color={m.color} />
                  <SelectItemText>{m.name}</SelectItemText>
                </span>
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem
              value={ADD_METHOD}
              textValue={
                entryType === "income" ? t.addDestinationAccount : t.addPaymentMethod
              }
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <SelectItemText>
                  {entryType === "income" ? t.addDestinationAccount : t.addPaymentMethod}
                </SelectItemText>
                <Plus className="size-3.5 shrink-0" aria-hidden />
              </span>
            </SelectItem>
            {(entryType === "income"
              ? onManageDestinationAccounts
              : onManagePaymentMethods) ? (
              <>
                <SelectSeparator />
                <SelectItem value={MANAGE_METHOD} textValue="manage">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <SelectItemText>
                      {entryType === "income" ? "ניהול חשבונות" : "ניהול אמצעי תשלום"}
                    </SelectItemText>
                  </span>
                </SelectItem>
              </>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      {entryType === "expense" && onInstallmentsChange ? (
        <div className="w-full box-border space-y-2">
          <Label htmlFor={`${idPrefix}-installments`}>{t.installments}</Label>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <Input
              id={`${idPrefix}-installments`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={String(installments)}
              onChange={(e) =>
                onInstallmentsChange(Math.max(1, Number(e.target.value || 1)))
              }
              dir="ltr"
              className="max-w-[8rem] tabular-nums"
            />
            {installmentPreview ? (
              <p className="pb-2 text-sm text-muted-foreground">{installmentPreview}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {onRecurringMonthlyChange ? (
        <label
          htmlFor={`${idPrefix}-recurring`}
          className="flex min-h-[3.5rem] w-full items-center justify-between gap-3 rounded-xl border border-border px-5 py-4"
        >
          <span className="text-sm">
            {entryType === "income" ? t.recurringIncome : t.recurringExpense}
          </span>
          <Switch
            id={`${idPrefix}-recurring`}
            checked={recurringMonthly}
            onCheckedChange={(v: boolean) => onRecurringMonthlyChange(Boolean(v))}
          />
        </label>
      ) : null}

      <div className="w-full box-border space-y-2">
        <Label htmlFor={`${idPrefix}-note`}>{t.note}</Label>
        <div className="relative">
          <Textarea
            id={`${idPrefix}-note`}
            placeholder={t.notePlaceholder}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            rows={4}
            onFocus={() => setNotesOpen(true)}
            onBlur={() => setNotesOpen(false)}
          />
          {showNoteDropdown ? (
            <div
              className="absolute left-0 right-0 top-full z-[100000] mt-1.5 rounded-2xl border border-muted/30 bg-popover p-2 shadow-xl animate-in fade-in-0 zoom-in-95"
              dir={dir}
            >
              <div className="max-h-56 space-y-1 overflow-auto">
                {filteredNoteSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="w-full rounded-xl px-4 py-3 text-start text-base leading-relaxed text-foreground transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onMouseDown={(e) => {
                      // Prevent textarea blur before click applies.
                      e.preventDefault();
                      onNoteChange(s);
                      setNotesOpen(false);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
