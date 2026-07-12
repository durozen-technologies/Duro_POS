import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { RetailerSaleRead } from "@/types/api";
import { canAdminModifyRetailerSale } from "@/utils/retailer-sale";

import { adminRadii, adminSpacing, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";

type AdminRetailerSaleActionRowProps = {
  sale: RetailerSaleRead;
  palette: ThemePalette;
  onEdit: () => void;
  onCancel: () => void;
};

export const AdminRetailerSaleActionRow = memo(function AdminRetailerSaleActionRow({
  sale,
  palette,
  onEdit,
  onCancel,
}: AdminRetailerSaleActionRowProps) {
  if (!canAdminModifyRetailerSale(sale)) {
    return null;
  }

  return (
    <View style={[styles.row, { borderTopColor: palette.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit bill ${sale.sale_no}`}
        onPress={() => {
          triggerHaptic();
          onEdit();
        }}
        style={({ pressed }) => [
          styles.button,
          {
            borderColor: palette.border,
            backgroundColor: pressed ? palette.surfaceMuted : palette.background,
          },
        ]}
      >
        <MaterialCommunityIcons name="pencil-outline" size={18} color={palette.primary} />
        <Text style={{ color: palette.primary, fontWeight: "700", fontSize: 13 }}>Edit</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Cancel bill ${sale.sale_no}`}
        onPress={() => {
          triggerHaptic();
          onCancel();
        }}
        style={({ pressed }) => [
          styles.button,
          {
            borderColor: palette.danger,
            backgroundColor: pressed ? palette.dangerSoft : palette.background,
          },
        ]}
      >
        <MaterialCommunityIcons name="close-circle-outline" size={18} color={palette.danger} />
        <Text style={{ color: palette.danger, fontWeight: "700", fontSize: 13 }}>Cancel</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: adminSpacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: adminSpacing.md,
    paddingVertical: 12,
  },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingVertical: 10,
  },
});
