import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AdminBillSummary } from "@/types/api";
import { canAdminModifyShopBill } from "@/utils/shop-bill";

import { adminRadii, adminSpacing, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";

type AdminShopBillActionRowProps = {
  bill: AdminBillSummary;
  palette: ThemePalette;
  onEdit: () => void;
  onCancel: () => void;
};

export const AdminShopBillActionRow = memo(function AdminShopBillActionRow({
  bill,
  palette,
  onEdit,
  onCancel,
}: AdminShopBillActionRowProps) {
  if (!canAdminModifyShopBill(bill)) {
    return null;
  }

  return (
    <View style={[styles.row, { borderTopColor: palette.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit bill ${bill.bill_no}`}
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
        accessibilityLabel={`Cancel bill ${bill.bill_no}`}
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
