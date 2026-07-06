import { zodResolver } from "@hookform/resolvers/zod";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useReceiptImagePrintJob } from "@/hooks/use-receipt-image-print-job";
import type { AdminDashboardScreenProps } from "@/navigation/types";
import { logout } from "@/store/auth-store";
import { usePrinterStore } from "@/store/printer-store";
import { AnalyticsPeriod, type BillRead, type ShopRead, type UUID } from "@/types/api";

import { adminElevation } from "./admin-dashboard-theme";
import { useAdminTheme } from "./use-admin-theme";
import {
  AdminBillingTab,
} from "./components/admin-dashboard-billing-tab";
import { AdminPriceActionsFab } from "./components/admin-price-actions-fab";
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
  ShopEditorSheet,
} from "./components/admin-dashboard-sheets";
import {
  AdminSettingsTab,
} from "./components/admin-dashboard-settings-tab";
import {
  useAdminDashboardAnalytics,
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

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Login username is required")
  .max(50, "Username is too long")
  .regex(/^[a-z0-9._-]+$/, "Use only letters, numbers, dots, hyphens, or underscores");

const createShopSchema = z.object({
  name: z.string().min(2, "Shop name is required"),
  username: usernameSchema,
  password: z
    .string()
    .max(128, "Password is too long")
    .refine((value) => value.trim().length >= 8, "Password must be at least 8 characters"),
});

const editShopSchema = z.object({
  name: z.string().min(2, "Shop name is required"),
  username: usernameSchema,
  password: z
    .string()
    .max(128, "Password is too long")
    .refine((value) => value.trim() === "" || value.trim().length >= 8, "Password must be at least 8 characters"),
});

type CreateShopFormValues = z.infer<typeof createShopSchema>;
type EditShopFormValues = z.infer<typeof editShopSchema>;
const PERIOD_OPTIONS: { key: AnalyticsPeriod; label: string }[] = [
  { key: AnalyticsPeriod.DATE, label: "Day" },
  { key: AnalyticsPeriod.RANGE, label: "Range" },
  { key: AnalyticsPeriod.WEEK, label: "Week" },
  { key: AnalyticsPeriod.MONTH, label: "Month" },
  { key: AnalyticsPeriod.YEAR, label: "Year" },
];

const PRINT_ALL_CHUNK_SIZE = 50;
const CALENDAR_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const calendarMonthFormatter = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });
const calendarDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function toLocalDateValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateValue(value: string) {
  const [yearText, monthText, dayText] = value.split("-");
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
}

function addMonths(value: string, offset: number) {
  const date = parseLocalDateValue(value);
  return toLocalDateValue(new Date(date.getFullYear(), date.getMonth() + offset, 1));
}

function buildCalendarDays(monthValue: string) {
  const monthDate = parseLocalDateValue(monthValue);
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      value: toLocalDateValue(date),
      day: date.getDate(),
      inMonth: date.getMonth() === monthStart.getMonth(),
    };
  });
}

function isDateBetween(value: string, start?: string | null, end?: string | null) {
  return Boolean(start && end && value >= start && value <= end);
}

function formatCalendarDateLabel(value?: string | null) {
  return value ? calendarDateFormatter.format(parseLocalDateValue(value)) : "Select date";
}

function isNewArchitectureEnabled() {
  return Boolean((globalThis as typeof globalThis & { nativeFabricUIManager?: unknown }).nativeFabricUIManager);
}

export function AdminDashboardScreen({ navigation }: AdminDashboardScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const { colorScheme, palette, setThemePreference } = useAdminTheme();
  const bottomNavItems = useMemo(() => NAV_ITEMS.map((item) => ({ ...item, icon: item.icon as never })), []);
  const dateOptions = useMemo(() => buildDateOptions(), []);
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const weekOptions = useMemo(() => buildWeekOptions(), []);
  const yearOptions = useMemo(() => buildYearOptions(), []);
  const preferredPrinter = usePrinterStore((state) => state.preferredPrinter);
  const { receiptImagePrintBridge, startReceiptImagePrintJob } = useReceiptImagePrintJob();

  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>(AnalyticsPeriod.DATE);
  const [analyticsReferenceDate, setAnalyticsReferenceDate] = useState(
    dateOptions[0]?.value ?? new Date().toISOString().slice(0, 10),
  );
  const [analyticsRangeStartDate, setAnalyticsRangeStartDate] = useState(
    dateOptions[6]?.value ?? dateOptions[0]?.value ?? new Date().toISOString().slice(0, 10),
  );
  const [analyticsRangeEndDate, setAnalyticsRangeEndDate] = useState(
    dateOptions[0]?.value ?? new Date().toISOString().slice(0, 10),
  );
  const [calendarMonthValue, setCalendarMonthValue] = useState(
    dateOptions[0]?.value ?? new Date().toISOString().slice(0, 10),
  );
  const [draftRangeStartDate, setDraftRangeStartDate] = useState<string | null>(
    dateOptions[6]?.value ?? dateOptions[0]?.value ?? new Date().toISOString().slice(0, 10),
  );
  const [draftRangeEndDate, setDraftRangeEndDate] = useState<string | null>(
    dateOptions[0]?.value ?? new Date().toISOString().slice(0, 10),
  );
  const [selectedShopId, setSelectedShopId] = useState<UUID | null>(null);
  const [shopSelectorOpen, setShopSelectorOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<AdminNavTab>("dashboard");
  const bottomNavActiveKey = activeNav === "billing" ? "sales" : activeNav;
  const [itemSearch, setItemSearch] = useState("");
  const [createShopOpen, setCreateShopOpen] = useState(false);
  const [manageShopOpen, setManageShopOpen] = useState(false);
  const [selectedManagedShop, setSelectedManagedShop] = useState<ShopRead | null>(null);
  const [creating, setCreating] = useState(false);
  const [updatingShop, setUpdatingShop] = useState(false);
  const [deletingShopId, setDeletingShopId] = useState<UUID | null>(null);
  const [statusUpdatingShopId, setStatusUpdatingShopId] = useState<UUID | null>(null);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [billPreviewOpen, setBillPreviewOpen] = useState(false);
  const [billPreviewLoading, setBillPreviewLoading] = useState(false);
  const [selectedBillPreview, setSelectedBillPreview] = useState<BillRead | null>(null);
  const [printingAll, setPrintingAll] = useState(false);

  const debouncedItemSearch = useDebouncedValue(itemSearch.trim().toLowerCase());
  const toastAnimation = useRef(new Animated.Value(0)).current;
  const latestDashboardError = useRef<string | null>(null);
  const todayValue = dateOptions[0]?.value ?? toLocalDateValue(new Date());
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonthValue), [calendarMonthValue]);
  const calendarMonthLabel = useMemo(
    () => calendarMonthFormatter.format(parseLocalDateValue(calendarMonthValue)),
    [calendarMonthValue],
  );
  const analyticsRange = useMemo(
    () => (
      analyticsPeriod === AnalyticsPeriod.RANGE
        ? { startDate: analyticsRangeStartDate, endDate: analyticsRangeEndDate }
        : undefined
    ),
    [analyticsPeriod, analyticsRangeEndDate, analyticsRangeStartDate],
  );

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
    loadBillDetails,
    loadDashboard,
    loadMoreBills,
    loading,
    refreshing,
    selectedShopName,
    shops,
    branchQuota,
    deleteBranch,
    toggleBranchStatus,
    updateBranch,
    visibleShopRows,
  } = useAdminDashboardData({
    analyticsPeriod,
    analyticsReferenceDate,
    analyticsRange,
    selectedShopId,
  });

  const showToast = useCallback((tone: ToastTone, message: string) => {
    setToast({ tone, message });
  }, []);

  const handleLogout = useCallback(() => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    void logout();
  }, []);

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
    analyticsRange,
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
  const bottomNavOffset = insets.bottom;
  const fabOffset = 88 + insets.bottom;
  const bottomSpacer = 148 + insets.bottom;
  const inventoryContentPadding = 16 + bottomSpacer;
  const floatingDropdownMaxHeight = Math.min(
    560,
    Math.max(320, windowHeight - insets.top - insets.bottom - 112),
  );
  const canApplyDraftRange = Boolean(draftRangeStartDate && draftRangeEndDate);

  const handleSelectPeriod = useCallback((period: AnalyticsPeriod) => {
    if (period === analyticsPeriod) {
      return;
    }

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    triggerHaptic();
    setAnalyticsPeriod(period);

    if (period === AnalyticsPeriod.DATE) {
      setCalendarMonthValue(analyticsReferenceDate);
      return;
    }

    if (period === AnalyticsPeriod.RANGE) {
      setDraftRangeStartDate(analyticsRangeStartDate);
      setDraftRangeEndDate(analyticsRangeEndDate);
      setCalendarMonthValue(analyticsRangeStartDate);
      return;
    }

    const nextReferenceDate =
      period === AnalyticsPeriod.MONTH
        ? monthOptions[0]?.value
        : period === AnalyticsPeriod.WEEK
          ? weekOptions[0]?.value
          : yearOptions[0]?.value;

    if (nextReferenceDate) {
      setAnalyticsReferenceDate(nextReferenceDate);
    }
  }, [
    analyticsPeriod,
    analyticsRangeEndDate,
    analyticsRangeStartDate,
    analyticsReferenceDate,
    monthOptions,
    weekOptions,
    yearOptions,
  ]);

  const toggleReferencePicker = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    triggerHaptic();
    setShopSelectorOpen(false);
    setReferencePickerOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        setCalendarMonthValue(
          analyticsPeriod === AnalyticsPeriod.RANGE ? analyticsRangeStartDate : analyticsReferenceDate,
        );
        setDraftRangeStartDate(analyticsRangeStartDate);
        setDraftRangeEndDate(analyticsRangeEndDate);
      }
      return nextOpen;
    });
  }, [analyticsPeriod, analyticsRangeEndDate, analyticsRangeStartDate, analyticsReferenceDate]);

  const handleSelectReferenceDate = useCallback((value: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAnalyticsReferenceDate(value);
    setReferencePickerOpen(false);
  }, []);

  const handleSelectCalendarDate = useCallback((value: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    triggerHaptic();
    setAnalyticsReferenceDate(value);
    setCalendarMonthValue(value);
    setReferencePickerOpen(false);
  }, []);

  const handleSelectRangeDate = useCallback((value: string) => {
    triggerHaptic();
    setDraftRangeStartDate((currentStart) => {
      if (!currentStart || draftRangeEndDate) {
        setDraftRangeEndDate(null);
        return value;
      }

      if (value < currentStart) {
        setDraftRangeEndDate(currentStart);
        return value;
      }

      setDraftRangeEndDate(value);
      return currentStart;
    });
  }, [draftRangeEndDate]);

  const applyCustomRange = useCallback(() => {
    if (!draftRangeStartDate || !draftRangeEndDate) {
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    setAnalyticsRangeStartDate(draftRangeStartDate);
    setAnalyticsRangeEndDate(draftRangeEndDate);
    setAnalyticsReferenceDate(draftRangeStartDate);
    setReferencePickerOpen(false);
  }, [draftRangeEndDate, draftRangeStartDate]);

  const handleShowPreviousCalendarMonth = useCallback(() => {
    setCalendarMonthValue((current) => addMonths(current, -1));
  }, []);

  const handleShowNextCalendarMonth = useCallback(() => {
    setCalendarMonthValue((current) => addMonths(current, 1));
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
    if (!branchQuota.can_create_branch) {
      showToast(
        "error",
        "Branch limit reached. Contact Durozen Technologies to request additional capacity.",
      );
      return;
    }
    createForm.reset({ name: "", username: "", password: "" });
    setCreateShopOpen(true);
  }, [branchQuota.can_create_branch, createForm, showToast]);

  const openReportsScreen = useCallback(() => {
    navigation.navigate("AdminReports");
  }, [navigation]);

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
        username: values.username,
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
        username: values.username,
        password: values.password.trim() ? values.password : null,
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
        const chunkDetails = await loadBillDetails(billChunk.map((bill) => bill.bill_id));
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
  }, [loadBillDetails, preferredPrinter, printingAll, startReceiptImagePrintJob, visibleBills]);

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

  const handleOpenRetailerPrices = useCallback(() => {
    const targetShopId = selectedShopId ?? shops[0]?.id ?? null;
    navigation.navigate("AdminRetailers", {
      tab: "retailerPrices",
      shopId: targetShopId ?? undefined,
    });
  }, [navigation, selectedShopId, shops]);

  const handleOpenUpdatePrice = useCallback(() => {
    const targetShopId = selectedShopId ?? shops[0]?.id ?? null;
    navigation.navigate("AdminItemPrices", { shopId: targetShopId ?? undefined });
  }, [navigation, selectedShopId, shops]);

  const handleOpenPurchaseRates = useCallback(() => {
    navigation.navigate("AdminInventory", { tab: "purchaseRates" });
  }, [navigation]);

  const handleSelectNav = useCallback((key: string) => {
    if (key === "items") {
      navigation.navigate("AdminItemsCatalogue");
      return;
    }
    if (key === "inventory") {
      navigation.navigate("AdminInventory");
      return;
    }
    if (key === "expenses") {
      navigation.navigate("AdminExpenses", { shopId: selectedShopId ?? undefined });
      return;
    }
    if (key === "retailers") {
      navigation.navigate("AdminRetailers", { tab: "retailers" });
      return;
    }
    setActiveNav(key as AdminNavTab);
  }, [navigation, selectedShopId]);

  const handleOpenBilling = useCallback(() => {
    triggerHaptic();
    setActiveNav("billing");
  }, []);

  const handleBackToSales = useCallback(() => {
    triggerHaptic();
    setActiveNav("sales");
  }, []);

  if (loading && shops.length === 0) {
    return <DashboardSkeleton palette={palette} />;
  }

  if (!loading && shops.length === 0 && dashboardError) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
        <StatusBar style="light" />
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
      <StatusBar style="light" />

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
            adminElevation(2),
            {
              backgroundColor: palette.card,
              maxHeight: floatingDropdownMaxHeight,
              top: insets.top + 82,
            },
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
                  <MaterialCommunityIcons name="domain" size={16} color={palette.primary} />
                </View>
                <View style={styles.selectorOptionText}>
                  <Text style={[styles.selectorOptionTitle, { color: palette.textPrimary }]}>All Branches</Text>
                  <Text style={[styles.selectorOptionSubtitle, { color: palette.textMuted }]}>
                    Network-wide analytics
                  </Text>
                </View>
              </View>
              {!selectedShopId ? (
                <MaterialCommunityIcons name="check-circle" size={18} color={palette.primary} />
              ) : null}
            </Pressable>
            {shops.map((shop) => (
              <Pressable key={shop.id} onPress={() => handleSelectShop(shop.id)} style={styles.selectorOption}>
                <View style={styles.selectorOptionContent}>
                  <View style={[styles.selectorOptionIcon, { backgroundColor: palette.surfaceMuted }]}>
                    <MaterialCommunityIcons name="storefront-outline" size={16} color={palette.primary} />
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
                  <MaterialCommunityIcons name="check-circle" size={18} color={palette.primary} />
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
            adminElevation(2),
            {
              backgroundColor: palette.card,
              maxHeight: floatingDropdownMaxHeight,
              top: insets.top + 82,
            },
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
                      backgroundColor: active ? palette.primary : palette.surfaceMuted,
                      borderColor: active ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text style={[styles.segmentText, { color: active ? palette.onPrimary : palette.textSecondary }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {analyticsPeriod === AnalyticsPeriod.DATE || analyticsPeriod === AnalyticsPeriod.RANGE ? (
            <ScrollView
              style={styles.floatingDropdownScroll}
              contentContainerStyle={styles.calendarContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.calendarHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous month"
                  onPress={handleShowPreviousCalendarMonth}
                  style={[
                    styles.calendarIconButton,
                    { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                  ]}
                >
                  <MaterialCommunityIcons name="chevron-left" size={22} color={palette.textSecondary} />
                </Pressable>
                <View style={styles.calendarTitleWrap}>
                  <Text style={[styles.calendarModeLabel, { color: palette.textMuted }]}>
                    {analyticsPeriod === AnalyticsPeriod.RANGE ? "Custom range" : "Select day"}
                  </Text>
                  <Text style={[styles.calendarMonthTitle, { color: palette.textPrimary }]}>
                    {calendarMonthLabel}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next month"
                  onPress={handleShowNextCalendarMonth}
                  style={[
                    styles.calendarIconButton,
                    { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                  ]}
                >
                  <MaterialCommunityIcons name="chevron-right" size={22} color={palette.textSecondary} />
                </Pressable>
              </View>

              <View style={styles.weekdayRow}>
                {CALENDAR_WEEKDAYS.map((weekday) => (
                  <Text key={weekday} style={[styles.weekdayText, { color: palette.textMuted }]}>
                    {weekday}
                  </Text>
                ))}
              </View>

              <View style={styles.calendarGrid}>
                {calendarDays.map((day) => {
                  const isDaySelected =
                    analyticsPeriod === AnalyticsPeriod.DATE && day.value === analyticsReferenceDate;
                  const isRangeStart = analyticsPeriod === AnalyticsPeriod.RANGE && day.value === draftRangeStartDate;
                  const isRangeEnd = analyticsPeriod === AnalyticsPeriod.RANGE && day.value === draftRangeEndDate;
                  const isRangeEdge = isRangeStart || isRangeEnd;
                  const isRangeMiddle =
                    analyticsPeriod === AnalyticsPeriod.RANGE &&
                    isDateBetween(day.value, draftRangeStartDate, draftRangeEndDate) &&
                    !isRangeEdge;
                  const selected = isDaySelected || isRangeEdge;
                  const isToday = day.value === todayValue;

                  return (
                    <View key={day.value} style={styles.calendarDayCell}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={formatCalendarDateLabel(day.value)}
                        onPress={() => {
                          if (analyticsPeriod === AnalyticsPeriod.DATE) {
                            handleSelectCalendarDate(day.value);
                            return;
                          }
                          handleSelectRangeDate(day.value);
                        }}
                        style={[
                          styles.calendarDayButton,
                          {
                            backgroundColor: selected
                              ? palette.primary
                              : isRangeMiddle
                                ? palette.primarySoft
                                : "transparent",
                            borderColor: isToday ? palette.primary : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.calendarDayText,
                            {
                              color: selected
                                ? palette.onPrimary
                                : !day.inMonth
                                  ? palette.textMuted
                                  : isRangeMiddle || isToday
                                    ? palette.primaryStrong
                                    : palette.textPrimary,
                              opacity: day.inMonth || selected || isRangeMiddle ? 1 : 0.5,
                            },
                          ]}
                        >
                          {day.day}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              {analyticsPeriod === AnalyticsPeriod.RANGE ? (
                <View
                  style={[
                    styles.rangeFooter,
                    { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                  ]}
                >
                  <View style={styles.rangeDatesRow}>
                    <View style={styles.rangeDateBlock}>
                      <Text style={[styles.rangeDateLabel, { color: palette.textMuted }]}>Start</Text>
                      <Text style={[styles.rangeDateValue, { color: palette.textPrimary }]} numberOfLines={1}>
                        {formatCalendarDateLabel(draftRangeStartDate)}
                      </Text>
                    </View>
                    <View style={[styles.rangeDivider, { backgroundColor: palette.border }]} />
                    <View style={styles.rangeDateBlock}>
                      <Text style={[styles.rangeDateLabel, { color: palette.textMuted }]}>End</Text>
                      <Text style={[styles.rangeDateValue, { color: palette.textPrimary }]} numberOfLines={1}>
                        {formatCalendarDateLabel(draftRangeEndDate)}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!canApplyDraftRange}
                    onPress={applyCustomRange}
                    style={[
                      styles.rangeApplyButton,
                      { backgroundColor: canApplyDraftRange ? palette.primary : palette.border },
                    ]}
                  >
                    <Text
                      style={[
                        styles.rangeApplyText,
                        { color: canApplyDraftRange ? palette.onPrimary : palette.textMuted },
                      ]}
                    >
                      Apply Range
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </ScrollView>
          ) : (
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
                    option.value === analyticsReferenceDate && { backgroundColor: palette.primarySoft },
                  ]}
                >
                  <Text style={[styles.referenceOptionText, { color: palette.textPrimary }]}>{option.label}</Text>
                  {option.value === analyticsReferenceDate ? (
                    <MaterialCommunityIcons name="check-circle" size={18} color={palette.primary} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoid}
      >
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
            onBackToSales={handleBackToSales}
          />
        ) : null}

        {activeNav === "sales" ? (
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
            onOpenBilling={handleOpenBilling}
          />
        ) : null}

        {activeNav === "settings" ? (
          <AdminSettingsTab
            dashboardError={dashboardError}
            hasShops={shops.length > 0}
            palette={palette}
            visibleShopRows={visibleShopRows}
            branchRanking={branchRanking}
            branchQuota={branchQuota}
            statusUpdatingShopId={statusUpdatingShopId}
            refreshing={refreshing}
            bottomPadding={inventoryContentPadding}
            onRefresh={handleQuickRefresh}
            onCreateBranch={openCreateShopSheet}
            onOpenReports={openReportsScreen}
            onManageBranch={openManageShopSheet}
            onToggleBranch={handleToggleBranchStatus}
            onLogout={handleLogout}
          />
        ) : null}
      </KeyboardAvoidingView>

      <BottomNav
        items={bottomNavItems}
        activeKey={bottomNavActiveKey}
        onSelect={handleSelectNav}
        palette={palette}
        bottomOffset={bottomNavOffset}
      />

      {activeNav === "dashboard" || activeNav === "settings" ? (
        <AdminPriceActionsFab
          palette={palette}
          bottom={fabOffset}
          onPurchaseRate={handleOpenPurchaseRates}
          onUpdatePrice={handleOpenUpdatePrice}
          onRetailerPrice={handleOpenRetailerPrices}
        />
      ) : null}

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
  keyboardAvoid: {
    flex: 1,
  },
  floatingDropdown: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 100,
    borderRadius: 12,
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
    paddingVertical: 16,
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
    borderRadius: 12,
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
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  selectorOptionStatusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  referenceOption: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  referenceOptionText: {
    fontSize: 14,
    fontWeight: "600",
  },
  segmentButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "700",
  },
  calendarContent: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 12,
  },
  calendarHeader: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  calendarIconButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarTitleWrap: {
    minWidth: 0,
    flex: 1,
    alignItems: "center",
  },
  calendarModeLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  calendarMonthTitle: {
    marginTop: 3,
    fontSize: 17,
    fontWeight: "800",
  },
  weekdayRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  weekdayText: {
    width: "14.2857%",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calendarDayCell: {
    width: "14.2857%",
    padding: 2,
  },
  calendarDayButton: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarDayText: {
    fontSize: 14,
    fontWeight: "800",
  },
  rangeFooter: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  rangeDatesRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  rangeDateBlock: {
    minWidth: 0,
    flex: 1,
  },
  rangeDateLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  rangeDateValue: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "800",
  },
  rangeDivider: {
    width: 1,
  },
  rangeApplyButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rangeApplyText: {
    fontSize: 13,
    fontWeight: "800",
  },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
});
