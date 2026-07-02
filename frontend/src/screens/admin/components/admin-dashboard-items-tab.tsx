import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo, type ReactNode, useMemo } from "react";
import { FlatList, RefreshControl } from "react-native";
import {
  Button as TButton,
  Card,
  Input,
  ScrollView,
  Spinner,
  Text,
  View as Stack,
  XStack,
  YStack,
} from "tamagui";

import { resolveApiUrl } from "@/api/client";
import { authenticatedImageSource } from "@/utils/item-images";
import {
  BaseUnit,
  UnitType,
  type ShopBootstrapResponse,
  type ShopItemCounts,
  type ShopItemRead,
  type ShopRead,
  type UUID,
} from "@/types/api";
import { toMoneyString } from "@/utils/decimal";

import {
  AdminItemFilter,
  AdminItemFormScope,
  AdminItemWorkspace,
  ItemScope,
  type ManageableItemWorkspace,
  PriceStatus,
} from "../admin-items-model";
import { type ThemePalette } from "../admin-dashboard-theme";
import { SearchField } from "./admin-dashboard-primitives";

export type ShopItemFormState = {
  name: string;
  tamilName: string;
  unitType: UnitType;
  baseUnit: BaseUnit;
  isActive: boolean;
  customAttributesText: string;
  targetScope: AdminItemFormScope;
};

export type ShopItemImageDraft = {
  uri: string;
  name: string;
  type: string;
};

type AdminItemsTabProps = {
  dashboardError: string | null;
  hasShops: boolean;
  palette: ThemePalette;
  shops: ShopRead[];
  selectedShopId: UUID | null;
  items: ShopItemRead[];
  itemCounts: ShopItemCounts | null;
  itemTotalCount: number;
  itemsLoading: boolean;
  itemsHasMore: boolean;
  itemsLoadingMore: boolean;
  refreshing: boolean;
  bottomPadding: number;
  itemSearch: string;
  filter: ItemFilter;
  form: ShopItemFormState;
  imageDraft: ShopItemImageDraft | null;
  editingItem: ShopItemRead | null;
  formVisible: boolean;
  savingItem: boolean;
  deletingItemId: UUID | null;
  allocatingItemId: UUID | null;
  viewMode: ItemWorkspaceMode;
  priceLoading: boolean;
  priceBootstrap: ShopBootstrapResponse | null;
  currentPriceItem:
  | (ShopBootstrapResponse["items"][number] & {
    current_price?: string | null;
  })
  | null;
  selectedPriceItemId: UUID | null;
  draftPrice: string;
  priceError: string | null;
  priceHelperText: string | null;
  savePriceDisabled: boolean;
  savingPrice: boolean;
  saveSelectedPriceDisabled?: boolean;
  savingSelectedPrice?: boolean;
  resolveItemPrice: (itemId: UUID, currentPrice?: string | null) => string;
  onRefresh: () => void;
  onSelectShop: (shopId: UUID) => void;
  onChangeSearch: (value: string) => void;
  onChangeFilter: (value: ItemFilter) => void;
  onLoadMore: () => void;
  onChangeForm: (values: ShopItemFormState) => void;
  onPickImage: () => void;
  onClearImage: () => void;
  onRemoveImage: () => void;
  onSubmit: () => void;
  onOpenCreate: (scope: AdminItemFormScope) => void;
  onEditItem: (item: ShopItemRead) => void;
  onCancelEdit: () => void;
  onDeleteItem: (item: ShopItemRead) => void;
  onToggleAllocation: (item: ShopItemRead) => void;
  onOpenPrices: () => void;
  onBackToItems: () => void;
  onChangeWorkspace: (mode: ManageableItemWorkspace) => void;
  onSelectPriceItem: (itemId: UUID, currentPrice?: string | null) => void;
  onChangeDraftPrice: (value: string) => void;
  onSaveSelectedPrice?: () => void;
  onSavePrice: () => void;
};

export type ItemFilter = AdminItemFilter;
export type ItemWorkspaceMode = AdminItemWorkspace;
type Tone = "primary" | "gold" | "danger" | "neutral";

const unitTypeOptions: {
  value: UnitType;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
}[] = [
    { value: UnitType.WEIGHT, label: "Weight", icon: "scale-balance" },
    { value: UnitType.COUNT, label: "Count", icon: "counter" },
  ];

const baseUnitOptions: { value: BaseUnit; label: string }[] = [
  { value: BaseUnit.KG, label: "KG" },
  { value: BaseUnit.UNIT, label: "Unit" },
];

const filterOptions: {
  value: ItemFilter;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
}[] = [
    { value: AdminItemFilter.All, label: "All", icon: "format-list-bulleted" },
    { value: AdminItemFilter.Allocated, label: "Allocated", icon: "link-variant" },
    { value: AdminItemFilter.Available, label: "Available", icon: "link-variant-off" },
    { value: AdminItemFilter.Catalogue, label: "Catalogue", icon: "shape-outline" },
    { value: AdminItemFilter.Shop, label: "Shop", icon: "storefront-outline" },
    { value: AdminItemFilter.Priced, label: "Priced", icon: "cash-check" },
    { value: AdminItemFilter.NeedsPrice, label: "Needs price", icon: "cash-clock" },
    { value: AdminItemFilter.StalePrice, label: "Stale price", icon: "calendar-alert" },
    { value: AdminItemFilter.Paused, label: "Paused", icon: "pause-circle-outline" },
  ];

const workspacePageOptions: {
  value: AdminItemWorkspace.Catalogue | AdminItemWorkspace.Shop | AdminItemWorkspace.Prices;
  label: string;
  detail: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
}[] = [
    { value: AdminItemWorkspace.Catalogue, label: "Catalogue", detail: "Global items", icon: "shape-outline" },
    { value: AdminItemWorkspace.Shop, label: "Shop items", detail: "Allocations", icon: "storefront-outline" },
    { value: AdminItemWorkspace.Prices, label: "Prices", detail: "Daily setup", icon: "cash-edit" },
  ];

const catalogueFilterSet = new Set<ItemFilter>([
  AdminItemFilter.All,
  AdminItemFilter.Allocated,
  AdminItemFilter.Available,
  AdminItemFilter.Paused,
]);

function toneColor(palette: ThemePalette, tone: Tone) {
  if (tone === "primary") {
    return { fg: palette.success, bg: palette.successSoft, border: palette.success };
  }
  if (tone === "gold") {
    return { fg: palette.cash, bg: palette.goldSoft, border: palette.gold };
  }
  if (tone === "danger") {
    return { fg: palette.danger, bg: palette.dangerSoft, border: palette.danger };
  }
  return { fg: palette.textSecondary, bg: palette.surfaceMuted, border: palette.border };
}

const SmallText = memo(function SmallText({
  children,
  color,
  numberOfLines,
}: {
  children: ReactNode;
  color: string;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={{ color, fontSize: 12, lineHeight: 17, fontWeight: "600", flexShrink: 1 }}
    >
      {children}
    </Text>
  );
});

const TitleText = memo(function TitleText({
  children,
  color,
  size = "md",
  numberOfLines,
}: {
  children: ReactNode;
  color: string;
  size?: "sm" | "md" | "lg";
  numberOfLines?: number;
}) {
  const fontSize = size === "lg" ? 22 : size === "sm" ? 15 : 18;
  return (
    <Text
      numberOfLines={numberOfLines}
      style={{ color, fontSize, lineHeight: fontSize + 6, fontWeight: "900", flexShrink: 1 }}
    >
      {children}
    </Text>
  );
});

const ActionButton = memo(function ActionButton({
  label,
  icon,
  onPress,
  palette,
  variant = "primary",
  disabled = false,
  loading = false,
  flex,
  fullWidth = false,
}: {
  label: string;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  onPress: () => void;
  palette: ThemePalette;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "success" | "warning" | "info";
  disabled?: boolean;
  loading?: boolean;
  flex?: number;
  fullWidth?: boolean;
}) {
  let backgroundColor = palette.card;
  let borderColor = palette.border;
  let textColor = palette.textPrimary;

  if (variant === "primary") {
    backgroundColor = palette.primary;
    borderColor = palette.primary;
    textColor = palette.onPrimary;
  } else if (variant === "success") {
    backgroundColor = palette.success;
    borderColor = palette.success;
    textColor = palette.onPrimary;
  } else if (variant === "warning") {
    backgroundColor = palette.warning;
    borderColor = palette.warning;
    textColor = palette.onCash;
  } else if (variant === "info") {
    backgroundColor = palette.primaryStrong;
    borderColor = palette.primaryStrong;
    textColor = palette.onPrimary;
  } else if (variant === "danger") {
    backgroundColor = palette.danger;
    borderColor = palette.danger;
    textColor = "#FFFFFF";
  } else if (variant === "ghost") {
    backgroundColor = "rgba(255,255,255,0.12)";
    borderColor = "rgba(255,255,255,0.42)";
    textColor = "#FFFFFF";
  }

  return (
    <TButton
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      flex={flex}
      width={fullWidth ? "100%" : undefined}
      minHeight={46}
      borderRadius={16}
      paddingHorizontal={14}
      backgroundColor={backgroundColor}
      borderColor={borderColor}
      borderWidth={1}
      opacity={disabled && !loading ? 0.6 : 1}
      pressStyle={{ opacity: 0.9, scale: 0.98 }}
    >
      {loading ? (
        <Spinner color={textColor} />
      ) : (
        <XStack alignItems="center" justifyContent="center" gap={7} minWidth={0}>
          {icon ? <MaterialCommunityIcons name={icon} size={17} color={textColor} /> : null}
          <Text numberOfLines={1} style={{ color: textColor, fontSize: 13, fontWeight: "900", flexShrink: 1 }}>
            {label}
          </Text>
        </XStack>
      )}
    </TButton>
  );
});

const Chip = memo(function Chip({
  label,
  icon,
  active = false,
  count,
  tone = "neutral",
  palette,
  onPress,
}: {
  label: string;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  active?: boolean;
  count?: number;
  tone?: Tone;
  palette: ThemePalette;
  onPress?: () => void;
}) {
  const colors = active ? toneColor(palette, tone === "neutral" ? "primary" : tone) : toneColor(palette, "neutral");
  const content = (
    <XStack alignItems="center" justifyContent="center" gap={6} minWidth={0}>
      {icon ? <MaterialCommunityIcons name={icon} size={14} color={colors.fg} /> : null}
      <Text numberOfLines={1} style={{ color: colors.fg, fontSize: 12, fontWeight: "900", flexShrink: 1 }}>
        {label}
      </Text>
      {typeof count === "number" ? (
        <Stack
          minWidth={22}
          height={22}
          borderRadius={99}
          alignItems="center"
          justifyContent="center"
          paddingHorizontal={6}
          backgroundColor={active ? palette.card : palette.backgroundElevated}
        >
          <Text style={{ color: colors.fg, fontSize: 11, fontWeight: "900" }}>{count}</Text>
        </Stack>
      ) : null}
    </XStack>
  );

  if (!onPress) {
    return (
      <Stack
        minHeight={34}
        borderRadius={99}
        paddingHorizontal={10}
        alignItems="center"
        justifyContent="center"
        backgroundColor={colors.bg}
        borderColor={colors.border}
        borderWidth={1}
      >
        {content}
      </Stack>
    );
  }

  return (
    <TButton
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      minHeight={42}
      borderRadius={99}
      paddingHorizontal={12}
      backgroundColor={colors.bg}
      borderColor={colors.border}
      borderWidth={1}
      pressStyle={{ opacity: 0.9, scale: 0.98 }}
    >
      {content}
    </TButton>
  );
});

const CompactIconButton = memo(function CompactIconButton({
  label,
  icon,
  onPress,
  palette,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  onPress: () => void;
  palette: ThemePalette;
}) {
  return (
    <TButton
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      width={44}
      height={44}
      borderRadius={22}
      padding={0}
      backgroundColor={palette.surfaceMuted}
      borderColor={palette.border}
      borderWidth={1}
      pressStyle={{ opacity: 0.9, scale: 0.96 }}
    >
      <MaterialCommunityIcons name={icon} size={18} color={palette.textMuted} />
    </TButton>
  );
});

const ImageActions = memo(function ImageActions({
  currentImageUri,
  hasImageDraft,
  palette,
  onPickImage,
  onClearImage,
  onRemoveImage,
}: {
  currentImageUri: string;
  hasImageDraft: boolean;
  palette: ThemePalette;
  onPickImage: () => void;
  onClearImage: () => void;
  onRemoveImage: () => void;
}) {
  return (
    <Card borderRadius={22} padding={12} borderWidth={1} borderColor={palette.border} backgroundColor={palette.surfaceMuted}>
      <XStack alignItems="center" justifyContent="center" gap={6}>
        <Stack width={112}>
          <ImagePreview uri={currentImageUri} palette={palette} />
        </Stack>
        <YStack flex={1} minWidth={0} gap={8}>
          <TitleText color={palette.textPrimary} size="sm">Item image</TitleText>
          <SmallText color={palette.textMuted}>Square 1:1 image. Stored in RustFS, not Postgres.</SmallText>
          <ActionButton
            label="Pick image"
            icon="image-edit-outline"
            onPress={onPickImage}
            palette={palette}
            variant="info"
            fullWidth
          />
          {hasImageDraft ? (
            <ActionButton
              label="Clear selected"
              icon="image-remove-outline"
              onPress={onClearImage}
              palette={palette}
              variant="warning"
              fullWidth
            />
          ) : null}
          {!hasImageDraft && currentImageUri ? (
            <ActionButton
              label="Remove image"
              icon="image-remove-outline"
              onPress={onRemoveImage}
              palette={palette}
              variant="danger"
              fullWidth
            />
          ) : null}
        </YStack>
      </XStack>
    </Card>
  );
});

const StatCard = memo(function StatCard({
  label,
  value,
  icon,
  tone,
  palette,
}: {
  label: string;
  value: number;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  tone: Tone;
  palette: ThemePalette;
}) {
  const colors = toneColor(palette, tone);
  return (
    <Card
      flex={1}
      minWidth={142}
      borderRadius={18}
      padding={13}
      borderWidth={1}
      borderColor={palette.border}
      backgroundColor={palette.card}
    >
      <YStack gap={8}>
        <Stack width={34} height={34} borderRadius={13} alignItems="center" justifyContent="center" backgroundColor={colors.bg}>
          <MaterialCommunityIcons name={icon} size={17} color={colors.fg} />
        </Stack>
        <Text style={{ color: palette.textPrimary, fontSize: 24, lineHeight: 28, fontWeight: "900" }}>{value}</Text>
        <SmallText color={palette.textMuted}>{label}</SmallText>
      </YStack>
    </Card>
  );
});

const ImagePreview = memo(function ImagePreview({ uri, palette }: { uri: string; palette: ThemePalette }) {
  if (!uri) {
    return (
      <Stack
        width="100%"
        aspectRatio={1}
        borderRadius={22}
        borderWidth={1}
        borderStyle="dashed"
        borderColor={palette.border}
        backgroundColor={palette.surfaceMuted}
        alignItems="center"
        justifyContent="center"
        gap={8}
      >
        <MaterialCommunityIcons name="image-plus" size={26} color={palette.textMuted} />
        <SmallText color={palette.textMuted}>1:1 image</SmallText>
      </Stack>
    );
  }

  return (
    <Stack width="100%" aspectRatio={1} borderRadius={22} overflow="hidden" borderWidth={1} borderColor={palette.border}>
      <Image source={authenticatedImageSource(uri)} contentFit="cover" style={{ width: "100%", height: "100%" }} />
    </Stack>
  );
});

const Field = memo(function Field({
  label,
  value,
  placeholder,
  errorText,
  helperText,
  palette,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  errorText?: string | null;
  helperText?: string | null;
  palette: ThemePalette;
  onChangeText: (value: string) => void;
}) {
  return (
    <YStack gap={7}>
      <Text
        style={{
          color: palette.textMuted,
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Input
        value={value}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted as never}
        onChangeText={onChangeText}
        minHeight={50}
        borderRadius={16}
        borderWidth={1}
        borderColor={errorText ? palette.danger : palette.border}
        backgroundColor={palette.surfaceMuted}
        color={palette.textPrimary}
        fontSize={15}
        fontWeight="700"
      />
      {errorText ? <SmallText color={palette.danger}>{errorText}</SmallText> : null}
      {!errorText && helperText ? <SmallText color={palette.textMuted}>{helperText}</SmallText> : null}
    </YStack>
  );
});

const AttributeEditor = memo(function AttributeEditor({
  value,
  errorText,
  palette,
  onChangeText,
}: {
  value: string;
  errorText?: string | null;
  palette: ThemePalette;
  onChangeText: (value: string) => void;
}) {
  const parsed = useMemo(() => {
    if (!value.trim()) {
      return {};
    }
    try {
      const candidate = JSON.parse(value);
      return candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, string | number | boolean | null>)
        : {};
    } catch {
      return {};
    }
  }, [value]);
  const rows = Object.entries(parsed);
  const writeObject = (next: Record<string, string | number | boolean | null>) => {
    onChangeText(Object.keys(next).length ? JSON.stringify(next, null, 2) : "");
  };

  return (
    <YStack gap={9}>
      <Text
        style={{
          color: palette.textMuted,
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        Custom attributes
      </Text>
      <YStack gap={8}>
        {rows.map(([key, rowValue]) => (
          <XStack key={key} gap={8} alignItems="center">
            <Input
              value={key}
              placeholder="Key"
              placeholderTextColor={palette.textMuted as never}
              onChangeText={(nextKey) => {
                const cleanKey = nextKey.trim();
                const next = { ...parsed };
                delete next[key];
                if (cleanKey) {
                  next[cleanKey] = rowValue;
                }
                writeObject(next);
              }}
              flex={1}
              minHeight={46}
              borderRadius={14}
              borderWidth={1}
              borderColor={palette.border}
              backgroundColor={palette.surfaceMuted}
              color={palette.textPrimary}
              fontSize={13}
              fontWeight="700"
            />
            <Input
              value={rowValue == null ? "" : String(rowValue)}
              placeholder="Value"
              placeholderTextColor={palette.textMuted as never}
              onChangeText={(nextValue) => writeObject({ ...parsed, [key]: nextValue })}
              flex={1}
              minHeight={46}
              borderRadius={14}
              borderWidth={1}
              borderColor={palette.border}
              backgroundColor={palette.surfaceMuted}
              color={palette.textPrimary}
              fontSize={13}
              fontWeight="700"
            />
            <CompactIconButton
              label={`Remove ${key}`}
              icon="close"
              onPress={() => {
                const next = { ...parsed };
                delete next[key];
                writeObject(next);
              }}
              palette={palette}
            />
          </XStack>
        ))}
      </YStack>
      <ActionButton
        label="Add attribute"
        icon="plus-circle-outline"
        onPress={() => {
          const index = rows.length + 1;
          writeObject({ ...parsed, [`attribute_${index}`]: "" });
        }}
        palette={palette}
        variant="success"
        fullWidth
      />
      {errorText ? <SmallText color={palette.danger}>{errorText}</SmallText> : <SmallText color={palette.textMuted}>Optional structured item details for filtering, notes, and future customization.</SmallText>}
    </YStack>
  );
});

const ToggleButton = memo(function ToggleButton({
  label,
  icon,
  active,
  palette,
  onPress,
}: {
  label: string;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  active: boolean;
  palette: ThemePalette;
  onPress: () => void;
}) {
  return (
    <TButton
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      flex={1}
      minHeight={46}
      minWidth={108}
      borderRadius={99}
      paddingHorizontal={12}
      borderWidth={1}
      borderColor={active ? palette.items : palette.border}
      backgroundColor={active ? palette.itemsSoft : palette.surfaceMuted}
      pressStyle={{ opacity: 0.9, scale: 0.98 }}
    >
      <XStack alignItems="center" justifyContent="center" gap={6} minWidth={0}>
        {icon ? <MaterialCommunityIcons name={icon} size={15} color={active ? palette.itemsStrong : palette.textMuted} /> : null}
        <Text
          numberOfLines={1}
          style={{ color: active ? palette.itemsStrong : palette.textSecondary, fontSize: 12, fontWeight: "900" }}
        >
          {label}
        </Text>
      </XStack>
    </TButton>
  );
});

const EmptyPanel = memo(function EmptyPanel({
  title,
  subtitle,
  icon,
  palette,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  palette: ThemePalette;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card borderRadius={22} padding={18} borderWidth={1} borderColor={palette.border} backgroundColor={palette.card}>
      <YStack gap={12} alignItems="flex-start">
        <Stack width={48} height={48} borderRadius={18} alignItems="center" justifyContent="center" backgroundColor={palette.itemsSoft}>
          <MaterialCommunityIcons name={icon} size={24} color={palette.itemsStrong} />
        </Stack>
        <YStack gap={4}>
          <TitleText color={palette.textPrimary} size="sm">{title}</TitleText>
          <SmallText color={palette.textMuted}>{subtitle}</SmallText>
        </YStack>
        {actionLabel && onAction ? (
          <ActionButton label={actionLabel} icon="plus-circle-outline" onPress={onAction} palette={palette} variant="success" />
        ) : null}
      </YStack>
    </Card>
  );
});

const LoadingItemSkeleton = memo(function LoadingItemSkeleton({ palette }: { palette: ThemePalette }) {
  return (
    <Card borderRadius={22} padding={12} borderWidth={1} borderColor={palette.border} backgroundColor={palette.card}>
      <XStack gap={12}>
        <Stack width={82} aspectRatio={1} borderRadius={22} backgroundColor={palette.surfaceMuted} />
        <YStack flex={1} gap={10} justifyContent="center">
          <Stack width="72%" height={18} borderRadius={99} backgroundColor={palette.surfaceMuted} />
          <Stack width="52%" height={13} borderRadius={99} backgroundColor={palette.surfaceMuted} />
          <XStack gap={8}>
            <Stack width={86} height={28} borderRadius={99} backgroundColor={palette.surfaceMuted} />
            <Stack width={74} height={28} borderRadius={99} backgroundColor={palette.surfaceMuted} />
          </XStack>
        </YStack>
      </XStack>
    </Card>
  );
});

const ShopItemCard = memo(function ShopItemCard({
  item,
  palette,
  deleting,
  allocating,
  onEdit,
  onDelete,
  onToggleAllocation,
}: {
  item: ShopItemRead;
  palette: ThemePalette;
  deleting: boolean;
  allocating: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAllocation: () => void;
}) {
  const imageUri = item.image_path ? resolveApiUrl(item.image_path) : "";
  const isShopItem = item.scope === ItemScope.Shop;
  const isAllocated = item.allocated || isShopItem;
  const statusLabel = isShopItem ? "Shop" : isAllocated ? "Allocated" : "Available";
  const priceLabel = !isAllocated
    ? "Allocate first"
    : item.price_status === PriceStatus.Current && item.current_price
      ? `Today Rs. ${toMoneyString(item.current_price)}`
      : item.price_status === PriceStatus.Stale && item.current_price
        ? `Stale Rs. ${toMoneyString(item.current_price)}`
        : "Price pending";
  const priceIcon = !isAllocated
    ? "lock-outline"
    : item.price_status === PriceStatus.Current
      ? "cash-check"
      : item.price_status === PriceStatus.Stale
        ? "calendar-alert"
        : "cash-clock";

  return (
    <Card
      borderRadius={24}
      padding={12}
      borderWidth={1}
      borderColor={palette.border}
      backgroundColor={palette.card}
    >
      <XStack gap={12} alignItems="flex-start">
        <Stack width={84}>
          <ImagePreview uri={imageUri} palette={palette} />
        </Stack>
        <YStack flex={1} minWidth={0} gap={10}>
          <XStack alignItems="flex-start" gap={8}>
            <YStack flex={1} minWidth={0} gap={2}>
              <TitleText color={palette.textPrimary} size="sm" numberOfLines={1}>{item.name}</TitleText>
              <SmallText color={palette.textMuted} numberOfLines={1}>
                {item.tamil_name || "Tamil name missing"} · {item.unit_type === UnitType.WEIGHT ? "Weight" : "Count"} · {item.base_unit}
              </SmallText>
            </YStack>
            <Chip label={statusLabel} tone={isAllocated ? "primary" : "gold"} active palette={palette} />
          </XStack>

          <XStack flexWrap="wrap" gap={8}>
            <Chip
              label={priceLabel}
              icon={priceIcon}
              tone={isAllocated && item.price_status === PriceStatus.Current ? "primary" : item.price_status === PriceStatus.Stale ? "danger" : "gold"}
              active
              palette={palette}
            />
            <Chip
              label={item.is_active ? "Active" : "Paused"}
              icon={item.is_active ? "check-circle-outline" : "pause-circle-outline"}
              tone={item.is_active ? "primary" : "danger"}
              active
              palette={palette}
            />
            {!isShopItem ? (
              <Chip
                label="Catalogue"
                icon="shape-outline"
                tone="neutral"
                active
                palette={palette}
              />
            ) : null}
          </XStack>

          <XStack gap={8}>
            <ActionButton
              label={isShopItem ? "Edit" : "Edit catalogue"}
              icon="pencil-outline"
              onPress={onEdit}
              palette={palette}
              variant="info"
              flex={1}
            />
            {item.can_delete ? (
              <ActionButton
                label="Delete"
                icon="trash-can-outline"
                onPress={onDelete}
                palette={palette}
                variant="danger"
                loading={deleting}
                flex={1}
              />
            ) : (
              <ActionButton
                label={item.is_active ? "Pause/edit" : "Activate/edit"}
                icon={item.is_active ? "pause-circle-outline" : "check-circle-outline"}
                onPress={onEdit}
                palette={palette}
                variant="secondary"
                flex={1}
              />
            )}
          </XStack>

          {!isShopItem ? (
            <YStack gap={8}>
              <ActionButton
                label={isAllocated ? "Remove from shop" : "Allocate to shop"}
                icon={isAllocated ? "link-variant-off" : "link-variant"}
                onPress={onToggleAllocation}
                palette={palette}
                variant={isAllocated ? "warning" : "success"}
                loading={allocating}
              />
              <SmallText color={palette.textMuted}>
                {isAllocated
                  ? "This catalogue item is active for this shop once priced."
                  : "Allocate this catalogue item before it appears in pricing or billing."}
              </SmallText>
            </YStack>
          ) : null}
        </YStack>
      </XStack>
    </Card>
  );
});

const ErrorBanner = memo(function ErrorBanner({
  dashboardError,
  hasShops,
  palette,
}: {
  dashboardError: string | null;
  hasShops: boolean;
  palette: ThemePalette;
}) {
  if (!dashboardError || !hasShops) {
    return null;
  }

  return (
    <Card borderRadius={18} padding={13} borderWidth={1} borderColor={palette.gold} backgroundColor={palette.goldSoft}>
      <XStack alignItems="center" gap={9}>
        <MaterialCommunityIcons name="wifi-alert" size={18} color={palette.cash} />
        <SmallText color={palette.textPrimary}>{dashboardError}</SmallText>
      </XStack>
    </Card>
  );
});

const AdminItemsPriceView = memo(function AdminItemsPriceView({
  selectedShop,
  palette,
  priceLoading,
  priceBootstrap,
  currentPriceItem,
  selectedPriceItemId,
  draftPrice,
  priceError,
  priceHelperText,
  savePriceDisabled,
  savingPrice,
  saveSelectedPriceDisabled,
  savingSelectedPrice,
  resolveItemPrice,
  onBackToItems,
  onSelectPriceItem,
  onChangeDraftPrice,
  onSaveSelectedPrice,
  onSavePrice,
}: {
  selectedShop: ShopRead;
  palette: ThemePalette;
  priceLoading: boolean;
  priceBootstrap: ShopBootstrapResponse | null;
  currentPriceItem:
  | (ShopBootstrapResponse["items"][number] & {
    current_price?: string | null;
  })
  | null;
  selectedPriceItemId: UUID | null;
  draftPrice: string;
  priceError: string | null;
  priceHelperText: string | null;
  savePriceDisabled: boolean;
  savingPrice: boolean;
  saveSelectedPriceDisabled?: boolean;
  savingSelectedPrice?: boolean;
  resolveItemPrice: (itemId: UUID, currentPrice?: string | null) => string;
  onBackToItems: () => void;
  onSelectPriceItem: (itemId: UUID, currentPrice?: string | null) => void;
  onChangeDraftPrice: (value: string) => void;
  onSaveSelectedPrice?: () => void;
  onSavePrice: () => void;
}) {
  const summaryText =
    currentPriceItem && draftPrice
      ? `${currentPriceItem.item_name} will update from ${currentPriceItem.current_price ? `Rs. ${toMoneyString(currentPriceItem.current_price)}` : "not set"
      } to Rs. ${draftPrice}.`
      : "Select an allocated item and enter a price to preview the update.";

  return (
    <YStack gap={14}>
      <Card borderRadius={26} padding={16} borderWidth={1} borderColor={palette.border} backgroundColor={palette.card}>
        <YStack gap={14}>
          <XStack alignItems="flex-start" gap={12}>
            <ActionButton
              label="Back"
              icon="arrow-left"
              onPress={onBackToItems}
              palette={palette}
              variant="secondary"
            />
            <YStack flex={1} minWidth={0} gap={4}>
              <TitleText color={palette.textPrimary}>Price setup</TitleText>
              <SmallText color={palette.textMuted}>
                Set prices for allocated items in {selectedShop.name}. This is a full page flow, not a popup.
              </SmallText>
            </YStack>
          </XStack>

          <XStack flexWrap="wrap" gap={8}>
            <Chip label="1. Allocate" icon="link-variant" active tone="primary" palette={palette} />
            <Chip label="2. Price" icon="cash-edit" active tone="gold" palette={palette} />
            <Chip label="3. Billing" icon="receipt-text-outline" active tone="neutral" palette={palette} />
          </XStack>
        </YStack>
      </Card>

      {priceLoading ? (
        <Card borderRadius={22} padding={18} borderWidth={1} borderColor={palette.border} backgroundColor={palette.card}>
          <XStack alignItems="center" justifyContent="center" gap={10}>
            <Spinner color={palette.items} />
            <SmallText color={palette.textMuted}>Loading allocated items...</SmallText>
          </XStack>
        </Card>
      ) : priceBootstrap && priceBootstrap.items.length === 0 ? (
        <EmptyPanel
          title="Allocate items first"
          subtitle="This shop has no allocated items yet. Go back, allocate catalogue items, then return here to set prices."
          icon="link-variant-off"
          palette={palette}
          actionLabel="Back to items"
          onAction={onBackToItems}
        />
      ) : priceBootstrap && currentPriceItem ? (
        <YStack gap={12}>
          <Card borderRadius={24} padding={14} borderWidth={1} borderColor={palette.border} backgroundColor={palette.card}>
            <YStack gap={12}>
              <XStack justifyContent="space-between" alignItems="center" gap={10}>
                <YStack flex={1} minWidth={0} gap={3}>
                  <TitleText color={palette.textPrimary} size="sm">Choose item</TitleText>
                  <SmallText color={palette.textMuted}>All allocated active items must have valid prices.</SmallText>
                </YStack>
                <Chip label={`${priceBootstrap.items.length} items`} active tone="primary" palette={palette} />
              </XStack>

              <Stack height={Math.min(420, Math.max(96, priceBootstrap.items.length * 78))}>
                <FlatList
                  data={priceBootstrap.items}
                  keyExtractor={(item) => item.item_id}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  ItemSeparatorComponent={() => <Stack height={8} />}
                  renderItem={({ item }) => {
                    const resolvedPrice = resolveItemPrice(item.item_id, item.current_price);
                    const selected = item.item_id === selectedPriceItemId;
                    return (
                      <Card
                        key={item.item_id}
                        borderRadius={18}
                        padding={12}
                        borderWidth={1}
                        borderColor={selected ? palette.items : palette.border}
                        backgroundColor={selected ? palette.itemsSoft : palette.surfaceMuted}
                        onPress={() => onSelectPriceItem(item.item_id, item.current_price)}
                        pressStyle={{ opacity: 0.9, scale: 0.99 }}
                      >
                        <XStack alignItems="center" justifyContent="space-between" gap={10}>
                          <YStack flex={1} minWidth={0} gap={2}>
                            <TitleText color={palette.textPrimary} size="sm" numberOfLines={1}>{item.item_name}</TitleText>
                            <SmallText color={palette.textMuted}>
                              {item.item_tamil_name ?? "Tamil name missing"} · {item.base_unit.toUpperCase()}
                            </SmallText>
                          </YStack>
                          <Chip
                            label={resolvedPrice ? `Rs. ${toMoneyString(resolvedPrice)}` : "No price"}
                            icon={resolvedPrice ? "cash-check" : "cash-clock"}
                            active
                            tone={resolvedPrice ? "primary" : "gold"}
                            palette={palette}
                          />
                        </XStack>
                      </Card>
                    );
                  }}
                />
              </Stack>
            </YStack>
          </Card>

          <Card borderRadius={24} padding={14} borderWidth={1} borderColor={palette.border} backgroundColor={palette.card}>
            <YStack gap={13}>
              <YStack gap={3}>
                <TitleText color={palette.textPrimary} size="sm">{currentPriceItem.item_name}</TitleText>
                <SmallText color={palette.textMuted}>
                  Current: {currentPriceItem.current_price ? `Rs. ${toMoneyString(currentPriceItem.current_price)}` : "Not set"} · Unit: {currentPriceItem.base_unit.toUpperCase()}
                </SmallText>
              </YStack>

              <SearchField
                value={draftPrice}
                placeholder="Enter price"
                palette={palette}
                onChangeText={onChangeDraftPrice}
                accessibilityLabel="Item price"
              />
              {priceHelperText ? <SmallText color={palette.textMuted}>{priceHelperText}</SmallText> : null}
              {priceError ? <SmallText color={palette.danger}>{priceError}</SmallText> : null}

              <Card borderRadius={18} padding={12} borderWidth={1} borderColor={palette.border} backgroundColor={palette.surfaceMuted}>
                <SmallText color={palette.textSecondary}>{summaryText}</SmallText>
              </Card>

              <XStack gap={10} flexWrap="wrap">
                <ActionButton label="Back" icon="arrow-left" onPress={onBackToItems} palette={palette} variant="secondary" flex={1} />
                {onSaveSelectedPrice ? (
                  <ActionButton
                    label="Save row"
                    icon="cash-check"
                    onPress={onSaveSelectedPrice}
                    loading={savingSelectedPrice}
                    disabled={saveSelectedPriceDisabled}
                    palette={palette}
                    variant="primary"
                    flex={1}
                  />
                ) : null}
                <ActionButton
                  label="Save all"
                  icon="content-save-outline"
                  onPress={onSavePrice}
                  loading={savingPrice}
                  disabled={savePriceDisabled}
                  palette={palette}
                  variant="primary"
                  flex={1}
                />
              </XStack>
            </YStack>
          </Card>
        </YStack>
      ) : (
        <EmptyPanel
          title="Prices unavailable"
          subtitle="Select a shop and refresh if price setup does not load."
          icon="cash-remove"
          palette={palette}
        />
      )}
    </YStack>
  );
});

const WorkspaceNav = memo(function WorkspaceNav({
  viewMode,
  selectedShop,
  totalCount,
  filterCounts,
  palette,
  onChangeWorkspace,
  onOpenPrices,
}: {
  viewMode: ItemWorkspaceMode;
  selectedShop: ShopRead | null;
  totalCount: number;
  filterCounts: ShopItemCounts;
  palette: ThemePalette;
  onChangeWorkspace: (mode: ManageableItemWorkspace) => void;
  onOpenPrices: () => void;
}) {
  return (
    <YStack gap={10}>
      <XStack alignItems="center" justifyContent="space-between" gap={10}>
        <YStack flex={1} minWidth={0} gap={2}>
          <TitleText color={palette.textPrimary}>Items</TitleText>
          <SmallText color={palette.textMuted} numberOfLines={1}>
            {viewMode === AdminItemWorkspace.Catalogue ? "Global catalogue" : selectedShop?.name ?? "Select a shop"}
          </SmallText>
        </YStack>
        <Chip label={`${totalCount || filterCounts.all} total`} active tone="primary" palette={palette} />
      </XStack>

      <XStack flexWrap="wrap" gap={9}>
        {workspacePageOptions.map((option) => {
          const active = viewMode === option.value;
          const disabled = option.value === AdminItemWorkspace.Prices && !selectedShop;
          const colors = active ? toneColor(palette, "primary") : toneColor(palette, "neutral");
          return (
            <TButton
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => {
                if (option.value === AdminItemWorkspace.Prices) {
                  onOpenPrices();
                  return;
                }
                onChangeWorkspace(option.value);
              }}
              flex={1}
              minWidth={144}
              minHeight={72}
              borderRadius={18}
              padding={12}
              borderWidth={1}
              borderColor={colors.border}
              backgroundColor={colors.bg}
              opacity={disabled ? 0.58 : 1}
              pressStyle={{ opacity: 0.9, scale: 0.98 }}
            >
              <XStack alignItems="center" gap={10} minWidth={0}>
                <Stack
                  width={38}
                  height={38}
                  borderRadius={14}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor={active ? palette.card : palette.backgroundElevated}
                >
                  <MaterialCommunityIcons name={option.icon} size={19} color={colors.fg} />
                </Stack>
                <YStack flex={1} minWidth={0} gap={1}>
                  <Text numberOfLines={1} style={{ color: colors.fg, fontSize: 13, fontWeight: "900" }}>
                    {option.label}
                  </Text>
                  <SmallText color={active ? colors.fg : palette.textMuted} numberOfLines={1}>{option.detail}</SmallText>
                </YStack>
              </XStack>
            </TButton>
          );
        })}
      </XStack>
    </YStack>
  );
});

const ShopSelectorPanel = memo(function ShopSelectorPanel({
  visible,
  shops,
  selectedShopId,
  selectedShop,
  palette,
  onSelectShop,
}: {
  visible: boolean;
  shops: ShopRead[];
  selectedShopId: UUID | null;
  selectedShop: ShopRead | null;
  palette: ThemePalette;
  onSelectShop: (shopId: UUID) => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <YStack gap={8}>
      <XStack alignItems="center" justifyContent="space-between" gap={10}>
        <TitleText color={palette.textPrimary} size="sm">Shop</TitleText>
        <Chip label={selectedShop?.name ?? "Required"} active tone={selectedShop ? "primary" : "gold"} palette={palette} />
      </XStack>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {shops.map((shop) => (
          <Chip
            key={shop.id}
            label={shop.name}
            icon="storefront-outline"
            active={selectedShopId === shop.id}
            palette={palette}
            onPress={() => onSelectShop(shop.id)}
          />
        ))}
      </ScrollView>
    </YStack>
  );
});

const ItemsStatsRow = memo(function ItemsStatsRow({
  allocatedCount,
  missingPriceCount,
  stalePriceCount,
  availableCount,
  palette,
}: {
  allocatedCount: number;
  missingPriceCount: number;
  stalePriceCount: number;
  availableCount: number;
  palette: ThemePalette;
}) {
  return (
    <XStack flexWrap="wrap" gap={10}>
      <StatCard label="Allocated" value={allocatedCount} icon="link-variant" tone="primary" palette={palette} />
      <StatCard label="Need price" value={missingPriceCount} icon="cash-clock" tone={missingPriceCount ? "danger" : "primary"} palette={palette} />
      <StatCard label="Stale" value={stalePriceCount} icon="calendar-alert" tone={stalePriceCount ? "danger" : "primary"} palette={palette} />
      <StatCard label="Available" value={availableCount} icon="link-variant-off" tone="gold" palette={palette} />
    </XStack>
  );
});

const ItemEditorPanel = memo(function ItemEditorPanel({
  formIsOpen,
  editingShopOverride,
  editingItem,
  form,
  imageDraft,
  currentImageUri,
  englishNameError,
  tamilNameError,
  attributesError,
  itemSubmitDisabled,
  savingItem,
  palette,
  onCancelEdit,
  onPickImage,
  onClearImage,
  onRemoveImage,
  onChangeForm,
  onSubmit,
}: {
  formIsOpen: boolean;
  editingShopOverride: boolean;
  editingItem: ShopItemRead | null;
  form: ShopItemFormState;
  imageDraft: ShopItemImageDraft | null;
  currentImageUri: string;
  englishNameError: string | null;
  tamilNameError: string | null;
  attributesError: string | null;
  itemSubmitDisabled: boolean;
  savingItem: boolean;
  palette: ThemePalette;
  onCancelEdit: () => void;
  onPickImage: () => void;
  onClearImage: () => void;
  onRemoveImage: () => void;
  onChangeForm: (values: ShopItemFormState) => void;
  onSubmit: () => void;
}) {
  if (!formIsOpen) {
    return null;
  }

  return (
    <Card
      borderRadius={22}
      padding={16}
      borderWidth={1}
      borderColor={palette.border}
      backgroundColor={palette.card}
    >
      <YStack gap={15}>
        <XStack alignItems="flex-start" gap={12}>
          <YStack flex={1} minWidth={0} gap={4}>
            <TitleText color={palette.textPrimary}>
              {editingShopOverride ? "Customize shop item" : editingItem ? "Update item" : "Add item"}
            </TitleText>
            <SmallText color={palette.textMuted}>
              {editingItem
                ? editingItem.scope === ItemScope.Global
                  ? editingShopOverride
                    ? "Shop-only display settings"
                    : "Global catalogue fields"
                  : "Shop-owned item fields"
                : form.targetScope === AdminItemFormScope.Catalogue
                  ? "Reusable catalogue item"
                  : "Shop-owned item"}
            </SmallText>
          </YStack>
          <CompactIconButton label="Close item form" icon="close" onPress={onCancelEdit} palette={palette} />
        </XStack>

        <YStack gap={14}>
          {editingShopOverride ? (
            <Card borderRadius={18} padding={12} borderWidth={1} borderColor={palette.border} backgroundColor={palette.surfaceMuted}>
              <SmallText color={palette.textMuted}>
                This shop keeps the catalogue image and unit setup. Change shared media or units from Catalogue.
              </SmallText>
            </Card>
          ) : (
            <ImageActions
              currentImageUri={currentImageUri}
              hasImageDraft={Boolean(imageDraft)}
              palette={palette}
              onPickImage={onPickImage}
              onClearImage={onClearImage}
              onRemoveImage={onRemoveImage}
            />
          )}

          <YStack gap={12}>
            <Field
              label="English name"
              value={form.name}
              placeholder="Chicken curry cut"
              errorText={englishNameError}
              helperText="Shown on admin, pricing, billing, and receipts."
              onChangeText={(name) => onChangeForm({ ...form, name })}
              palette={palette}
            />
            <Field
              label="Tamil name"
              value={form.tamilName}
              placeholder="தமிழ் பெயர்"
              errorText={tamilNameError}
              helperText="Required for Tamil billing and receipts."
              onChangeText={(tamilName) => onChangeForm({ ...form, tamilName })}
              palette={palette}
            />

            {editingShopOverride ? null : (
              <>
                <XStack gap={8}>
                  {unitTypeOptions.map((option) => (
                    <ToggleButton
                      key={option.value}
                      label={option.label}
                      icon={option.icon}
                      active={form.unitType === option.value}
                      onPress={() =>
                        onChangeForm({
                          ...form,
                          unitType: option.value,
                          baseUnit: option.value === UnitType.WEIGHT ? BaseUnit.KG : BaseUnit.UNIT,
                        })
                      }
                      palette={palette}
                    />
                  ))}
                </XStack>

                <XStack gap={8}>
                  {baseUnitOptions.map((option) => (
                    <ToggleButton
                      key={option.value}
                      label={option.label}
                      active={form.baseUnit === option.value}
                      onPress={() =>
                        onChangeForm({
                          ...form,
                          baseUnit: option.value,
                          unitType: option.value === BaseUnit.KG ? UnitType.WEIGHT : UnitType.COUNT,
                        })
                      }
                      palette={palette}
                    />
                  ))}
                </XStack>
              </>
            )}

            <ToggleButton
              label={form.isActive ? "Active for billing" : "Paused"}
              icon={form.isActive ? "check-circle-outline" : "pause-circle-outline"}
              active={form.isActive}
              onPress={() => onChangeForm({ ...form, isActive: !form.isActive })}
              palette={palette}
            />

            <AttributeEditor
              value={form.customAttributesText}
              errorText={attributesError}
              onChangeText={(customAttributesText) => onChangeForm({ ...form, customAttributesText })}
              palette={palette}
            />

            <XStack gap={10}>
              <ActionButton
                label="Cancel"
                icon="close-circle-outline"
                onPress={onCancelEdit}
                palette={palette}
                variant="warning"
                flex={1}
              />
              <ActionButton
                label={editingShopOverride ? "Save customization" : editingItem ? "Save item" : "Create item"}
                icon={editingItem ? "content-save-outline" : "plus-circle-outline"}
                onPress={onSubmit}
                loading={savingItem}
                disabled={itemSubmitDisabled}
                palette={palette}
                variant="primary"
                flex={1}
              />
            </XStack>
          </YStack>
        </YStack>
      </YStack>
    </Card>
  );
});

const ItemsToolbar = memo(function ItemsToolbar({
  title,
  subtitle,
  viewMode,
  itemSearch,
  filter,
  filterCounts,
  visibleFilterOptions,
  palette,
  onChangeSearch,
  onChangeFilter,
  onOpenCreate,
}: {
  title: string;
  subtitle: string;
  viewMode: ItemWorkspaceMode;
  itemSearch: string;
  filter: ItemFilter;
  filterCounts: ShopItemCounts;
  visibleFilterOptions: typeof filterOptions;
  palette: ThemePalette;
  onChangeSearch: (value: string) => void;
  onChangeFilter: (value: ItemFilter) => void;
  onOpenCreate: (scope: AdminItemFormScope) => void;
}) {
  return (
    <YStack gap={10}>
      <XStack alignItems="flex-start" justifyContent="space-between" gap={10}>
        <YStack flex={1} minWidth={0} gap={3}>
          <TitleText color={palette.textPrimary}>{title}</TitleText>
          <SmallText color={palette.textMuted}>{subtitle}</SmallText>
        </YStack>
        <ActionButton
          label={viewMode === AdminItemWorkspace.Catalogue ? "Add catalogue" : "Add item"}
          icon="plus-circle-outline"
          onPress={() =>
            onOpenCreate(
              viewMode === AdminItemWorkspace.Catalogue ? AdminItemFormScope.Catalogue : AdminItemFormScope.Shop,
            )
          }
          palette={palette}
          variant="success"
        />
      </XStack>

      <Card borderRadius={18} padding={12} borderWidth={1} borderColor={palette.border} backgroundColor={palette.card}>
        <YStack gap={12}>
          <SearchField
            value={itemSearch}
            placeholder="Search English, Tamil, unit"
            palette={palette}
            onChangeText={onChangeSearch}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
            {visibleFilterOptions.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                icon={option.icon}
                count={filterCounts[option.value]}
                active={filter === option.value}
                palette={palette}
                onPress={() => onChangeFilter(option.value)}
              />
            ))}
          </ScrollView>
        </YStack>
      </Card>
    </YStack>
  );
});

export function AdminItemsTab({
  dashboardError,
  hasShops,
  palette,
  shops,
  selectedShopId,
  items,
  itemCounts,
  itemTotalCount,
  itemsLoading,
  itemsHasMore,
  itemsLoadingMore,
  refreshing,
  bottomPadding,
  itemSearch,
  filter,
  form,
  imageDraft,
  editingItem,
  formVisible,
  savingItem,
  deletingItemId,
  allocatingItemId,
  viewMode,
  priceLoading,
  priceBootstrap,
  currentPriceItem,
  selectedPriceItemId,
  draftPrice,
  priceError,
  priceHelperText,
  savePriceDisabled,
  savingPrice,
  saveSelectedPriceDisabled,
  savingSelectedPrice,
  resolveItemPrice,
  onRefresh,
  onSelectShop,
  onChangeSearch,
  onChangeFilter,
  onLoadMore,
  onChangeForm,
  onPickImage,
  onClearImage,
  onRemoveImage,
  onSubmit,
  onOpenCreate,
  onEditItem,
  onCancelEdit,
  onDeleteItem,
  onToggleAllocation,
  onOpenPrices,
  onBackToItems,
  onChangeWorkspace,
  onSelectPriceItem,
  onChangeDraftPrice,
  onSaveSelectedPrice,
  onSavePrice,
}: AdminItemsTabProps) {
  const selectedShop = useMemo(() => shops.find((s) => s.id === selectedShopId) || null, [shops, selectedShopId]);
  const hasSelectedShop = Boolean(selectedShop);

  const workspaceNeedsShop =
    viewMode === AdminItemWorkspace.Shop || viewMode === AdminItemWorkspace.Prices;

  const computedFilterCounts = useMemo(() => ({
    all: items.length,
    allocated: items.filter((item) => item.allocated || item.scope === ItemScope.Shop).length,
    available: items.filter((item) => item.scope === ItemScope.Global && !item.allocated).length,
    catalogue: items.filter((item) => item.scope === ItemScope.Global).length,
    shop: items.filter((item) => item.scope === ItemScope.Shop).length,
    priced: items.filter((item) => item.available_for_billing && item.price_status === PriceStatus.Current).length,
    needs_price: items.filter((item) => item.available_for_billing && item.price_status === PriceStatus.Missing).length,
    stale_price: items.filter((item) => item.available_for_billing && item.price_status === PriceStatus.Stale).length,
    paused: items.filter((item) => !item.is_active).length,
  }), [items]);

  const filterCounts = itemCounts || computedFilterCounts;

  const visibleFilterOptions = useMemo(() => {
    if (viewMode === AdminItemWorkspace.Catalogue) {
      return filterOptions.filter((opt) => catalogueFilterSet.has(opt.value));
    }
    return filterOptions.filter((opt) => opt.value !== AdminItemFilter.Catalogue);
  }, [viewMode]);

  const itemsTitle = viewMode === AdminItemWorkspace.Catalogue ? "Catalogue items" : "Shop allocations";
  const itemsSubtitle =
    viewMode === AdminItemWorkspace.Catalogue
      ? "Global master data for all shops."
      : `Managing items specifically for ${selectedShop?.name || "shop"}.`;

  const visibleItems = items;
  const itemListData = visibleItems;

  const englishNameError = form.name.length > 0 && form.name.length < 3 ? "Name too short" : null;
  const tamilNameError =
    form.tamilName.length > 0 && form.tamilName.length < 3 ? "Tamil name too short" : null;
  const attributesError = null;

  const itemSubmitDisabled =
    savingItem || !form.name || form.name.length < 3 || (form.tamilName.length > 0 && form.tamilName.length < 3);

  const allocatedCount = filterCounts.allocated;
  const missingPriceCount = filterCounts.needs_price;
  const stalePriceCount = filterCounts.stale_price;
  const availableCount = filterCounts.available;

  const currentImageUri = imageDraft ? imageDraft.uri : editingItem?.image_path ? resolveApiUrl(editingItem.image_path) : "";

  const header = useMemo(() => (
    <YStack gap={14} marginBottom={itemListData.length > 0 ? 12 : 0}>
      <ErrorBanner dashboardError={dashboardError} hasShops={hasShops} palette={palette} />
      <WorkspaceNav
        viewMode={viewMode}
        selectedShop={selectedShop}
        totalCount={itemTotalCount}
        filterCounts={filterCounts}
        palette={palette}
        onChangeWorkspace={onChangeWorkspace}
        onOpenPrices={onOpenPrices}
      />
      <ShopSelectorPanel
        visible={workspaceNeedsShop}
        shops={shops}
        selectedShopId={selectedShopId}
        selectedShop={selectedShop}
        palette={palette}
        onSelectShop={onSelectShop}
      />

      {workspaceNeedsShop && !selectedShop ? (
        <EmptyPanel
          title="Select a shop first"
          subtitle="Choose a shop to manage allocations, shop-owned items, or prices."
          icon="store-alert-outline"
          palette={palette}
        />
      ) : (
        <YStack gap={14}>
          {viewMode === AdminItemWorkspace.Prices && selectedShop ? (
            <AdminItemsPriceView
              selectedShop={selectedShop}
              palette={palette}
              priceLoading={priceLoading}
              priceBootstrap={priceBootstrap}
              currentPriceItem={currentPriceItem}
              selectedPriceItemId={selectedPriceItemId}
              draftPrice={draftPrice}
              priceError={priceError}
              priceHelperText={priceHelperText}
              savePriceDisabled={savePriceDisabled}
              savingPrice={savingPrice}
              saveSelectedPriceDisabled={saveSelectedPriceDisabled}
              savingSelectedPrice={savingSelectedPrice}
              resolveItemPrice={resolveItemPrice}
              onBackToItems={onBackToItems}
              onSelectPriceItem={onSelectPriceItem}
              onChangeDraftPrice={onChangeDraftPrice}
              onSaveSelectedPrice={onSaveSelectedPrice}
              onSavePrice={onSavePrice}
            />
          ) : (
            <>
              <ItemsStatsRow
                allocatedCount={allocatedCount}
                missingPriceCount={missingPriceCount}
                stalePriceCount={stalePriceCount}
                availableCount={availableCount}
                palette={palette}
              />
              <ItemEditorPanel
                formIsOpen={formVisible}
                editingShopOverride={false}
                editingItem={editingItem}
                form={form}
                imageDraft={imageDraft}
                currentImageUri={currentImageUri}
                englishNameError={englishNameError}
                tamilNameError={tamilNameError}
                attributesError={attributesError}
                itemSubmitDisabled={itemSubmitDisabled}
                savingItem={savingItem}
                palette={palette}
                onCancelEdit={onCancelEdit}
                onPickImage={onPickImage}
                onClearImage={onClearImage}
                onRemoveImage={onRemoveImage}
                onChangeForm={onChangeForm}
                onSubmit={onSubmit}
              />
              <ItemsToolbar
                title={itemsTitle}
                subtitle={itemsSubtitle}
                viewMode={viewMode}
                itemSearch={itemSearch}
                filter={filter}
                filterCounts={filterCounts}
                visibleFilterOptions={visibleFilterOptions}
                palette={palette}
                onChangeSearch={onChangeSearch}
                onChangeFilter={onChangeFilter}
                onOpenCreate={onOpenCreate}
              />
            </>
          )}
        </YStack>
      )}
    </YStack>
  ), [
    dashboardError,
    hasShops,
    palette,
    viewMode,
    selectedShop,
    itemTotalCount,
    filterCounts,
    onChangeWorkspace,
    onOpenPrices,
    workspaceNeedsShop,
    shops,
    selectedShopId,
    onSelectShop,
    priceLoading,
    priceBootstrap,
    currentPriceItem,
    selectedPriceItemId,
    draftPrice,
    priceError,
    priceHelperText,
    savePriceDisabled,
    savingPrice,
    saveSelectedPriceDisabled,
    savingSelectedPrice,
    resolveItemPrice,
    onBackToItems,
    onSelectPriceItem,
    onChangeDraftPrice,
    onSaveSelectedPrice,
    onSavePrice,
    allocatedCount,
    missingPriceCount,
    stalePriceCount,
    availableCount,
    formVisible,
    editingItem,
    form,
    imageDraft,
    currentImageUri,
    englishNameError,
    tamilNameError,
    attributesError,
    itemSubmitDisabled,
    savingItem,
    onCancelEdit,
    onPickImage,
    onClearImage,
    onRemoveImage,
    onChangeForm,
    onSubmit,
    itemsTitle,
    itemsSubtitle,
    itemSearch,
    filter,
    visibleFilterOptions,
    onChangeSearch,
    onChangeFilter,
    onOpenCreate,
    itemListData.length,
  ]);

  return (
    <FlatList
      data={itemListData}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ShopItemCard
          item={item}
          palette={palette}
          deleting={deletingItemId === item.id}
          allocating={allocatingItemId === item.id}
          onEdit={() => onEditItem(item)}
          onDelete={() => onDeleteItem(item)}
          onToggleAllocation={() => onToggleAllocation(item)}
        />
      )}
      ItemSeparatorComponent={() => <Stack height={12} />}
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: bottomPadding }}
      refreshControl={<RefreshControl refreshing={refreshing || itemsLoading} onRefresh={onRefresh} tintColor={palette.items} />}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListFooterComponent={
        itemsHasMore ? (
          <YStack marginTop={12}>
            <ActionButton
              label="Load more items"
              icon="chevron-down-circle-outline"
              onPress={onLoadMore}
              loading={itemsLoadingMore}
              palette={palette}
              variant="secondary"
              fullWidth
            />
          </YStack>
        ) : null
      }
      ListEmptyComponent={
        itemsLoading && items.length === 0 ? (
          <YStack gap={12}>
            <LoadingItemSkeleton palette={palette} />
            <LoadingItemSkeleton palette={palette} />
            <LoadingItemSkeleton palette={palette} />
          </YStack>
        ) : items.length === 0 ? (
          <EmptyPanel
            title={items.length === 0 ? "No items available yet" : "No matching items"}
            subtitle={
              items.length === 0
                ? "Create catalogue data or add the first shop item."
                : "Try a different filter, allocate an item, or clear the search text."
            }
            icon="playlist-remove"
            palette={palette}
            actionLabel={items.length === 0 ? "Add item" : undefined}
            onAction={
              items.length === 0
                ? () =>
                  onOpenCreate(
                    viewMode === AdminItemWorkspace.Catalogue
                      ? AdminItemFormScope.Catalogue
                      : AdminItemFormScope.Shop,
                  )
                : undefined
            }
          />
        ) : itemsLoading ? (
          <Card borderRadius={18} padding={12} backgroundColor={palette.surfaceMuted} borderWidth={0}>
            <XStack justifyContent="center" alignItems="center" gap={10}>
              <Spinner color={palette.items} />
              <SmallText color={palette.textMuted}>Refreshing items...</SmallText>
            </XStack>
          </Card>
        ) : null
      }
    />
  );
}
