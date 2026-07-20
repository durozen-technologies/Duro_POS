import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import type { RetailerBulkSettleRead, UUID } from "@/types/api";
import { money, toMoneyString } from "@/utils/decimal";
import { formatCurrency } from "@/utils/format";
import { computeSettleableOutstanding } from "@/utils/retailer-bulk-settle";

export type RetailerBulkSettlePalette = {
  overlay: string;
  card: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  surfaceMuted: string;
  primary: string;
  onPrimary: string;
  success?: string;
};

type RetailerBulkSettleModalProps = {
  visible: boolean;
  retailerId: UUID;
  retailerName: string;
  openingBalance: string;
  billsOutstanding: string;
  palette: RetailerBulkSettlePalette;
  title?: string;
  confirmLabel?: string;
  requirePrinter?: boolean;
  onClose: () => void;
  onSettle: (payload: {
    cash_amount: string;
    upi_amount: string;
  }) => Promise<RetailerBulkSettleRead>;
  onSettled: (result: RetailerBulkSettleRead) => void | Promise<void>;
};

export const RetailerBulkSettleModal = memo(function RetailerBulkSettleModal({
  visible,
  retailerId,
  retailerName,
  openingBalance,
  billsOutstanding,
  palette,
  title = "Collect payment",
  confirmLabel = "Collect payment",
  onClose,
  onSettle,
  onSettled,
}: RetailerBulkSettleModalProps) {
  const [cashAmount, setCashAmount] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setCashAmount("");
      setUpiAmount("");
      setSaving(false);
    }
  }, [visible, retailerId]);

  const outstanding = useMemo(
    () => computeSettleableOutstanding(openingBalance, billsOutstanding),
    [billsOutstanding, openingBalance],
  );
  const paidAmount = useMemo(
    () => money(cashAmount).plus(money(upiAmount)),
    [cashAmount, upiAmount],
  );
  const remainingAfter = useMemo(
    () => money(outstanding).minus(paidAmount),
    [outstanding, paidAmount],
  );
  const canSave =
    money(outstanding).greaterThan(0) &&
    paidAmount.greaterThan(0) &&
    paidAmount.lessThanOrEqualTo(money(outstanding));

  const fillFullCash = useCallback(() => {
    setCashAmount(outstanding);
    setUpiAmount("0");
  }, [outstanding]);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      if (paidAmount.greaterThan(money(outstanding))) {
        Alert.alert("Amount too high", "Payment cannot exceed outstanding balance.");
        return;
      }
      Alert.alert("Invalid amount", "Enter cash and/or UPI up to the outstanding balance.");
      return;
    }
    setSaving(true);
    try {
      const result = await onSettle({
        cash_amount: toMoneyString(cashAmount),
        upi_amount: toMoneyString(upiAmount),
      });
      await onSettled(result);
      onClose();
    } catch (error) {
      Alert.alert("Collect failed", formatApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [canSave, cashAmount, onClose, onSettle, onSettled, outstanding, paidAmount, upiAmount]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
            <Pressable accessibilityRole="button" hitSlop={12} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color={palette.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.retailerName, { color: palette.textPrimary }]} numberOfLines={2}>
              {retailerName}
            </Text>
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              FIFO apply: opening balance first, then oldest pending bills. Partial last bill OK.
            </Text>

            <View style={[styles.summary, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
              <View style={styles.summaryRow}>
                <Text style={{ color: palette.textMuted }}>Opening balance</Text>
                <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>
                  {formatCurrency(openingBalance)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={{ color: palette.textMuted }}>Pending bills</Text>
                <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>
                  {formatCurrency(billsOutstanding)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={{ color: palette.textPrimary, fontWeight: "800" }}>Outstanding</Text>
                <Text style={{ color: palette.textPrimary, fontWeight: "800", fontSize: 18 }}>
                  {formatCurrency(outstanding)}
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={fillFullCash}
              disabled={money(outstanding).lte(0)}
              style={[
                styles.payFull,
                {
                  borderColor: palette.border,
                  backgroundColor: palette.surfaceMuted,
                  opacity: money(outstanding).lte(0) ? 0.5 : 1,
                },
              ]}
            >
              <Text style={{ color: palette.primary, fontWeight: "700" }}>Pay full in cash</Text>
            </Pressable>

            <Text style={[styles.label, { color: palette.textMuted }]}>CASH</Text>
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
                  backgroundColor: palette.surfaceMuted,
                },
              ]}
            />

            <Text style={[styles.label, { color: palette.textMuted }]}>UPI</Text>
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
                  backgroundColor: palette.surfaceMuted,
                },
              ]}
            />

            <View style={styles.summaryRow}>
              <Text style={{ color: palette.textMuted }}>Paying now</Text>
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>
                {formatCurrency(paidAmount.toFixed(2))}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={{ color: palette.textMuted }}>Remaining after</Text>
              <Text
                style={{
                  color: remainingAfter.lessThan(0) ? "#B42318" : palette.textPrimary,
                  fontWeight: "700",
                }}
              >
                {formatCurrency(remainingAfter.toFixed(2))}
              </Text>
            </View>
          </ScrollView>

          <View style={[styles.actions, { borderTopColor: palette.border }]}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              disabled={saving}
              style={[styles.secondaryBtn, { borderColor: palette.border }]}
            >
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleSave()}
              disabled={!canSave || saving}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: palette.primary,
                  opacity: !canSave || saving ? 0.55 : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={palette.onPrimary} />
              ) : (
                <Text style={{ color: palette.onPrimary, fontWeight: "800" }}>{confirmLabel}</Text>
              )}
            </Pressable>
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
    padding: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: "88%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
  },
  scroll: {
    maxHeight: 420,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  retailerName: {
    fontSize: 16,
    fontWeight: "700",
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
  },
  summary: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  payFull: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryBtn: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 140,
    alignItems: "center",
  },
});
