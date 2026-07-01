import { BootLoader } from "@/components/boot-loader";
import {
  SkeletonDashboard,
  SkeletonList,
  SkeletonLoadingCaption,
  SkeletonProductGrid,
  type SkeletonTone,
} from "@/components/ui/skeleton";
import { appTheme } from "@/constants/theme";
import { View } from "react-native";

type LoadingLayout = "list" | "grid" | "dashboard" | "minimal";

type LoadingStateProps = {
  label?: string;
  fullscreen?: boolean;
  layout?: LoadingLayout;
  tone?: SkeletonTone;
};

export function LoadingState({
  label = "Loading...",
  fullscreen = false,
  layout = "list",
  tone,
}: LoadingStateProps) {
  const shellTone: SkeletonTone = tone ?? {
    base: appTheme.card,
    highlight: appTheme.surface,
    border: appTheme.border,
  };

  const skeleton =
    layout === "grid" ? (
      <SkeletonProductGrid tone={shellTone} label={label} />
    ) : layout === "dashboard" ? (
      <SkeletonDashboard tone={shellTone} label={label} />
    ) : layout === "minimal" ? null : (
      <SkeletonList tone={shellTone} label={label} />
    );

  return (
    <View className={fullscreen ? "flex-1 bg-background" : "bg-background py-6"}>
      {skeleton}
      {layout === "minimal" ? null : <SkeletonLoadingCaption label={label} />}
    </View>
  );
}

export function SessionHydrationScreen() {
  return <BootLoader label="Restoring secure session..." />;
}
