import { AssetsView } from "@/components/assets/AssetsView";

export function Assets({ isActive }: { isActive?: boolean }) {
  return <AssetsView isActive={isActive ?? true} />;
}
