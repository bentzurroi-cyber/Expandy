import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { CSSProperties } from "react";
import type { Category } from "@/data/mock";
import { reorderFirstBlock } from "@/lib/reorderCategoryIds";
import { cn } from "@/lib/utils";

function SortableRow({
  id,
  dragLabel,
  children,
}: {
  id: string;
  dragLabel: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
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

  const handle = (
    <button
      type="button"
      className="inline-flex shrink-0 touch-none rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      style={{ touchAction: "none" }}
      aria-label={dragLabel}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4 cursor-grab active:cursor-grabbing" aria-hidden />
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border border-border/70 bg-background px-3 py-3",
        isDragging && "shadow-md ring-1 ring-border",
      )}
    >
      {children(handle)}
    </li>
  );
}

type SortableSettingsCategoryListProps = {
  /** Full ordered category list from context */
  categories: Category[];
  /** When false, only the first N are shown and reordered within that block. */
  showAll: boolean;
  visibleCount?: number;
  onReorder: (orderedIds: string[]) => void;
  dragLabel: string;
  renderItem: (c: Category, dragHandle: React.ReactNode) => React.ReactNode;
};

export function SortableSettingsCategoryList({
  categories,
  showAll,
  visibleCount = 8,
  onReorder,
  dragLabel,
  renderItem,
}: SortableSettingsCategoryListProps) {
  const visible = showAll ? categories : categories.slice(0, visibleCount);
  const ids = visible.map((c) => c.id);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fullIds = categories.map((c) => c.id);
    const a = String(active.id);
    const o = String(over.id);
    if (!showAll) {
      onReorder(reorderFirstBlock(fullIds, a, o, visibleCount));
      return;
    }
    const oldIndex = fullIds.indexOf(a);
    const newIndex = fullIds.indexOf(o);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(fullIds, oldIndex, newIndex));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-3">
          {visible.map((c) => (
            <SortableRow key={c.id} id={c.id} dragLabel={dragLabel}>
              {(handle) => renderItem(c, handle)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
