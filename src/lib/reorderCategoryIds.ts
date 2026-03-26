import { arrayMove } from "@dnd-kit/sortable";

/** Reorder items within the first `blockSize` ids; remainder stays appended in order. */
export function reorderFirstBlock(
  fullIds: string[],
  activeId: string,
  overId: string,
  blockSize: number,
): string[] {
  const block = fullIds.slice(0, blockSize);
  const rest = fullIds.slice(blockSize);
  const oldIndex = block.indexOf(activeId);
  const newIndex = block.indexOf(overId);
  if (oldIndex < 0 || newIndex < 0) return fullIds;
  const newBlock = arrayMove(block, oldIndex, newIndex);
  return [...newBlock, ...rest];
}
