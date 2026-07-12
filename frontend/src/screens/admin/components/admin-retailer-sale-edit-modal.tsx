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

import { editAdminRetailerSale, fetchRetailerBalance } from "@/api/retailers";
import { formatApiErrorMessage } from "@/api/client";
import { BaseUnit, type RetailerSaleLineRead, type RetailerSaleRead } from "@/types/api";
import { money, toMoneyString } from "@/utils/decimal";
import { formatCurrency, formatUnit } from "@/utils/format";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { PrimaryButton } from "./admin-dashboard-primitives";

type QuantityState = Record<string, string>;

type AdminRetailerSaleEditModalProps = {
  visible: boolean;
  sale: RetailerSaleRead | null;
  palette: ThemePalette;
  onClose: () => void;
  onSaved: (sale: RetailerSaleRead) => void;
};

function lineTotal(line: RetailerSaleLineRead, quantity: string) {
  return money(line.price_per_unit).times(money(quantity || 0));
}

function buildQuantityState(sale: RetailerSaleRead | null): QuantityState {
  if (!sale) {
    return {};
  }
  return Object.fromEntries(
    sale.items.map((line) => [
      line.item_id,
      line.item_base_unit === BaseUnit.UNIT
        ? money(line.quantity).toFixed(0)
        : money(line.quantity).toString(),
    ]),
  );
}

function initialPaymentSplit(sale: RetailerSaleRead | null) {
  const invoicePaymentId = sale?.receipts?.find(
    (receipt) => receipt.receipt_type === "sale_invoice",
  )?.retailer_payment_id;
  const invoicePayment = sale?.payments.find((payment) => payment.id === invoicePaymentId);
  const anchor = invoicePayment ?? sale?.payments[0];
  return {
    cashAmount: anchor?.cash_amount ?? "",
    upiAmount: anchor?.upi_amount ?? "",
    walletAmount: anchor?.wallet_amount ?? "",
  };
}

export const AdminRetailerSaleEditModal = memo(function AdminRetailerSaleEditModal({
  visible,
  sale,
  palette,
  onClose,
  onSaved,
}: AdminRetailerSaleEditModalProps) {
  const [quantities, setQuantities] = useState<QuantityState>({});
  const [cashAmount, setCashAmount] = useState("");
  const [upiAmount, setUpiAmount] = useState("");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && sale) {
      setQuantities(buildQuantityState(sale));
      const payment = initialPaymentSplit(sale);
      setCashAmount(payment.cashAmount);
      setUpiAmount(payment.upiAmount);
      setWalletAmount(payment.walletAmount);
      setSaving(false);
      void fetchRetailerBalance(sale.retailer_id)
        .then((balance) => setWalletBalance(balance.credit_balance ?? "0"))
        .catch(() => setWalletBalance(null));
    }
  }, [sale, visible]);

  const totalAmount = useMemo(() => {
    if (!sale) {
      return money(0);
    }
    return sale.items.reduce(
      (sum, line) => sum.plus(lineTotal(line, quantities[line.item_id] ?? "0")),
      money(0),
    );
  }, [quantities, sale]);

  const paidAmount = useMemo(
    () => money(cashAmount).plus(money(upiAmount)).plus(money(walletAmount)),
    [cashAmount, upiAmount, walletAmount],
  );
  const balanceDue = useMemo(() => totalAmount.minus(paidAmount), [paidAmount, totalAmount]);
  const walletWithinBalance =
    walletBalance === null || money(walletAmount).lessThanOrEqualTo(money(walletBalance));
  const canSave =
    totalAmount.greaterThan(0) &&
    paidAmount.greaterThan(0) &&
    paidAmount.lessThanOrEqualTo(totalAmount) &&
    walletWithinBalance;

  const handleSave = useCallback(async () => {
    if (!sale) {
      return;
    }
    if (!canSave) {
      if (!walletWithinBalance) {
        Alert.alert("Wallet limit", "Wallet amount exceeds available credit.");
        return;
      }
      Alert.alert("Invalid payment", "Enter cash, UPI, or wallet up to the bill total.");
      return;
    }

    triggerHaptic();
    setSaving(true);
    try {
      const updated = await editAdminRetailerSale(sale.id, {
        items: sale.items.map((line) => ({
          item_id: line.item_id,
          quantity:
            line.item_base_unit === BaseUnit.UNIT
              ? money(quantities[line.item_id] ?? "0").toFixed(0)
              : money(quantities[line.item_id] ?? "0").toString(),
        })),
        payment: {
          cash_amount: toMoneyString(cashAmount),
          upi_amount: toMoneyString(upiAmount),
          wallet_amount: toMoneyString(walletAmount),
        },
      });
      onSaved(updated);
      onClose();
    } catch (error) {
      Alert.alert("Edit failed", formatApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    cashAmount,
    onClose,
    onSaved,
    quantities,
    sale,
    upiAmount,
    walletAmount,
    walletWithinBalance,
  ]);

  if (!sale) {
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

            {sale.items.map((line) => (
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
                  onChangeText={(value) =>
                    setQuantities((current) => ({ ...current, [line.item_id]: value }))
                  }
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
              Enter cash, UPI, and/or wallet. Partial payment is allowed.
            </Text>
            {walletBalance !== null ? (
              <Text style={[adminTypography.caption, { color: palette.textMuted, marginBottom: 8 }]}>
                Wallet credit available: {formatCurrency(walletBalance)}
              </Text>
            ) : null}
            <Text style={[adminTypography.caption, { color: palette.textMuted }]}>Cash</Text>
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
            <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 8 }]}>UPI</Text>
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
            <Text style={[adminTypography.caption, { color: palette.textMuted, marginTop: 8 }]}>Wallet</Text>
            <TextInput
              value={walletAmount}
              onChangeText={setWalletAmount}
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
                ? balanceDue.isZero()
                  ? "Fully paid"
                  : `Balance due: ${formatCurrency(balanceDue.toString())}`
                : paidAmount.greaterThan(totalAmount)
                  ? `Payment exceeds bill total by ${formatCurrency(paidAmount.minus(totalAmount).toString())}`
                  : !walletWithinBalance
                    ? "Wallet amount exceeds available credit"
                    : "Enter at least some payment"}
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
