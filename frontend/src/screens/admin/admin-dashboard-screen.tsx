import { zodResolver } from "@hookform/resolvers/zod";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useReceiptImagePrintJob } from "@/hooks/use-receipt-image-print-job";
import { useAuthStore } from "@/store/auth-store";
import { useAdminThemeStore } from "@/store/admin-theme-store";
import { useCartStore } from "@/store/cart-store";
import { usePrinterStore } from "@/store/printer-store";
import { usePriceStore } from "@/store/price-store";
import type { AnalyticsPeriod, BillRead, ShopRead, UUID } from "@/types/api";
import { isPositiveNumber, toMoneyString } from "@/utils/decimal";

import { adminShadow, getAdminPalette } from "./admin-dashboard-theme";
import {
  AdminBillingTab,
} from "./components/admin-dashboard-billing-tab";
import {
  AdminDashboardTab,
} from "./components/admin-dashboard-dashboard-tab";
import {
  AdminInventoryTab,
} from "./components/admin-dashboard-inventory-tab";
import {
  BottomNav,
  DashboardSkeleton,
  EmptyStateCard,
  ToastBanner,
  TopAppBar,
} from "./components/admin-dashboard-primitives";
import {
  BillPreviewSheet,
  PriceUpdateSheet,
  ShopEditorSheet,
} from "./components/admin-dashboard-sheets";
import {
  AdminSettingsTab,
} from "./components/admin-dashboard-settings-tab";
import {
  useAdminDashboardAnalytics,
  useAdminPriceEditorModel,
} from "./hooks/use-admin-dashboard-view-model";
import { useAdminDashboardData } from "./hooks/use-admin-dashboard-data";
import {
  buildDateOptions,
  buildMonthOptions,
  buildWeekOptions,
  buildYearOptions,
  NAV_ITEMS,
  triggerHaptic,
  type AdminNavTab,
  type ToastTone,
} from "./admin-dashboard-utils";

const createShopSchema = z.object({
  name: z.string().min(2, "Shop name is required"),
  username: z.string().min(3, "Login username is required").max(50, "Username is too long"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password is too long"),
});

const editShopSchema = z.object({
  name: z.string().min(2, "Shop name is required"),
  username: z.string().min(3, "Login username is required").max(50, "Username is too long"),
  password: z
    .string()
    .max(128, "Password is too long")
    .refine((value) => value.trim() === "" || value.trim().length >= 8, "Password must be at least 8 characters"),
});

type CreateShopFormValues = z.infer<typeof createShopSchema>;
type EditShopFormValues = z.infer<typeof editShopSchema>;

const PERIOD_OPTIONS: { key: AnalyticsPeriod; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "year", label: "Year" },
];

const PRINT_ALL_CHUNK_SIZE = 8;

function isNewArchitectureEnabled() {
  return Boolean((globalThis as typeof globalThis & { nativeFabricUIManager?: unknown }).nativeFabricUIManager);
}

export function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const systemColorScheme = useColorScheme();
  const { width: windowWidth } = useWindowDimensions();
  const themePreference = useAdminThemeStore((state) => state.themePreference);
  const setThemePreference = useAdminThemeStore((state) => state.setThemePreference);
  const colorScheme = themePreference === "system" ? systemColorScheme ?? "light" : themePreference;
  const palette = useMemo(() => getAdminPalette(colorScheme), [colorScheme]);
  const bottomNavItems = useMemo(() => NAV_ITEMS.map((item) => ({ ...item, icon: item.icon as never })), []);
  const dateOptions = useMemo(() => buildDateOptions(), []);
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const weekOptions = useMemo(() => buildWeekOptions(), []);
  const yearOptions = useMemo(() => buildYearOptions(), []);
  const clearSession = useAuthStore((state) => state.clearSession);
  const resetCart = useCartStore((state) => state.resetCart);
  const clearPrices = usePriceStore((state) => state.clear);
  const preferredPrinter = usePrinterStore((state) => state.preferredPrinter);
  const { receiptImagePrintBridge, startReceiptImagePrintJob } = useReceiptImagePrintJob();

  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>("date");
  const [analyticsReferenceDate, setAnalyticsReferenceDate] = useState(
    dateOptions[0]?.value ?? new Date().toISOString().slice(0, 10),
  );
  const [selectedShopId, setSelectedShopId] = useState<UUID | null>(null);
  const [shopSelectorOpen, setShopSelectorOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<AdminNavTab>("dashboard");
  const [itemSearch, setItemSearch] = useState("");
  const [createShopOpen, setCreateShopOpen] = useState(false);
  const [manageShopOpen, setManageShopOpen] = useState(false);
  const [selectedManagedShop, setSelectedManagedShop] = useState<ShopRead | null>(null);
  const [creating, setCreating] = useState(false);
  const [updatingShop, setUpdatingShop] = useState(false);
  const [deletingShopId, setDeletingShopId] = useState<UUID | null>(null);
  const [statusUpdatingShopId, setStatusUpdatingShopId] = useState<UUID | null>(null);
  const [priceSheetOpen, setPriceSheetOpen] = useState(false);
  const [savingPrice, setSavingPrice] = useState(false);
  const [selectedPriceItemId, setSelectedPriceItemId] = useState<UUID | null>(null);
  const [priceSelectedShopId, setPriceSelectedShopId] = useState<UUID | null>(null);
  const [priceShopPickerOpen, setPriceShopPickerOpen] = useState(false);
  const [draftPrices, setDraftPrices] = useState<Record<UUID, string>>({});
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [billPreviewOpen, setBillPreviewOpen] = useState(false);
  const [billPreviewLoading, setBillPreviewLoading] = useState(false);
  const [selectedBillPreview, setSelectedBillPreview] = useState<BillRead | null>(null);
  const [printingAll, setPrintingAll] = useState(false);

  const debouncedItemSearch = useDebouncedValue(itemSearch.trim().toLowerCase());
  const toastAnimation = useRef(new Animated.Value(0)).current;
  const latestDashboardError = useRef<string | null>(null);

  const createForm = useForm<CreateShopFormValues>({
    resolver: zodResolver(createShopSchema),
    defaultValues: { name: "", username: "", password: "" },
  });

  const manageForm = useForm<EditShopFormValues>({
    resolver: zodResolver(editShopSchema),
    defaultValues: { name: "", username: "", password: "" },
  });

  const {
    createBranch,
    dailyBills,
    dailyBillsHasMore,
    dailyBillsLoadingMore,
    dailyBillsTotalCount,
    dashboardError,
    isOfflineSnapshot,
    itemSales,
    largestBill,
    loadBillDetail,
    loadDashboard,
    loadMoreBills,
    loadShopPriceBootstrap,
    loading,
    priceBootstrap,
    priceLoading,
    refreshing,
    saveShopPriceBook,
    selectedShopName,
    setPriceBootstrap,
    shops,
    deleteBranch,
    toggleBranchStatus,
    updateBranch,
    visibleShopRows,
  } = useAdminDashboardData({
    analyticsPeriod,
    analyticsReferenceDate,
    selectedShopId,
  });

  const showToast = useCallback((tone: ToastTone, message: string) => {
    setToast({ tone, message });
  }, []);

  const handleLogout = useCallback(() => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    clearSession();
    resetCart();
    clearPrices();
  }, [clearPrices, clearSession, resetCart]);

  useEffect(() => {
    if (
      Platform.OS === "android" &&
      !isNewArchitectureEnabled() &&
      UIManager.setLayoutAnimationEnabledExperimental
    ) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    if (!toast) {
      Animated.timing(toastAnimation, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(toastAnimation, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast, toastAnimation]);

  useEffect(() => {
    if (!dashboardError || latestDashboardError.current === dashboardError) {
      return;
    }

    latestDashboardError.current = dashboardError;
    if (shops.length > 0) {
      showToast("error", dashboardError);
    }
  }, [dashboardError, shops.length, showToast]);

  useEffect(() => {
    if (!priceBootstrap) {
      return;
    }

    const nextItem =
      priceBootstrap.items.find((item) => item.item_id === selectedPriceItemId) ?? priceBootstrap.items[0];
    if (!nextItem) {
      return;
    }

    setSelectedPriceItemId(nextItem.item_id);
  }, [priceBootstrap, selectedPriceItemId]);

  const {
    currentPriceItem,
    draftPrice,
    priceHelperText,
    resolvePriceDraft,
    saveDisabled,
    unresolvedPriceItems,
  } = useAdminPriceEditorModel({
    priceBootstrap,
    selectedPriceItemId,
    draftPrices,
    selectedPriceShopId: priceSelectedShopId,
  });

  const {
    analyticsReferenceLabel,
    analyticsReferenceOptions,
    billingSections,
    branchRanking,
    filteredItemSales,
    itemRevenueAverage,
    metricCards,
    visibleBillCount,
    visibleBills,
  } = useAdminDashboardAnalytics({
    analyticsPeriod,
    analyticsReferenceDate,
    selectedShopId,
    dateOptions,
    monthOptions,
    weekOptions,
    yearOptions,
    debouncedItemSearch,
    itemSales,
    dailyBills,
    dailyBillsTotalCount,
    visibleShopRows,
    largestBill,
    palette,
  });

  const useCompactMetricCards = windowWidth < 420;
  const bottomNavOffset = 12 + insets.bottom;
  const fabOffset = 100 + insets.bottom;
  const bottomSpacer = 160 + insets.bottom;
  const inventoryContentPadding = 16 + bottomSpacer;

  const handleSelectPeriod = useCallback((period: AnalyticsPeriod) => {
    if (period === analyticsPeriod) {
      return;
    }

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    triggerHaptic();
    setAnalyticsPeriod(period);
    setReferencePickerOpen(false);

    const nextReferenceDate =
      period === "date"
        ? dateOptions[0]?.value
        : period === "month"
          ? monthOptions[0]?.value
          : period === "week"
            ? weekOptions[0]?.value
            : yearOptions[0]?.value;

    if (nextReferenceDate) {
      setAnalyticsReferenceDate(nextReferenceDate);
    }
  }, [analyticsPeriod, dateOptions, monthOptions, weekOptions, yearOptions]);

  const toggleReferencePicker = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    triggerHaptic();
    setShopSelectorOpen(false);
    setReferencePickerOpen((current) => !current);
  }, []);

  const handleSelectReferenceDate = useCallback((value: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAnalyticsReferenceDate(value);
    setReferencePickerOpen(false);
  }, []);

  const toggleShopSelector = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    triggerHaptic();
    setReferencePickerOpen(false);
    setShopSelectorOpen((current) => !current);
  }, []);

  const handleSelectShop = useCallback((shopId: UUID | null) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedShopId(shopId);
    setShopSelectorOpen(false);
    showToast("success", shopId ? "Branch focus updated." : "Showing all branches.");
  }, [showToast]);

  const openCreateShopSheet = useCallback(() => {
    createForm.reset({ name: "", username: "", password: "" });
    setCreateShopOpen(true);
  }, [createForm]);

  const openManageShopSheet = useCallback(
    (shop: ShopRead) => {
      setManageShopOpen(true);
      setSelectedManagedShop(shop);
      manageForm.reset({
        name: shop.name,
        username: shop.username,
        password: "",
      });
    },
    [manageForm],
  );

  const closeManageShopSheet = useCallback(() => {
    setManageShopOpen(false);
    setSelectedManagedShop(null);
    manageForm.reset({ name: "", username: "", password: "" });
  }, [manageForm]);

  async function handleCreateShop(values: CreateShopFormValues) {
    setCreating(true);
    try {
      await createBranch({
        name: values.name.trim(),
        username: values.username.trim(),
        password: values.password,
      });
      createForm.reset();
      setCreateShopOpen(false);
      showToast("success", "New branch created successfully.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to create branch.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdateShop(values: EditShopFormValues) {
    if (!selectedManagedShop) {
      return;
    }

    setUpdatingShop(true);
    try {
      await updateBranch(selectedManagedShop, {
        name: values.name.trim(),
        username: values.username.trim(),
        password: values.password.trim() ? values.password.trim() : null,
      });
      closeManageShopSheet();
      showToast("success", `${values.name.trim()} updated successfully.`);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to update branch.");
    } finally {
      setUpdatingShop(false);
    }
  }

  const confirmDeleteShop = useCallback(
    (shop: ShopRead) => {
      Alert.alert(
        "Delete Shop",
        `Delete ${shop.name}? This is only allowed for shops without price or billing history.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void (async () => {
                setDeletingShopId(shop.id);
                try {
                  await deleteBranch(shop);
                  if (selectedShopId === shop.id) {
                    setSelectedShopId(null);
                  }
                  closeManageShopSheet();
                  showToast("success", `${shop.name} deleted successfully.`);
                } catch (error) {
                  showToast("error", error instanceof Error ? error.message : "Unable to delete branch.");
                } finally {
                  setDeletingShopId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [closeManageShopSheet, deleteBranch, selectedShopId, showToast],
  );

  const handleDeleteShop = useCallback(() => {
    if (!selectedManagedShop) {
      return;
    }

    confirmDeleteShop(selectedManagedShop);
  }, [confirmDeleteShop, selectedManagedShop]);

  const handleToggleShop = useCallback(
    async (shopId: UUID, isActive: boolean) => {
      const shop = shops.find((item) => item.id === shopId);
      if (!shop) {
        return;
      }

      try {
        setStatusUpdatingShopId(shopId);
        await toggleBranchStatus(shop, isActive);
        setSelectedManagedShop((current) =>
          current?.id === shopId ? { ...current, is_active: isActive } : current,
        );
        showToast("success", `${shop.name} ${isActive ? "activated" : "paused"}.`);
      } catch (error) {
        showToast("error", error instanceof Error ? error.message : "Unable to update branch.");
      } finally {
        setStatusUpdatingShopId(null);
      }
    },
    [shops, showToast, toggleBranchStatus],
  );

  const openPriceSheet = useCallback(async () => {
    setPriceSheetOpen(true);
    setDraftPrices({});
    setPriceError(null);
    setPriceBootstrap(null);

    if (selectedShopId !== null) {
      setPriceSelectedShopId(selectedShopId);
      try {
        const bootstrap = await loadShopPriceBootstrap(selectedShopId);
        const firstItem =
          bootstrap?.items.find((item) => !isPositiveNumber(item.current_price ?? "")) ?? bootstrap?.items[0];
        if (firstItem) {
          setSelectedPriceItemId(firstItem.item_id);
        }
      } catch (error) {
        showToast("error", error instanceof Error ? error.message : "Unable to load price controls.");
      }
    } else {
      setPriceSelectedShopId(null);
    }
  }, [loadShopPriceBootstrap, selectedShopId, setPriceBootstrap, showToast]);

  function closePriceSheet() {
    setPriceSheetOpen(false);
    setItemPickerOpen(false);
    setPriceShopPickerOpen(false);
    setPriceSelectedShopId(null);
    setDraftPrices({});
    setPriceError(null);
  }

  const openBillPreview = useCallback(async (billId: UUID) => {
    setBillPreviewOpen(true);
    setBillPreviewLoading(true);
    setSelectedBillPreview(null);

    try {
      const bill = await loadBillDetail(billId);
      setSelectedBillPreview(bill);
    } catch (error) {
      setBillPreviewOpen(false);
      showToast("error", error instanceof Error ? error.message : "Unable to load bill preview.");
    } finally {
      setBillPreviewLoading(false);
    }
  }, [loadBillDetail, showToast]);

  function closeBillPreview() {
    setBillPreviewOpen(false);
    setBillPreviewLoading(false);
    setSelectedBillPreview(null);
  }

  function handleSelectPriceItem(itemId: UUID) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedPriceItemId(itemId);
    setItemPickerOpen(false);
    setPriceError(null);
  }

  function handleChangeDraftPrice(value: string) {
    if (!selectedPriceItemId) {
      return;
    }

    setDraftPrices((current) => ({
      ...current,
      [selectedPriceItemId]: value.replace(/[^\d.]/g, ""),
    }));
    setPriceError(null);
  }

  async function handleSavePrice() {
    if (!priceBootstrap || !selectedPriceItemId || !currentPriceItem || !priceSelectedShopId) {
      return;
    }

    const normalizedValue = draftPrice.trim();
    if (!isPositiveNumber(normalizedValue)) {
      setPriceError("Enter a valid numeric price before saving.");
      triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    }

    if (unresolvedPriceItems.length > 0) {
      const itemNames = unresolvedPriceItems.map((item) => item.item_name);
      const preview = itemNames.slice(0, 3).join(", ");
      const suffix = itemNames.length > 3 ? `, +${itemNames.length - 3} more` : "";
      setPriceError(`Add valid prices for every active item before saving. Remaining: ${preview}${suffix}.`);
      triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    }

    const entries: { item_id: UUID; price_per_unit: string }[] = [];
    for (const item of priceBootstrap.items) {
      const rawValue = resolvePriceDraft(item.item_id, item.current_price);
      entries.push({
        item_id: item.item_id,
        price_per_unit: toMoneyString(rawValue),
      });
    }

    const previousBootstrap = priceBootstrap;
    setSavingPrice(true);
    setPriceError(null);
    setPriceBootstrap({
      ...priceBootstrap,
      items: priceBootstrap.items.map((item) => ({
        ...item,
        current_price: toMoneyString(resolvePriceDraft(item.item_id, item.current_price)),
      })),
    });
    setDraftPrices({});

    const shopName = shops.find((shop) => shop.id === priceSelectedShopId)?.name ?? "shop";
    try {
      await saveShopPriceBook(priceSelectedShopId, {
        entries,
      });
      closePriceSheet();
      showToast("success", `Prices saved for ${shopName}.`);
    } catch (error) {
      setPriceBootstrap(previousBootstrap);
      setDraftPrices(Object.fromEntries(entries.map((entry) => [entry.item_id, entry.price_per_unit])));
      setPriceError(error instanceof Error ? error.message : "Unable to save price update.");
      showToast("error", error instanceof Error ? error.message : "Unable to save price update.");
    } finally {
      setSavingPrice(false);
    }
  }

  async function handleSelectPriceShop(shopId: UUID) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPriceSelectedShopId(shopId);
    setPriceShopPickerOpen(false);
    setDraftPrices({});
    setSelectedPriceItemId(null);
    setPriceError(null);
    try {
      const bootstrap = await loadShopPriceBootstrap(shopId);
      const firstItem =
        bootstrap?.items.find((item) => !isPositiveNumber(item.current_price ?? "")) ?? bootstrap?.items[0];
      if (firstItem) {
        setSelectedPriceItemId(firstItem.item_id);
      }
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to load prices for this shop.");
    }
  }

  const handleQuickRefresh = useCallback(() => {
    void loadDashboard(true);
  }, [loadDashboard]);

  const handlePrintAllBills = useCallback(async () => {
    if (printingAll || visibleBills.length === 0) {
      return;
    }

    if (!preferredPrinter) {
      Alert.alert("Printer Not Configured", "Connect a saved printer on this device before printing receipts.");
      return;
    }

    try {
      setPrintingAll(true);
      const fullBills: BillRead[] = [];

      for (let index = 0; index < visibleBills.length; index += PRINT_ALL_CHUNK_SIZE) {
        const billChunk = visibleBills.slice(index, index + PRINT_ALL_CHUNK_SIZE);
        const chunkDetails = await Promise.all(billChunk.map((bill) => loadBillDetail(bill.bill_id)));
        fullBills.push(...chunkDetails);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      await startReceiptImagePrintJob(fullBills, preferredPrinter);
    } catch (error) {
      Alert.alert(
        "Unable to Print",
        error instanceof Error ? error.message : "The saved printer could not print these receipts.",
      );
    } finally {
      setPrintingAll(false);
    }
  }, [loadBillDetail, preferredPrinter, printingAll, visibleBills]);

  const handleLoadMoreBills = useCallback(() => {
    void loadMoreBills().catch((error) => {
      showToast("error", error instanceof Error ? error.message : "Unable to load more bills.");
    });
  }, [loadMoreBills, showToast]);

  const handleToggleTheme = useCallback(() => {
    const nextTheme = colorScheme === "dark" ? "light" : "dark";
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    setThemePreference(nextTheme);
    showToast("success", `${nextTheme === "dark" ? "Dark" : "Light"} mode enabled.`);
  }, [colorScheme, setThemePreference, showToast]);

  const handleOpenBillPreview = useCallback((billId: UUID) => {
    void openBillPreview(billId);
  }, [openBillPreview]);

  const handleStartPrintAllBills = useCallback(() => {
    void handlePrintAllBills();
  }, [handlePrintAllBills]);

  const handleToggleBranchStatus = useCallback((shopId: UUID, isActive: boolean) => {
    void handleToggleShop(shopId, isActive);
  }, [handleToggleShop]);

  const handleOpenPriceSheet = useCallback(() => {
    void openPriceSheet();
  }, [openPriceSheet]);

  const handleSelectNav = useCallback((key: string) => {
    setActiveNav(key as AdminNavTab);
  }, []);

  if (loading && shops.length === 0) {
    return <DashboardSkeleton palette={palette} />;
  }

  if (!loading && shops.length === 0 && dashboardError) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
        <View style={styles.emptyWrap}>
          <EmptyStateCard
            title="Unable to load admin dashboard"
            subtitle={dashboardError}
            actionLabel="Retry"
            onAction={handleQuickRefresh}
            palette={palette}
            icon="wifi-alert"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["left", "right"]}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />

      <TopAppBar
        shopName={selectedShopName}
        onShopPress={toggleShopSelector}
        periodLabel={analyticsReferenceLabel}
        onPeriodPress={toggleReferencePicker}
        palette={palette}
        topInset={insets.top}
        isOffline={isOfflineSnapshot}
        isDark={colorScheme === "dark"}
        onThemeToggle={handleToggleTheme}
        onRefresh={handleQuickRefresh}
      />

      <ToastBanner toast={toast} palette={palette} animatedValue={toastAnimation} />

      {shopSelectorOpen ? (
        <View
          style={[
            styles.floatingDropdown,
            adminShadow(palette.shadow, 0.08, 12, 18),
            { backgroundColor: palette.card, borderColor: palette.border, top: insets.top + 82 },
          ]}
        >
          <ScrollView
            style={styles.floatingDropdownScroll}
            contentContainerStyle={styles.floatingDropdownContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable onPress={() => handleSelectShop(null)} style={styles.selectorOption}>
              <View style={styles.selectorOptionContent}>
                <View style={[styles.selectorOptionIcon, { backgroundColor: palette.surfaceMuted }]}>
                  <MaterialCommunityIcons name="domain" size={16} color={palette.emerald} />
                </View>
                <View style={styles.selectorOptionText}>
                  <Text style={[styles.selectorOptionTitle, { color: palette.textPrimary }]}>All Branches</Text>
                  <Text style={[styles.selectorOptionSubtitle, { color: palette.textMuted }]}>
                    Network-wide analytics
                  </Text>
                </View>
              </View>
              {!selectedShopId ? (
                <MaterialCommunityIcons name="check-circle" size={18} color={palette.emerald} />
              ) : null}
            </Pressable>
            {shops.map((shop) => (
              <Pressable key={shop.id} onPress={() => handleSelectShop(shop.id)} style={styles.selectorOption}>
                <View style={styles.selectorOptionContent}>
                  <View style={[styles.selectorOptionIcon, { backgroundColor: palette.surfaceMuted }]}>
                    <MaterialCommunityIcons name="storefront-outline" size={16} color={palette.emerald} />
                  </View>
                  <View style={styles.selectorOptionText}>
                    <Text style={[styles.selectorOptionTitle, { color: palette.textPrimary }]}>{shop.name}</Text>
                    <Text style={[styles.selectorOptionSubtitle, { color: palette.textMuted }]}>
                      {shop.username} · {shop.is_active ? "Active" : "Disabled"}
                    </Text>
                  </View>
                </View>
                <View
                  style={[
                    styles.selectorOptionStatusChip,
                    { backgroundColor: shop.is_active ? palette.successSoft : palette.dangerSoft },
                  ]}
                >
                  <Text
                    style={[
                      styles.selectorOptionStatusText,
                      { color: shop.is_active ? palette.success : palette.danger },
                    ]}
                  >
                    {shop.is_active ? "Active" : "Off"}
                  </Text>
                </View>
                {selectedShopId === shop.id ? (
                  <MaterialCommunityIcons name="check-circle" size={18} color={palette.emerald} />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {referencePickerOpen ? (
        <View
          style={[
            styles.floatingDropdown,
            adminShadow(palette.shadow, 0.08, 12, 18),
            { backgroundColor: palette.card, borderColor: palette.border, top: insets.top + 82 },
          ]}
        >
          <View style={[styles.segmentRow, { padding: 12 }]}>
            {PERIOD_OPTIONS.map((option) => {
              const active = analyticsPeriod === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => handleSelectPeriod(option.key)}
                  style={[
                    styles.segmentButton,
                    {
                      backgroundColor: active ? palette.emerald : palette.surfaceMuted,
                      borderColor: active ? palette.emerald : palette.border,
                    },
                  ]}
                >
                  <Text style={[styles.segmentText, { color: active ? "#FFFFFF" : palette.textSecondary }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <ScrollView
            style={styles.floatingDropdownScroll}
            contentContainerStyle={styles.floatingDropdownContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {analyticsReferenceOptions.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: option.value === analyticsReferenceDate }}
                onPress={() => handleSelectReferenceDate(option.value)}
                style={[
                  styles.referenceOption,
                  option.value === analyticsReferenceDate && { backgroundColor: palette.emeraldSoft },
                ]}
              >
                <Text style={[styles.referenceOptionText, { color: palette.textPrimary }]}>{option.label}</Text>
                {option.value === analyticsReferenceDate ? (
                  <MaterialCommunityIcons name="check-circle" size={18} color={palette.emerald} />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {activeNav === "dashboard" ? (
        <AdminDashboardTab
          dashboardError={dashboardError}
          hasShops={shops.length > 0}
          palette={palette}
          refreshing={refreshing}
          onRefresh={handleQuickRefresh}
          bottomSpacer={bottomSpacer}
          selectedShopId={selectedShopId}
          selectedShopName={selectedShopName}
          analyticsReferenceLabel={analyticsReferenceLabel}
          visibleBillCount={visibleBillCount}
          metricCards={metricCards}
          useCompactMetricCards={useCompactMetricCards}
        />
      ) : null}

      {activeNav === "billing" ? (
        <AdminBillingTab
          dashboardError={dashboardError}
          hasShops={shops.length > 0}
          palette={palette}
          billingSections={billingSections}
          visibleBillCount={visibleBillCount}
          visibleBillsLength={visibleBills.length}
          dailyBillsLength={dailyBills.length}
          dailyBillsHasMore={dailyBillsHasMore}
          dailyBillsLoadingMore={dailyBillsLoadingMore}
          refreshing={refreshing}
          bottomSpacer={bottomSpacer}
          printingAll={printingAll}
          onRefresh={handleQuickRefresh}
          onOpenBill={handleOpenBillPreview}
          onPrintAll={handleStartPrintAllBills}
          onLoadMore={handleLoadMoreBills}
        />
      ) : null}

      {activeNav === "inventory" ? (
        <AdminInventoryTab
          dashboardError={dashboardError}
          hasShops={shops.length > 0}
          palette={palette}
          filteredItemSales={filteredItemSales}
          itemRevenueAverage={itemRevenueAverage}
          itemSearch={itemSearch}
          onChangeSearch={setItemSearch}
          refreshing={refreshing}
          bottomPadding={inventoryContentPadding}
          onRefresh={handleQuickRefresh}
        />
      ) : null}

      {activeNav === "settings" ? (
        <AdminSettingsTab
          dashboardError={dashboardError}
          hasShops={shops.length > 0}
          palette={palette}
          visibleShopRows={visibleShopRows}
          branchRanking={branchRanking}
          statusUpdatingShopId={statusUpdatingShopId}
          refreshing={refreshing}
          bottomPadding={inventoryContentPadding}
          onRefresh={handleQuickRefresh}
          onCreateBranch={openCreateShopSheet}
          onManageBranch={openManageShopSheet}
          onToggleBranch={handleToggleBranchStatus}
          onLogout={handleLogout}
        />
      ) : null}

      <BottomNav
        items={bottomNavItems}
        activeKey={activeNav}
        onSelect={handleSelectNav}
        palette={palette}
        bottomOffset={bottomNavOffset}
      />

      {activeNav === "dashboard" || activeNav === "settings" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open update price sheet"
          onPress={handleOpenPriceSheet}
          style={[
            styles.fab,
            adminShadow(palette.shadow, 0.12, 14, 20),
            { backgroundColor: palette.emerald, bottom: fabOffset },
          ]}
        >
          <MaterialCommunityIcons name="cash-edit" size={18} color="#FFFFFF" />
          <Text style={styles.fabLabel}>Update Price</Text>
        </Pressable>
      ) : null}

      <PriceUpdateSheet
        visible={priceSheetOpen}
        onClose={closePriceSheet}
        palette={palette}
        bottomInset={insets.bottom}
        priceLoading={priceLoading}
        priceBootstrap={priceBootstrap}
        currentPriceItem={currentPriceItem}
        selectedPriceItemId={selectedPriceItemId}
        resolveItemPrice={resolvePriceDraft}
        onSelectItem={handleSelectPriceItem}
        draftPrice={draftPrice}
        onChangeDraftPrice={handleChangeDraftPrice}
        priceError={priceError}
        priceHelperText={priceHelperText}
        saveDisabled={saveDisabled}
        itemPickerOpen={itemPickerOpen}
        onToggleItemPicker={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setItemPickerOpen((current) => !current);
        }}
        savingPrice={savingPrice}
        onSave={() => void handleSavePrice()}
        shops={shops}
        selectedPriceShopId={priceSelectedShopId}
        onSelectShop={handleSelectPriceShop}
        shopPickerOpen={priceShopPickerOpen}
        onToggleShopPicker={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setPriceShopPickerOpen((current) => !current);
        }}
      />

      <BillPreviewSheet
        visible={billPreviewOpen}
        onClose={closeBillPreview}
        palette={palette}
        bottomInset={insets.bottom}
        loading={billPreviewLoading}
        bill={selectedBillPreview}
      />

      <ShopEditorSheet
        visible={createShopOpen}
        onClose={() => setCreateShopOpen(false)}
        palette={palette}
        bottomInset={insets.bottom}
        mode="create"
        loading={creating}
        control={createForm.control}
        onSubmit={createForm.handleSubmit(handleCreateShop)}
      />

      <ShopEditorSheet
        visible={manageShopOpen}
        onClose={closeManageShopSheet}
        palette={palette}
        bottomInset={insets.bottom}
        mode="edit"
        loading={updatingShop}
        deleting={deletingShopId === selectedManagedShop?.id}
        statusLoading={statusUpdatingShopId === selectedManagedShop?.id}
        isActive={selectedManagedShop?.is_active}
        control={manageForm.control}
        onSubmit={manageForm.handleSubmit(handleUpdateShop)}
        onDelete={handleDeleteShop}
        onToggleActive={() => {
          if (!selectedManagedShop) {
            return;
          }
          void handleToggleShop(selectedManagedShop.id, !selectedManagedShop.is_active);
        }}
      />
      {receiptImagePrintBridge}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  floatingDropdown: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 100,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    maxHeight: 360,
  },
  floatingDropdownScroll: {
    flexGrow: 0,
  },
  floatingDropdownContent: {
    paddingBottom: 8,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
  },
  selectorOption: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  selectorOptionContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  selectorOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  selectorOptionText: {
    flex: 1,
  },
  selectorOptionTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  selectorOptionSubtitle: {
    marginTop: 4,
    fontSize: 12,
  },
  selectorOptionStatusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  selectorOptionStatusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  referenceOption: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  referenceOptionText: {
    fontSize: 14,
    fontWeight: "600",
  },
  segmentButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "700",
  },
  fab: {
    position: "absolute",
    right: 16,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minHeight: 46,
    borderWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  fabLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
});
