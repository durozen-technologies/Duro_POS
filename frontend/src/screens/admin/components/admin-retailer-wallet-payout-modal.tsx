import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { formatApiErrorMessage } from "@/api/client";
import { recordRetailerWalletPayout } from "@/api/retailers";
import type { RetailerRead } from "@/types/api";
import { money, toMoneyString } from "@/utils/decimal";
import { formatCurrency } from "@/utils/format";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { PrimaryButton } from "./admin-dashboard-primitives";

type AdminRetailerWalletPayoutModalProps = {
  visible: boolean;
  retailer: RetailerRead;
  creditBalance: string;
  palette: ThemePalette;
  onClose: () => void;
  onSaved: (creditBalanceAfter: string) => void;
};

export const AdminRetailerWalletPayoutModal = memo(function AdminRetailerWalletPayoutModal({
  visible,
  retailer,
  creditBalance,
  palette,
  onClose,
  onSaved,
}: AdminRetailerWalletPayoutModalProps) {
  const [cashAmount, setCashAmount] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setCashAmount("");
      setUpiAmount("");
      setNotes("");
      setSaving(false);
    }
  }, [visible]);

  const availableCredit = useMemo(() => money(creditBalance), [creditBalance]);
  const paidAmount = useMemo(
    () => money(cashAmount).plus(money(upiAmount)),
    [cashAmount, upiAmount],
  );
  const remainingCredit = useMemo(
    () => availableCredit.minus(paidAmount),
    [availableCredit, paidAmount],
  );
  const canSave =
    availableCredit.greaterThan(0) &&
    paidAmount.greaterThan(0) &&
    paidAmount.lessThanOrEqualTo(availableCredit);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      if (paidAmount.greaterThan(availableCredit)) {
        Alert.alert("Amount too high", "Payout cannot exceed wallet credit.");
        return;
      }
      Alert.alert("Invalid amount", "Enter cash or UPI amount up to wallet credit.");
      return;
    }

    triggerHaptic();
    setSaving(true);
    try {
      const result = await recordRetailerWalletPayout(retailer.id, {
        cash_amount: toMoneyString(cashAmount),
        upi_amount: toMoneyString(upiAmount),
        notes: notes.trim() || null,
      });
      onSaved(result.credit_balance_after);
      onClose();
    } catch (error) {
      Alert.alert("Payout failed", formatApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [availableCredit, canSave, cashAmount, notes, onClose, onSaved, paidAmount, retailer.id, upiAmount]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.header}>
            <Text style={[adminTypography.section, { color: palette.textPrimary }]}>
              Pay out wallet credit
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close wallet payout"
              hitSlop={12}
              onPress={onClose}
            >
              <MaterialCommunityIcons name="close" size={22} color={palette.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[adminTypography.caption, { color: palette.textMuted }]}>
              Record cash or UPI given to {retailer.name} to clear wallet credit. Partial payout is
              allowed.
            </Text>

            <View style={[styles.summaryCard, { borderColor: palette.border }]}>
              <Text style={[adminTypography.caption, { color: palette.textMuted }]}>
                WALLET CREDIT
              </Text>
              <Text style={[adminTypography.section, { color: palette.primary, marginTop: 4 }]}>
                {formatCurrency(creditBalance)}
              </Text>
            </View>

            <Text style={[adminTypography.caption, { color: palette.textMuted }]}>Cash given</Text>
            <TextInput
              value={cashAmount}
              onChangeText={setCashAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={palette.textMuted}
              style={[
                styles.input,
                {
                  borderColor: palette.border,
                  color: palette.textPrimary,
                  backgroundColor: palette.background,
                },
              ]}
            />
            <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 8 }]}>
              UPI given
            </Text>
            <TextInput
              value={upiAmount}
              onChangeText={setUpiAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={palette.textMuted}
              style={[
                styles.input,
                {
                  borderColor: palette.border,
                  color: palette.textPrimary,
                  backgroundColor: palette.background,
                },
              ]}
            />
            <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 8 }]}>
              Notes (optional)
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Reference or remark"
              placeholderTextColor={palette.textMuted}
              style={[
                styles.input,
                {
                  borderColor: palette.border,
                  color: palette.textPrimary,
                  backgroundColor: palette.background,
                },
              ]}
            />
            <Text
              style={[
                adminTypography.caption,
                {
                  marginTop: 8,
                  color: canSave ? palette.success : palette.warning,
                  fontWeight: "700",
                },
              ]}
            >
              {canSave
                ? remainingCredit.isZero()
                  ? "Wallet credit will be fully cleared"
                  : `Remaining credit after payout: ${formatCurrency(remainingCredit.toString())}`
                : paidAmount.greaterThan(availableCredit)
                  ? `Payout exceeds credit by ${formatCurrency(paidAmount.minus(availableCredit).toString())}`
                  : availableCredit.isZero()
                    ? "No wallet credit to pay out"
                    : "Enter at least some cash or UPI amount"}
            </Text>
          </ScrollView>

          <View style={[styles.actions, { borderTopColor: palette.border }]}>
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              palette={palette}
              onPress={onClose}
              disabled={saving}
            />
            <PrimaryButton
              label="Record payout"
              palette={palette}
              loading={saving}
              disabled={saving || !canSave}
              onPress={() => void handleSave()}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    padding: adminSpacing.md,
  },
  card: {
    borderRadius: adminRadii.card,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: "90%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: adminSpacing.md,
    paddingTop: adminSpacing.md,
    paddingBottom: adminSpacing.sm,
  },
  scroll: {
    maxHeight: 520,
  },
  scrollContent: {
    paddingHorizontal: adminSpacing.md,
    paddingBottom: adminSpacing.sm,
    gap: adminSpacing.sm,
  },
  summaryCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: adminRadii.control,
    padding: adminSpacing.sm,
  },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: adminSpacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: adminSpacing.md,
    paddingVertical: adminSpacing.sm,
  },
});
