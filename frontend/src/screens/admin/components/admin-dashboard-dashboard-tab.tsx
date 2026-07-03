import { memo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

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

export const AdminDashboardTab = memo(function AdminDashboardTab({
  dashboardError,
  hasShops,
  palette,
  refreshing,
  onRefresh,
  bottomSpacer,
  metricCards,
  useCompactMetricCards,
}: AdminDashboardTabProps) {
  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomSpacer }]}
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
        style={styles.errorBanner}
      />

      <View
        style={[
          styles.card,
          { borderColor: palette.border, backgroundColor: palette.card },
        ]}
      >
        <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>
          Performance Snapshot
        </Text>

        <View
          style={[
            styles.metricGrid,
            useCompactMetricCards ? styles.metricGridCompact : styles.metricGridWide,
          ]}
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
        </View>
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  errorBanner: {
    marginBottom: 12,
  },
  card: {
    gap: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700",
  },
  metricGrid: {
    gap: 12,
  },
  metricGridCompact: {
    flexDirection: "column",
  },
  metricGridWide: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
  },
});
