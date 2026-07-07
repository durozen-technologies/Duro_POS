import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Button as TButton,
  Card,
  Input,
  Separator,
  ScrollView,
  Spinner,
  Text,
  View as Stack,
  XStack,
  YStack,
} from "tamagui";

import { Screen } from "@/components/ui/screen";
import { useShopTranslation } from "@/hooks/use-shop-translation";
import { PrinterSetupScreenProps } from "@/navigation/types";
import {
  connectPrinterDevice,
  getPrinterSupportState,
  loadBluetoothPrinters,
  loadUsbPrinters,
  printTestReceipt,
} from "@/services/printer-service";
import { usePrinterStore } from "@/store/printer-store";
import { PrinterDevice } from "@/types/printer";

type IoniconProps = ComponentProps<typeof Ionicons>;

const warnedIoniconNames = new Set<string>();

function SafeIonicon({ name, ...props }: IoniconProps) {
  const hasIcon = Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, name);
  const resolvedName = hasIcon ? name : "help-circle-outline";

  if (__DEV__ && !hasIcon && !warnedIoniconNames.has(name)) {
    warnedIoniconNames.add(name);
    console.warn(`Invalid Ionicons icon "${name}", using "help-circle-outline" fallback.`);
  }

  return <Ionicons name={resolvedName as IoniconProps["name"]} {...props} />;
}

// ─── Design Tokens ────────────────────────────────────────────────────────────

const C = {
  dark: "#0C1A12",
  darkCard: "#14261C",
  darkSurface: "rgba(255,255,255,0.07)",
  accent: "#10B981",
  accentDeep: "#059669",
  success: "#22C55E",
  successBg: "#F0FDF4",
  successBorder: "#BBF7D0",
  successIcon: "#166534",
  warning: "#F59E0B",
  warningBg: "#FFFBEB",
  warningBorder: "#FDE68A",
  warningIcon: "#92400E",
  btBlue: "#2563EB",
  btBlueBg: "#DBEAFE",
  usbAmber: "#B45309",
  usbAmberBg: "#FEF3C7",
  manualPurple: "#7C3AED",
  manualPurpleBg: "#EDE9FE",
  surface: "#F7FAF8",
  card: "#FFFFFF",
  border: "#E6EFE9",
  ink: "#0F172A",
  muted: "#4B6356",
  mutedLight: "#94A3B8",
  white: "#FFFFFF",
};

// ─── Micro Components ─────────────────────────────────────────────────────────

type TextTone = "default" | "muted" | "soft" | "accent" | "inverse" | "inverseMuted";

function toneColor(tone: TextTone) {
  if (tone === "muted") return C.muted;
  if (tone === "soft") return C.mutedLight;
  if (tone === "accent") return C.accent;
  if (tone === "inverse") return C.white;
  if (tone === "inverseMuted") return "rgba(255,255,255,0.66)";
  return C.ink;
}

function EyebrowText({ children, tone = "soft" }: { children: ReactNode; tone?: TextTone }) {
  return (
    <Text
      style={{
        color: toneColor(tone),
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 1.5,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
}

function TitleText({
  children,
  tone = "default",
  size = "md",
  numberOfLines,
}: {
  children: ReactNode;
  tone?: TextTone;
  size?: "sm" | "md" | "lg";
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={{
        color: toneColor(tone),
        fontSize: size === "lg" ? 22 : size === "sm" ? 14 : 18,
        fontWeight: "800",
        lineHeight: size === "lg" ? 28 : size === "sm" ? 19 : 24,
        flexShrink: 1,
        includeFontPadding: false,
      }}
    >
      {children}
    </Text>
  );
}

function BodyText({
  children,
  tone = "muted",
  size = "md",
  numberOfLines,
  textAlign,
}: {
  children: ReactNode;
  tone?: TextTone;
  size?: "sm" | "md";
  numberOfLines?: number;
  textAlign?: "left" | "center";
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={{
        color: toneColor(tone),
        fontSize: size === "sm" ? 11 : 12,
        lineHeight: size === "sm" ? 17 : 19,
        textAlign,
        flexShrink: 1,
        includeFontPadding: false,
      }}
    >
      {children}
    </Text>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <EyebrowText tone="soft">{children}</EyebrowText>;
}

function StatusDot({ tone }: { tone: "success" | "warning" | "neutral" | "connecting" }) {
  const color =
    tone === "success" ? C.success
      : tone === "warning" ? C.warning
        : tone === "connecting" ? C.accent
          : C.mutedLight;
  return <Stack width={8} height={8} borderRadius={99} style={{ backgroundColor: color }} />;
}

function PulseRing({ active }: { active: boolean }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { anim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 2, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, anim]);
  if (!active) return null;
  return (
    <Animated.View
      style={{
        position: "absolute", width: 8, height: 8, borderRadius: 99,
        backgroundColor: C.accent,
        transform: [{ scale: anim }],
        opacity: anim.interpolate({ inputRange: [1, 2], outputRange: [0.7, 0] }),
      }}
    />
  );
}

function TransportChip({ transport, size = "sm" }: { transport: "bluetooth" | "usb"; size?: "sm" | "md" }) {
  const isBt = transport === "bluetooth";
  const s = size === "sm" ? 13 : 16;
  return (
    <XStack
      alignItems="center"
      gap={4}
      paddingHorizontal={size === "sm" ? 8 : 10}
      paddingVertical={size === "sm" ? 3 : 5}
      borderRadius={99}
      style={{ backgroundColor: isBt ? C.btBlueBg : C.usbAmberBg }}
    >
      <SafeIonicon name={isBt ? "bluetooth" : "hardware-chip-outline"} size={s} color={isBt ? C.btBlue : C.usbAmber} />
      <Text
        style={{
          fontSize: size === "sm" ? 9 : 11,
          fontWeight: "700",
          letterSpacing: 1,
          color: isBt ? C.btBlue : C.usbAmber,
        }}
      >
        {isBt ? "BT" : "USB"}
      </Text>
    </XStack>
  );
}

function SectionDivider({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <XStack alignItems="center" gap={10} marginVertical={4}>
      <Separator flex={1} borderColor={C.border} />
      <XStack alignItems="center" gap={6}>
        <SafeIonicon name={icon} size={12} color={C.mutedLight} />
        <EyebrowText tone="soft">{label}</EyebrowText>
      </XStack>
      <Separator flex={1} borderColor={C.border} />
    </XStack>
  );
}

type SetupActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary";
  size?: "md" | "sm";
  flex?: number;
  alignSelf?: "flex-start" | "stretch";
};

function SetupActionButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "md",
  flex,
  alignSelf = "stretch",
}: SetupActionButtonProps) {
  const isSecondary = variant === "secondary";

  return (
    <TButton
      onPress={onPress}
      disabled={disabled || loading}
      flex={flex}
      alignSelf={alignSelf}
      minHeight={size === "sm" ? 40 : 50}
      borderRadius={size === "sm" ? 12 : 14}
      paddingHorizontal={size === "sm" ? 14 : 18}
      backgroundColor={isSecondary ? C.card : C.accent}
      borderColor={isSecondary ? C.border : C.accent}
      borderWidth={1}
      opacity={disabled && !loading ? 0.65 : 1}
      pressStyle={{ opacity: 0.88, scale: 0.98 }}
    >
      {loading ? (
        <Spinner color={isSecondary ? C.ink : C.white} />
      ) : (
        <Text
          style={{
            color: isSecondary ? C.ink : C.white,
            fontSize: size === "sm" ? 12 : 14,
            fontWeight: "700",
            textAlign: "center",
          }}
        >
          {label}
        </Text>
      )}
    </TButton>
  );
}

type StatTileProps = {
  label: string;
  value: string;
  ok: boolean;
};

function StatTile({ label, value, ok }: StatTileProps) {
  return (
    <Card flex={1} borderRadius={14} padding={12} style={{ backgroundColor: C.darkSurface }}>
      <EyebrowText tone="inverseMuted">{label}</EyebrowText>
      <XStack alignItems="center" gap={6} marginTop={6}>
        <StatusDot tone={ok ? "success" : "warning"} />
        <Text style={{ fontSize: 13, fontWeight: "800", color: C.white }} numberOfLines={1}>
          {value}
        </Text>
      </XStack>
    </Card>
  );
}

type SetupStepProps = {
  index: number;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

function SetupStep({ index, title, description, icon }: SetupStepProps) {
  return (
    <XStack gap={12} alignItems="flex-start">
      <Stack
        width={36}
        height={36}
        borderRadius={12}
        alignItems="center"
        justifyContent="center"
        style={{ backgroundColor: index === 1 ? C.btBlueBg : index === 2 ? C.usbAmberBg : C.successBg }}
      >
        <SafeIonicon
          name={icon}
          size={17}
          color={index === 1 ? C.btBlue : index === 2 ? C.usbAmber : C.accentDeep}
        />
      </Stack>
      <YStack flex={1} minWidth={0} gap={2}>
        <XStack alignItems="center" gap={6}>
          <EyebrowText tone="soft">0{index}</EyebrowText>
          <TitleText size="sm">{title}</TitleText>
        </XStack>
        <BodyText size="sm">{description}</BodyText>
      </YStack>
    </XStack>
  );
}

// ─── Printer Device Card ──────────────────────────────────────────────────────

type PrinterDeviceCardProps = {
  device: PrinterDevice;
  index: number;
  isSelected: boolean;
  isConnecting: boolean;
  selectedLabel: string;
  availableLabel: string;
  connectLabel: string;
  reconnectLabel: string;
  onConnect: (device: PrinterDevice) => void;
};

function PrinterDeviceCard({
  device, index, isSelected, isConnecting,
  selectedLabel, availableLabel, connectLabel, reconnectLabel, onConnect,
}: PrinterDeviceCardProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const detail = device.transport === "bluetooth"
    ? device.address
    : `${device.vendorId ?? "?"} / ${device.productId ?? "?"}`;

  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ transform: [{ scale: scale }] }}>
      <Card
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={() => onConnect(device)}
        accessibilityRole="button"
        accessibilityLabel={`${isSelected ? reconnectLabel : connectLabel}: ${device.name}`}
        accessibilityState={{ selected: isSelected, busy: isConnecting }}
        borderRadius={16}
        borderWidth={1}
        padding={14}
        pressStyle={{ opacity: 0.92 }}
        style={{
          borderColor: isSelected ? C.successBorder : C.border,
          backgroundColor: isSelected ? C.successBg : C.card,
        }}
      >
        {/* Row 1 – Identity */}
        <XStack alignItems="center" gap={12}>
          <Stack
            width={40}
            height={40}
            borderRadius={12}
            alignItems="center"
            justifyContent="center"
            style={{ backgroundColor: isSelected ? "#DCFCE7" : C.surface }}
          >
            <Text style={{ fontSize: 14, fontWeight: "800", color: isSelected ? C.accentDeep : C.muted }}>
              {String(index + 1).padStart(2, "0")}
            </Text>
          </Stack>

          <YStack flex={1} minWidth={0} gap={2}>
            <XStack alignItems="center" gap={6} flexWrap="wrap">
              <TitleText size="sm" numberOfLines={1}>
                {device.name}
              </TitleText>
              <TransportChip transport={device.transport} />
            </XStack>
            <Text style={{ fontSize: 11, fontFamily: "monospace", color: C.muted, lineHeight: 17 }} numberOfLines={1}>
              {detail}
            </Text>
            {device.transport === "usb" && device.manufacturerName ? (
              <BodyText size="sm" tone="soft">{device.manufacturerName}</BodyText>
            ) : null}
          </YStack>

          {/* Status indicator */}
          <YStack alignItems="flex-end" gap={4}>
            <Stack position="relative" width={8} height={8}>
              <StatusDot tone={isSelected ? "success" : isConnecting ? "connecting" : "neutral"} />
              <PulseRing active={isConnecting} />
            </Stack>
            <Text style={{
              fontSize: 9, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase",
              color: isSelected ? C.accentDeep : C.mutedLight,
            }}>
              {isSelected ? selectedLabel : availableLabel}
            </Text>
          </YStack>
        </XStack>

        {/* Row 2 – Action */}
        <XStack
          marginTop={12}
          paddingTop={12}
          borderTopWidth={1}
          alignItems="center"
          gap={8}
          style={{ borderColor: isSelected ? C.successBorder : C.border }}
        >
          {isConnecting ? (
            <>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={{ fontSize: 12, fontWeight: "700", color: C.accent }}>
                {isSelected ? reconnectLabel : connectLabel}…
              </Text>
            </>
          ) : (
            <>
              <SafeIonicon name={isSelected ? "refresh" : "link"} size={14} color={C.accent} />
              <Text style={{ fontSize: 12, fontWeight: "700", color: C.accent }}>
                {isSelected ? reconnectLabel : connectLabel}
              </Text>
            </>
          )}
        </XStack>
      </Card>
    </Animated.View>
  );
}

// ─── Discovery Section ────────────────────────────────────────────────────────

type DiscoverySectionProps = {
  title: string;
  subtitle: string;
  transport: "bluetooth" | "usb";
  devices: PrinterDevice[];
  selectedId?: string | null;
  connectingId?: string | null;
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
  scanningLabel: string;
  selectedLabel: string;
  availableLabel: string;
  connectLabel: string;
  reconnectLabel: string;
  refreshLabel: string;
  onRefresh: () => void;
  onConnect: (device: PrinterDevice) => void;
};

function DiscoverySection({
  title, subtitle, transport, devices, selectedId, connectingId,
  loading, emptyTitle, emptyDescription, scanningLabel,
  selectedLabel, availableLabel, connectLabel, reconnectLabel,
  refreshLabel, onRefresh, onConnect,
}: DiscoverySectionProps) {
  const isBt = transport === "bluetooth";

  return (
    <YStack gap={12}>
      {/* Header */}
      <Card borderRadius={16} borderWidth={1} padding={14} style={{ backgroundColor: C.card, borderColor: C.border }}>
        <XStack alignItems="flex-start" justifyContent="space-between" gap={12}>
          <XStack alignItems="flex-start" gap={12} flex={1} minWidth={0}>
            <Stack
              width={42}
              height={42}
              borderRadius={13}
              alignItems="center"
              justifyContent="center"
              marginTop={1}
              style={{ backgroundColor: isBt ? C.btBlueBg : C.usbAmberBg }}
            >
              <SafeIonicon name={isBt ? "bluetooth" : "hardware-chip-outline"} size={20} color={isBt ? C.btBlue : C.usbAmber} />
            </Stack>
            <YStack flex={1} minWidth={0} gap={3}>
              <TitleText size="sm" numberOfLines={1}>{title}</TitleText>
              <BodyText size="sm">{subtitle}</BodyText>
            </YStack>
          </XStack>

          {devices.length > 0 && (
            <Stack
              minWidth={28}
              height={28}
              borderRadius={99}
              alignItems="center"
              justifyContent="center"
              paddingHorizontal={8}
              style={{ backgroundColor: C.successBg }}
            >
              <Text style={{ fontSize: 11, fontWeight: "800", color: C.accentDeep }}>{devices.length}</Text>
            </Stack>
          )}
        </XStack>

        <XStack marginTop={12}>
          <SetupActionButton
            label={refreshLabel}
            onPress={onRefresh}
            loading={loading}
            size="sm"
            variant="secondary"
            flex={1}
          />
        </XStack>
      </Card>

      {/* Content */}
      {loading && devices.length === 0 ? (
        <Card style={{
          alignItems: "center", justifyContent: "center",
          borderRadius: 12, borderWidth: 1, borderStyle: "dashed",
          borderColor: C.border, backgroundColor: C.surface,
          padding: 28,
        }}>
          <YStack alignItems="center" gap={8}>
            <ActivityIndicator color={C.accent} size="small" />
            <BodyText size="sm" textAlign="center">{scanningLabel}</BodyText>
          </YStack>
        </Card>
      ) : devices.length === 0 ? (
        <Card style={{
          alignItems: "center", justifyContent: "center",
          borderRadius: 12, borderWidth: 1, borderStyle: "dashed",
          borderColor: C.border, backgroundColor: C.surface,
          padding: 28,
        }}>
          <SafeIonicon name="search-outline" size={28} color={C.mutedLight} />
          <YStack marginTop={8} gap={4} alignItems="center">
            <TitleText size="sm">{emptyTitle}</TitleText>
            <BodyText size="sm" tone="soft" textAlign="center">{emptyDescription}</BodyText>
          </YStack>
        </Card>
      ) : (
        <YStack gap={8}>
          {devices.map((device, index) => (
            <PrinterDeviceCard
              key={device.id}
              device={device}
              index={index}
              isSelected={selectedId === device.id}
              isConnecting={connectingId === device.id}
              selectedLabel={selectedLabel}
              availableLabel={availableLabel}
              connectLabel={connectLabel}
              reconnectLabel={reconnectLabel}
              onConnect={onConnect}
            />
          ))}
        </YStack>
      )}
    </YStack>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export function PrinterSetupScreen({ navigation }: PrinterSetupScreenProps) {
  const { t } = useShopTranslation();
  const preferredPrinter = usePrinterStore((s) => s.preferredPrinter);
  const setPreferredPrinter = usePrinterStore((s) => s.setPreferredPrinter);
  const clearPreferredPrinter = usePrinterStore((s) => s.clearPreferredPrinter);

  const [bluetoothDevices, setBluetoothDevices] = useState<PrinterDevice[]>([]);
  const [usbDevices, setUsbDevices] = useState<PrinterDevice[]>([]);
  const [loadingBluetooth, setLoadingBluetooth] = useState(false);
  const [loadingUsb, setLoadingUsb] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [printingTest, setPrintingTest] = useState(false);
  const [manualBluetoothName, setManualBluetoothName] = useState("Thermal Printer");
  const [manualBluetoothAddress, setManualBluetoothAddress] = useState("");
  const [manualFormOpen, setManualFormOpen] = useState(false);

  const printerSupport = getPrinterSupportState();
  const bluetoothLabel = t("common.bluetooth");
  const usbLabel = t("common.usb");
  const preferredPrinterLabel = preferredPrinter
    ? `${preferredPrinter.transport === "bluetooth" ? bluetoothLabel : usbLabel} – ${preferredPrinter.name}`
    : null;
  const supportedChannels =
    printerSupport.bluetooth && printerSupport.usb
      ? `${bluetoothLabel} ${t("common.and")} ${usbLabel}`
      : printerSupport.bluetooth ? bluetoothLabel : usbLabel;

  const discoveredDeviceCount = bluetoothDevices.length + usbDevices.length;
  const savedPrinterDetail = preferredPrinter
    ? preferredPrinter.transport === "bluetooth"
      ? preferredPrinter.address
      : `${preferredPrinter.vendorId ?? "?"} / ${preferredPrinter.productId ?? "?"}`
    : null;
  const manualBluetoothConnectId = `bluetooth:${manualBluetoothAddress.trim().toUpperCase()}`;

  const connectionModeValue = useMemo(() => {
    if (!printerSupport.supported) return t("common.fallbackOnly");
    return t("common.androidNativeBuild");
  }, [printerSupport.supported, t]);
  const setupSteps = [
    {
      icon: "power-outline" as const,
      title: t("printer.setupStepOneTitle"),
      description: t("printer.setupStepOneDescription"),
    },
    {
      icon: "sync-outline" as const,
      title: t("printer.setupStepTwoTitle"),
      description: t("printer.setupStepTwoDescription"),
    },
    {
      icon: "receipt-outline" as const,
      title: t("printer.setupStepThreeTitle"),
      description: t("printer.setupStepThreeDescription"),
    },
  ];

  useEffect(() => {
    let cancelled = false;

    if (!printerSupport.supported) return;
    if (printerSupport.bluetooth) {
      setLoadingBluetooth(true);
      void loadBluetoothPrinters()
        .then((devices) => {
          if (!cancelled) {
            setBluetoothDevices(devices);
          }
        })
        .catch((e) => Alert.alert(t("printer.bluetoothAccessFailedTitle"), `${e}`))
        .finally(() => {
          if (!cancelled) {
            setLoadingBluetooth(false);
          }
        });
    }
    if (printerSupport.usb) {
      setLoadingUsb(true);
      void loadUsbPrinters()
        .then((devices) => {
          if (!cancelled) {
            setUsbDevices(devices);
          }
        })
        .catch((e) => Alert.alert(t("printer.usbAccessFailedTitle"), `${e}`))
        .finally(() => {
          if (!cancelled) {
            setLoadingUsb(false);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [printerSupport.bluetooth, printerSupport.supported, printerSupport.usb, t]);

  async function refreshBluetoothPrinters() {
    if (!printerSupport.bluetooth) {
      Alert.alert(t("printer.bluetoothModuleUnavailableTitle"), printerSupport.reason ?? t("printer.bluetoothModuleUnavailableMessage"));
      return;
    }
    try { setLoadingBluetooth(true); setBluetoothDevices(await loadBluetoothPrinters()); }
    catch (e) { Alert.alert(t("printer.bluetoothAccessFailedTitle"), `${e}`); }
    finally { setLoadingBluetooth(false); }
  }

  async function refreshUsbPrinters() {
    if (!printerSupport.usb) {
      Alert.alert(t("printer.usbModuleUnavailableTitle"), printerSupport.reason ?? t("printer.usbModuleUnavailableMessage"));
      return;
    }
    try { setLoadingUsb(true); setUsbDevices(await loadUsbPrinters()); }
    catch (e) { Alert.alert(t("printer.usbAccessFailedTitle"), `${e}`); }
    finally { setLoadingUsb(false); }
  }

  function handleManualBluetoothConnect() {
    const address = manualBluetoothAddress.trim().toUpperCase();
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(address)) {
      Alert.alert(t("printer.enterMacTitle"), t("printer.enterMacMessage"));
      return;
    }
    void handleConnect({
      id: `bluetooth:${address}`, transport: "bluetooth",
      name: manualBluetoothName.trim() || "Thermal Printer",
      address, deviceName: manualBluetoothName.trim() || "Thermal Printer",
    });
  }

  async function handleConnect(device: PrinterDevice) {
    try {
      setConnectingId(device.id);
      await connectPrinterDevice(device);
      setPreferredPrinter(device);
      Alert.alert(
        t("common.printerReady"),
        t("printer.connectionReadyMessage", {
          deviceName: device.name,
          transport: device.transport === "bluetooth" ? bluetoothLabel : usbLabel,
        }),
      );
    } catch (e) { Alert.alert(t("printer.connectionFailedTitle"), `${e}`); }
    finally { setConnectingId(null); }
  }

  async function handleTestPrint() {
    if (!preferredPrinter) {
      Alert.alert(t("printer.selectPrinterFirstTitle"), t("printer.selectPrinterFirstMessage"));
      return;
    }
    try {
      setPrintingTest(true);
      await printTestReceipt(preferredPrinter);
      Alert.alert(t("printer.testSentTitle"), t("printer.testSentMessage"));
    } catch (e) { Alert.alert(t("printer.testFailedTitle"), `${e}`); }
    finally { setPrintingTest(false); }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Screen scroll={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        {/* ═══ PRINTER STATUS CARD ═══════════════════════════════════════════ */}
        <YStack paddingHorizontal={20} marginTop={4}>
          <Card
            borderRadius={12}
            borderWidth={1}
            padding={16}
            style={{
              backgroundColor: preferredPrinter ? C.successBg : C.warningBg,
              borderColor: preferredPrinter ? C.successBorder : C.warningBorder,
            }}
          >
            <XStack alignItems="flex-start" gap={12}>
              <Stack
                width={44}
                height={44}
                borderRadius={14}
                alignItems="center"
                justifyContent="center"
                style={{ backgroundColor: preferredPrinter ? "#DCFCE7" : "#FEF3C7" }}
              >
                <SafeIonicon
                  name={preferredPrinter ? "checkmark-circle" : "alert-circle-outline"}
                  size={22}
                  color={preferredPrinter ? C.successIcon : C.warningIcon}
                />
              </Stack>
              <YStack flex={1} minWidth={0} gap={7}>
                <XStack alignItems="flex-start" justifyContent="space-between" gap={10}>
                  <YStack flex={1} minWidth={0} gap={2}>
                    <EyebrowText tone={preferredPrinter ? "accent" : "soft"}>{t("common.savedPrinter")}</EyebrowText>
                    <TitleText size="sm" numberOfLines={1}>
                      {preferredPrinter ? (preferredPrinterLabel ?? t("common.savedPrinter")) : t("printer.noPrinterSavedYet")}
                    </TitleText>
                  </YStack>
                  {preferredPrinter ? <TransportChip transport={preferredPrinter.transport} size="md" /> : null}
                </XStack>
                <BodyText size="sm" numberOfLines={2}>
                  {preferredPrinter
                    ? `${savedPrinterDetail ?? ""}${savedPrinterDetail ? " · " : ""}${t("printer.connectionReadyMessage", { deviceName: preferredPrinter.name, transport: preferredPrinter.transport === "bluetooth" ? bluetoothLabel : usbLabel })}`
                    : t("printer.noPrinterSavedDescription")}
                </BodyText>
                <XStack alignItems="center" gap={6}>
                  <StatusDot tone={preferredPrinter ? "success" : "warning"} />
                  <Text
                    style={{
                      color: preferredPrinter ? C.successIcon : C.warningIcon,
                      fontSize: 11,
                      fontWeight: "800",
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                    numberOfLines={1}
                  >
                    {preferredPrinter ? t("common.printerReady") : t("printer.noPrinterSavedYet")}
                  </Text>
                </XStack>
              </YStack>
            </XStack>
          </Card>
        </YStack>

        {/* ═══ BLUETOOTH DISCOVERY ═══════════════════════════════════════════ */}
        <YStack paddingHorizontal={20} marginTop={16}>
          <DiscoverySection
            title={t("printer.bluetoothPrinters")}
            subtitle={t("printer.bluetoothPrintersDescription")}
            transport="bluetooth"
            devices={bluetoothDevices}
            selectedId={preferredPrinter?.id}
            connectingId={connectingId}
            loading={loadingBluetooth}
            emptyTitle={t("printer.noBluetoothPrintersFound")}
            emptyDescription={t("printer.noBluetoothPrintersFoundDescription")}
            scanningLabel={t("printer.scanningPrinters")}
            selectedLabel={t("common.selected")}
            availableLabel={t("common.available")}
            connectLabel={t("action.connectPrinter")}
            reconnectLabel={t("action.reconnectPrinter")}
            refreshLabel={t("action.refreshBluetoothPrinters")}
            onRefresh={() => void refreshBluetoothPrinters()}
            onConnect={(device) => void handleConnect(device)}
          />
        </YStack>

        {/* ═══ ACTION BUTTONS ═════════════════════════════════════════════════ */}
        <YStack paddingHorizontal={20} marginTop={16} gap={8}>
          <XStack gap={8}>
            <SetupActionButton
              label={t("action.printTestSlip")}
              onPress={() => void handleTestPrint()}
              loading={printingTest}
              disabled={!preferredPrinter}
              flex={1}
            />
            <SetupActionButton
              label={t("action.forgetPrinter")}
              onPress={clearPreferredPrinter}
              disabled={!preferredPrinter}
              variant="secondary"
              flex={1}
            />
          </XStack>
          <SetupActionButton
            label={t("action.backToBilling")}
            onPress={() => navigation.goBack()}
            variant="secondary"
          />
        </YStack>

      </ScrollView>
    </Screen>
  );
}
