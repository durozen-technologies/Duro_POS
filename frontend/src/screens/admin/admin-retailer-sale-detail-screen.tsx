import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchAdminRetailerSale, recordAdminRetailerPayment } from "@/api/retailers";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import type { AdminRetailerSaleDetailScreenProps } from "@/navigation/types";
import { RetailerReceiptType, type RetailerSaleRead } from "@/types/api";
import { money, toMoneyString } from "@/utils/decimal";
import { formatCurrency, formatDateTime } from "@/utils/format";

import { adminRadii } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { EmptyStateCard } from "./components/admin-dashboard-primitives";
import { useAdminTheme } from "./use-admin-theme";

export function AdminRetailerSaleDetailScreen({
  navigation,
  route,
}: AdminRetailerSaleDetailScreenProps) {
  const { saleId } = route.params;
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [sale, setSale] = useState<RetailerSaleRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [upiAmount, setUpiAmount] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSale(await fetchAdminRetailerSale(saleId));
      setError(null);
    } catch (err) {
      setError(formatApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [saleId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const collectPayment = useCallback(async () => {
    if (!sale || money(sale.balance_due).lessThanOrEqualTo(0)) return;
    const paid = money(cashAmount).plus(money(upiAmount));
    if (paid.lessThanOrEqualTo(0)) {
      Alert.alert("Payment required", "Enter cash or UPI amount.");
      return;
    }
    if (paid.greaterThan(money(sale.balance_due))) {
      Alert.alert("Too much", "Payment exceeds balance due.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await recordAdminRetailerPayment(saleId, {
        payment: {
          cash_amount: toMoneyString(cashAmount),
          upi_amount: toMoneyString(upiAmount),
        },
      });
      triggerHaptic();
      setSale(result.sale);
      setCashAmount("");
      setUpiAmount("");
    } catch (err) {
      Alert.alert("Payment failed", formatApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [cashAmount, sale, saleId, upiAmount]);

  const hasBalance = sale ? money(sale.balance_due).greaterThan(0) : false;
  const receipts = sale?.receipts ?? (sale?.receipt ? [sale.receipt] : []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["left", "right"]}>
      <StatusBar style="light" />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          backgroundColor: palette.shell,
          borderBottomColor: palette.shellBorder,
          paddingTop: Math.max(insets.top - 8, 0),
        }}
      >
        <Pressable onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 20, fontWeight: "900", color: palette.onShell }}>
          {sale?.sale_no ?? "Sale"}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator color={palette.primary} style={{ marginTop: 24 }} />
      ) : error ? (
        <EmptyStateCard
          title="Unable to load sale"
          subtitle={error}
          actionLabel="Retry"
          onAction={() => void load()}
          palette={palette}
          icon="alert-circle-outline"
        />
      ) : sale ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <View
            style={{
              borderRadius: adminRadii.card,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.card,
              padding: 16,
              gap: 8,
            }}
          >
            <Text style={{ color: palette.textPrimary, fontSize: 18, fontWeight: "800" }}>
              {sale.sale_no}
            </Text>
            <Text style={{ color: palette.textMuted }}>{formatDateTime(sale.created_at)}</Text>
            <Text style={{ color: palette.textMuted }}>
              {sale.retailer_name} · {sale.shop_name}
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
              <Text style={{ color: palette.textMuted }}>Total</Text>
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>
                {formatCurrency(sale.total_amount)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: palette.textMuted }}>Paid</Text>
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>
                {formatCurrency(sale.amount_paid_total)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: palette.textMuted }}>Balance due</Text>
              <Text
                style={{
                  color: hasBalance ? palette.warning : palette.success,
                  fontWeight: "800",
                  fontSize: 18,
                }}
              >
                {formatCurrency(sale.balance_due)}
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                alignSelf: "flex-start",
                gap: 6,
                marginTop: 4,
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 6,
                backgroundColor:
                  sale.status === "settled"
                    ? palette.successSoft
                    : sale.status === "partial" || sale.status === "open"
                      ? palette.warningSoft
                      : palette.surfaceMuted,
              }}
            >
              <MaterialCommunityIcons 
                name={sale.status === "settled" ? "check-circle" : "clock-outline"} 
                size={14} 
                color={
                  sale.status === "settled"
                    ? palette.success
                    : sale.status === "partial" || sale.status === "open"
                      ? palette.warning
                      : palette.textMuted
                } 
              />
              <Text
                style={{
                  color:
                    sale.status === "settled"
                      ? palette.success
                      : sale.status === "partial" || sale.status === "open"
                        ? palette.warning
                        : palette.textMuted,
                  fontWeight: "700",
                  fontSize: 13,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {sale.status}
              </Text>
            </View>
          </View>
          {hasBalance ? (
            <View
              style={{
                borderRadius: adminRadii.card,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
                padding: 16,
                gap: 12,
              }}
            >
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Record payment</Text>
              <View>
                <Text style={{ color: palette.textMuted, marginBottom: 6 }}>Cash</Text>
                <TextInput
                  value={cashAmount}
                  onChangeText={setCashAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={palette.textMuted}
                  style={{
                    borderWidth: 1,
                    borderColor: palette.border,
                    borderRadius: adminRadii.control,
                    padding: 10,
                    color: palette.textPrimary,
                    backgroundColor: palette.surfaceMuted,
                  }}
                />
              </View>
              <View>
                <Text style={{ color: palette.textMuted, marginBottom: 6 }}>UPI</Text>
                <TextInput
                  value={upiAmount}
                  onChangeText={setUpiAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={palette.textMuted}
                  style={{
                    borderWidth: 1,
                    borderColor: palette.border,
                    borderRadius: adminRadii.control,
                    padding: 10,
                    color: palette.textPrimary,
                    backgroundColor: palette.surfaceMuted,
                  }}
                />
              </View>
              <Pressable
                onPress={() => void collectPayment()}
                disabled={submitting}
                style={{
                  borderRadius: adminRadii.card,
                  backgroundColor: palette.primary,
                  paddingVertical: 14,
                  alignItems: "center",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? (
                  <ActivityIndicator color={palette.onPrimary} />
                ) : (
                  <Text style={{ color: palette.onPrimary, fontWeight: "700" }}>Record payment</Text>
                )}
              </Pressable>
            </View>
          ) : null}
          <View
            style={{
              borderRadius: adminRadii.card,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.card,
              padding: 16,
              gap: 10,
            }}
          >
            <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Sale items</Text>
            {sale.items.map((line) => (
              <View
                key={`${line.item_id}-${line.quantity}`}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: palette.border,
                  paddingBottom: 8,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: palette.textPrimary, fontWeight: "600" }}>
                    {line.item_name}
                  </Text>
                  <Text style={{ color: palette.textMuted, marginTop: 2 }}>
                    {line.quantity} × {formatCurrency(line.price_per_unit)}
                  </Text>
                </View>
                <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>
                  {formatCurrency(line.line_total)}
                </Text>
              </View>
            ))}
          </View>
          {sale.payments.length > 0 ? (
            <View
              style={{
                borderRadius: adminRadii.card,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
                padding: 16,
                gap: 10,
              }}
            >
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Payments</Text>
              {sale.payments.map((payment) => (
                <View key={payment.id} style={{ gap: 2 }}>
                  <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                    {formatDateTime(payment.paid_at)}
                  </Text>
                  <Text style={{ color: palette.textPrimary, fontWeight: "600" }}>
                    {formatCurrency(payment.total_paid)} (cash {formatCurrency(payment.cash_amount)}
                    , UPI {formatCurrency(payment.upi_amount)})
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {receipts.length > 0 ? (
            <View
              style={{
                borderRadius: adminRadii.card,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
                padding: 16,
                gap: 10,
              }}
            >
              <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>Receipt history</Text>
              {receipts.map((receipt) => (
                <View
                  key={receipt.id}
                  style={{
                    gap: 4,
                    borderBottomWidth: 1,
                    borderBottomColor: palette.border,
                    paddingBottom: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        backgroundColor:
                          receipt.receipt_type === RetailerReceiptType.BALANCE_PAYMENT
                            ? palette.successSoft
                            : palette.surfaceMuted,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            receipt.receipt_type === RetailerReceiptType.BALANCE_PAYMENT
                              ? palette.success
                              : palette.textMuted,
                          fontSize: 11,
                          fontWeight: "700",
                          textTransform: "uppercase",
                        }}
                      >
                        {receipt.receipt_type === RetailerReceiptType.BALANCE_PAYMENT
                          ? "Balance payment"
                          : "Sale invoice"}
                      </Text>
                    </View>
                    <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                      {formatDateTime(receipt.printed_at)}
                    </Text>
                  </View>
                  <Text style={{ color: palette.textPrimary, fontWeight: "700" }}>
                    {receipt.receipt_number}
                  </Text>
                  {receipt.payment_total ? (
                    <Text style={{ color: palette.textMuted }}>
                      {formatCurrency(receipt.payment_total)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}
