import { memo } from "react";
import { RefreshControl } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  ScrollView,
  Text,
  View as Stack,
  XStack,
  YStack,
} from "tamagui";

import type { UUID } from "@/types/api";

import { type ThemePalette } from "../admin-dashboard-theme";
import type { MetricCardViewModel } from "../hooks/use-admin-dashboard-view-model";
import { DashboardErrorBanner, MetricCard } from "./admin-dashboard-primitives";

type AdminDashboardTabProps = {
  dashboardError: string | null;
  hasShops: boolean;
  palette: ThemePalette;
  refreshing: boolean;
  onRefresh: () => void;
  bottomSpacer: number;
  selectedShopId: UUID | null;
  selectedShopName: string;
  analyticsReferenceLabel: string;
  visibleBillCount: number;
  metricCards: MetricCardViewModel[];
  useCompactMetricCards: boolean;
};

type SnapshotChipProps = {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  backgroundColor: string;
  borderColor: string;
  iconColor: string;
  textColor: string;
};

function SnapshotChip({
  label,
  value,
  icon,
  backgroundColor,
  borderColor,
  iconColor,
  textColor,
}: SnapshotChipProps) {
  return (
    <XStack
      flex={1}
      minWidth={136}
      alignItems="center"
      gap={9}
      paddingHorizontal={11}
      paddingVertical={10}
      borderRadius={14}
      borderWidth={1}
      borderColor={borderColor}
      backgroundColor={backgroundColor}
    >
      <Stack
        width={34}
        height={34}
        borderRadius={12}
        alignItems="center"
        justifyContent="center"
        backgroundColor="rgba(255,255,255,0.42)"
      >
        <MaterialCommunityIcons name={icon} size={17} color={iconColor} />
      </Stack>
      <YStack flex={1} minWidth={0} gap={2}>
        <Text
          numberOfLines={1}
          style={{ color: textColor, fontSize: 10, lineHeight: 13, fontWeight: "800", opacity: 0.72 }}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: textColor, fontSize: 13, lineHeight: 17, fontWeight: "900", flexShrink: 1 }}
        >
          {value}
        </Text>
      </YStack>
    </XStack>
  );
}

export const AdminDashboardTab = memo(function AdminDashboardTab({
  dashboardError,
  hasShops,
  palette,
  refreshing,
  onRefresh,
  bottomSpacer,
  selectedShopId,
  selectedShopName,
  analyticsReferenceLabel,
  metricCards,
  useCompactMetricCards,
}: AdminDashboardTabProps) {
  const subtitle = selectedShopId
    ? `${selectedShopName} · ${analyticsReferenceLabel}`
    : `All branches · ${analyticsReferenceLabel}`;

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: bottomSpacer }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.primary}
          colors={[palette.primary]}
        />
      }
    >
      <DashboardErrorBanner
        dashboardError={dashboardError}
        hasShops={hasShops}
        palette={palette}
        style={{ marginBottom: 12 }}
      />

      <YStack gap={14}>
        <YStack
          gap={16}
          padding={16}
          borderRadius={12}
          borderWidth={1}
          borderColor={palette.border}
          backgroundColor={palette.card}
        >
          <YStack gap={12}>
            <YStack minWidth={0} gap={4}>
              <Text style={{ color: palette.textPrimary, fontSize: 16, lineHeight: 20, fontWeight: "700" }}>
                Performance Snapshot
              </Text>
            </YStack>
          </YStack>

          <YStack gap={10}>
            <XStack
              flexDirection={useCompactMetricCards ? "column" : "row"}
              flexWrap={useCompactMetricCards ? "nowrap" : "wrap"}
              gap={12}
              alignItems="stretch"
            >
              {metricCards.map((metric) => (
                <MetricCard
                  key={metric.key}
                  label={metric.label}
                  value={metric.value}
                  formatter={metric.formatter}
                  note={metric.note}
                  icon={metric.icon}
                  accent={metric.accent}
                  accentSoft={metric.accentSoft}
                  fullWidth={useCompactMetricCards}
                  palette={palette}
                />
              ))}
            </XStack>
          </YStack>
        </YStack>
      </YStack>
    </ScrollView>
  );
});
