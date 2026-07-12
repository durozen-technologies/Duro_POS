import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { editAdminBill } from "@/api/admin";
import { formatApiErrorMessage, toApiError } from "@/api/client";
import { BaseUnit, type BillLineRead, type BillRead } from "@/types/api";
import { money, toMoneyString } from "@/utils/decimal";
import { formatCurrency, formatUnit } from "@/utils/format";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { PrimaryButton } from "./admin-dashboard-primitives";

type QuantityState = Record<string, string>;

type AdminShopBillEditModalProps = {
  visible: boolean;
  bill: BillRead | null;
  palette: ThemePalette;
  onClose: () => void;
  onSaved: (bill: BillRead) => void;
  onConflict: () => void;
};

function lineTotal(line: BillLineRead, quantity: string) {
  return money(line.price_per_unit).times(money(quantity || 0));
}

function buildQuantityState(bill: BillRead | null): QuantityState {
  if (!bill) {
    return {};
  }
  return Object.fromEntries(
    bill.items.map((line) => [
      line.item_id,
      line.item_base_unit === BaseUnit.UNIT
        ? money(line.quantity).toFixed(0)
        : money(line.quantity).toString(),
    ]),
  );
}

function initialPaymentSplit(bill: BillRead | null) {
  return {
    cashAmount: bill?.payment.cash_amount ?? "",
    upiAmount: bill?.payment.upi_amount ?? "",
  };
}

export const AdminShopBillEditModal = memo(function AdminShopBillEditModal({
  visible,
  bill,
  palette,
  onClose,
  onSaved,
  onConflict,
}: AdminShopBillEditModalProps) {
  const [quantities, setQuantities] = useState<QuantityState>({});
  const [cashAmount, setCashAmount] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && bill) {
      setQuantities(buildQuantityState(bill));
      const payment = initialPaymentSplit(bill);
      setCashAmount(payment.cashAmount);
      setUpiAmount(payment.upiAmount);
      setSaving(false);
      setSaveError(null);
    }
  }, [bill, visible]);

  const totalAmount = useMemo(() => {
    if (!bill) {
      return money(0);
    }
    return bill.items.reduce(
      (sum, line) => sum.plus(lineTotal(line, quantities[line.item_id] ?? "0")),
      money(0),
    );
  }, [bill, quantities]);

  const paidAmount = useMemo(
    () => money(cashAmount).plus(money(upiAmount)),
    [cashAmount, upiAmount],
  );

  const paymentMismatchMessage = useMemo(() => {
    if (totalAmount.isZero()) {
      return "Bill total must be greater than zero.";
    }
    if (paidAmount.lessThan(totalAmount)) {
      return `Payment pending. Balance: ${formatCurrency(totalAmount.minus(paidAmount).toString())}`;
    }
    if (paidAmount.greaterThan(totalAmount)) {
      return "Payment exceeds total amount. Receipt remains blocked until corrected";
    }
    return null;
  }, [paidAmount, totalAmount]);

  const canSave = totalAmount.greaterThan(0) && paidAmount.equals(totalAmount);

  const handleSave = useCallback(async () => {
    if (!bill) {
      return;
    }
    if (!canSave) {
      setSaveError(paymentMismatchMessage ?? "Payment must equal bill total.");
      return;
    }

    triggerHaptic();
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await editAdminBill(bill.id, {
        items: bill.items.map((line) => ({
          item_id: line.item_id,
          quantity:
            line.item_base_unit === BaseUnit.UNIT
              ? money(quantities[line.item_id] ?? "0").toFixed(0)
              : money(quantities[line.item_id] ?? "0").toString(),
        })),
        payment: {
          cash_amount: toMoneyString(cashAmount),
          upi_amount: toMoneyString(upiAmount),
        },
      });
      onSaved(updated);
      onClose();
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.status === 409) {
        onConflict();
        onClose();
        return;
      }
      setSaveError(formatApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [
    bill,
    canSave,
    cashAmount,
    onClose,
    onConflict,
    onSaved,
    paymentMismatchMessage,
    quantities,
    upiAmount,
  ]);

  if (!bill) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.header}>
            <Text style={[adminTypography.section, { color: palette.textPrimary }]}>Edit bill</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close edit bill" hitSlop={12} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color={palette.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[adminTypography.caption, { color: palette.textMuted }]}>
              Update quantities. Bill total uses the original rate for each item.
            </Text>

            {bill.items.map((line) => (
              <View
                key={line.item_id}
                style={[styles.itemCard, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}
              >
                <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary }]}>
                  {line.item_name}
                </Text>
                <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 4 }]}>
                  Rate: {formatCurrency(line.price_per_unit)} / {formatUnit(line.unit)}
                </Text>
                <TextInput
                  value={quantities[line.item_id] ?? ""}
                  onChangeText={(value) => {
                    setSaveError(null);
                    setQuantities((current) => ({ ...current, [line.item_id]: value }));
                  }}
                  keyboardType={line.item_base_unit === BaseUnit.UNIT ? "number-pad" : "decimal-pad"}
                  placeholder={`Quantity (${formatUnit(line.unit)})`}
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
                <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 6 }]}>
                  Line total: {formatCurrency(lineTotal(line, quantities[line.item_id] ?? "0").toString())}
                </Text>
              </View>
            ))}

            <View style={[styles.totalCard, { borderColor: palette.border }]}>
              <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary }]}>Bill total</Text>
              <Text style={[adminTypography.section, { color: palette.primary, marginTop: 4 }]}>
                {formatCurrency(totalAmount.toString())}
              </Text>
            </View>

            <Text style={[adminTypography.caption, styles.sectionLabel, { color: palette.textMuted }]}>
              Payment split
            </Text>
            <Text style={[adminTypography.caption, { color: palette.textMuted, marginBottom: 8 }]}>
              Cash and UPI must equal the bill total.
            </Text>
            <Text style={[adminTypography.caption, { color: palette.textMuted }]}>Cash</Text>
            <TextInput
              value={cashAmount}
              onChangeText={(value) => {
                setSaveError(null);
                setCashAmount(value);
              }}
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
            <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 8 }]}>UPI</Text>
            <TextInput
              value={upiAmount}
              onChangeText={(value) => {
                setSaveError(null);
                setUpiAmount(value);
              }}
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
                ? "Payment matches bill total"
                : paymentMismatchMessage ?? "Enter cash and UPI to match the bill total"}
            </Text>
            {saveError ? (
              <Text style={[adminTypography.caption, { color: palette.danger, fontWeight: "700" }]}>
                {saveError}
              </Text>
            ) : null}
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
              label="Save changes"
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
  sectionLabel: {
    fontWeight: "700",
    marginTop: adminSpacing.xs,
  },
  itemCard: {
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
  totalCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: adminRadii.control,
    padding: adminSpacing.sm,
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
