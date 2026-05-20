import { memo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { adminShadow, type ThemePalette } from "../admin-dashboard-theme";
import type { MetricCardViewModel } from "../hooks/use-admin-dashboard-view-model";
import { DashboardErrorBanner, MetricCard } from "./admin-dashboard-primitives";

type AdminDashboardTabProps = {
  dashboardError: string | null;
  hasShops: boolean;
  palette: ThemePalette;
  refreshing: boolean;
  onRefresh: () => void;
  bottomSpacer: number;
  selectedShopId: number | null;
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
  selectedShopId,
  selectedShopName,
  analyticsReferenceLabel,
  visibleBillCount,
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
          tintColor={palette.emerald}
          colors={[palette.emerald]}
        />
      }
    >
      <DashboardErrorBanner dashboardError={dashboardError} hasShops={hasShops} palette={palette} style={styles.bannerSpacing} />

      <View style={styles.content}>
        <View
          style={[
            styles.sectionCard,
            adminShadow(palette.shadow, 0.05, 8, 16),
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <View style={[styles.sectionHeader, { paddingHorizontal: 0, paddingTop: 0 }]}>
            <View style={styles.sectionHeaderText}>
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Performance Snapshot</Text>
              <Text style={[styles.sectionSubtitle, { color: palette.textMuted }]}>{subtitle}</Text>
            </View>
            <View style={styles.sectionBadge}>
              <Text
                style={[
                  styles.sectionBadgeText,
                  { color: palette.emeraldDark, backgroundColor: palette.emeraldSoft },
                ]}
              >
                {visibleBillCount} bills
              </Text>
            </View>
          </View>

          <View style={styles.sectionBody}>
            <View style={[styles.metricGrid, useCompactMetricCards && styles.metricGridCompact]}>
              {metricCards.map((metric) => (
                <MetricCard
                  key={metric.key}
                  label={metric.label}
                  value={metric.value}
                  formatter={metric.formatter}
                  note={metric.note}
                  noteIcon={metric.noteIcon}
                  icon={metric.icon}
                  accent={metric.accent}
                  accentSoft={metric.accentSoft}
                  sparklineLabel={metric.sparklineLabel}
                  sparklineValues={metric.sparklineValues}
                  fullWidth={useCompactMetricCards}
                  palette={palette}
                />
              ))}
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  bannerSpacing: {
    marginBottom: 12,
  },
  content: {
    gap: 14,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  sectionHeaderText: {
    flex: 1,
    gap: 3,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
  },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  sectionBadge: {
    justifyContent: "center",
  },
  sectionBadgeText: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "600",
  },
  sectionBody: {
    marginTop: 12,
    gap: 10,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "stretch",
  },
  metricGridCompact: {
    flexDirection: "column",
    flexWrap: "nowrap",
  },
});
