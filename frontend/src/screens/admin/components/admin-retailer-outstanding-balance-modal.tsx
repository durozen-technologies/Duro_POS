import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { formatApiErrorMessage } from "@/api/client";
import { updateRetailerOutstandingBalance } from "@/api/retailers";
import type { RetailerRead } from "@/types/api";
import { money, toMoneyString } from "@/utils/decimal";
import { formatCurrency } from "@/utils/format";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { PrimaryButton } from "./admin-dashboard-primitives";

type AdminRetailerOutstandingBalanceModalProps = {
  visible: boolean;
  retailer: RetailerRead;
  outstandingBalance: string;
  palette: ThemePalette;
  onClose: () => void;
  onSaved: (balance: { outstanding_balance: string; opening_balance?: string }) => void;
};

export const AdminRetailerOutstandingBalanceModal = memo(
  function AdminRetailerOutstandingBalanceModal({
    visible,
    retailer,
    outstandingBalance,
    palette,
    onClose,
    onSaved,
  }: AdminRetailerOutstandingBalanceModalProps) {
    const [amount, setAmount] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (visible) {
        setAmount(toMoneyString(outstandingBalance));
        setSaving(false);
      }
    }, [outstandingBalance, visible]);

    const canSave = money(amount).greaterThanOrEqualTo(0);

    const handleSave = useCallback(async () => {
      if (!canSave) {
        Alert.alert("Invalid amount", "Enter a valid outstanding balance.");
        return;
      }

      triggerHaptic();
      setSaving(true);
      try {
        const updated = await updateRetailerOutstandingBalance(retailer.id, {
          outstanding_balance: toMoneyString(amount),
        });
        onSaved({
          outstanding_balance: updated.outstanding_balance,
          opening_balance: updated.opening_balance,
        });
        onClose();
      } catch (error) {
        Alert.alert("Update failed", formatApiErrorMessage(error));
      } finally {
        setSaving(false);
      }
    }, [amount, canSave, onClose, onSaved, retailer.id]);

    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: palette.card, borderColor: palette.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.header}>
              <Text style={[styles.title, { color: palette.textPrimary }]}>Edit outstanding balance</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <MaterialCommunityIcons name="close" size={20} color={palette.textMuted} />
              </Pressable>
            </View>
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              {retailer.name}
            </Text>
            <Text style={[styles.label, { color: palette.textMuted }]}>OUTSTANDING BALANCE</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={palette.textMuted}
              selectionColor={palette.primary}
              cursorColor={palette.primary}
              style={[
                styles.input,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.border,
                  color: palette.textPrimary,
                },
              ]}
            />
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              Current: {formatCurrency(outstandingBalance)}
            </Text>
            <PrimaryButton
              label="Save balance"
              palette={palette}
              loading={saving}
              disabled={!canSave || saving}
              onPress={() => void handleSave()}
            />
          </Pressable>
        </Pressable>
      </Modal>
    );
  },
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: adminSpacing.lg,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    borderRadius: adminRadii.card,
    borderWidth: 1,
    padding: adminSpacing.lg,
    gap: adminSpacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    ...adminTypography.sectionTitle,
    fontSize: 18,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  label: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 20,
    fontWeight: "800",
  },
  hint: {
    fontSize: 13,
    fontWeight: "600",
  },
});
