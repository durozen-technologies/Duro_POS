import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  adminElevation,
  adminPressOpacity,
  adminPressScale,
  adminRadii,
  adminSpacing,
  adminTypography,
} from "../admin-dashboard-theme";
import type { ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";

type PriceActionKey = "purchaseRate" | "updatePrice" | "retailerPrice";

type PriceAction = {
  key: PriceActionKey;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  backgroundColor: string;
  textColor: string;
  onPress: () => void;
};

type AdminPriceActionsFabProps = {
  palette: ThemePalette;
  bottom: number;
  onPurchaseRate: () => void;
  onUpdatePrice: () => void;
  onRetailerPrice: () => void;
};

const MAIN_SIZE = 56;
const MINI_SIZE = 48;
const ORBIT_RADIUS = 116;
/** Degrees from straight up, fanning toward the left (upper-left quadrant). */
const ACTION_ANGLES = [20, 55, 90] as const;
/** Room for the longest action label chip ("Purchase Rate") without truncation. */
const LABEL_CHIP_WIDTH = 168;
const MAX_ACTION_ANGLE = Math.max(...ACTION_ANGLES);
const MIN_ACTION_ANGLE = Math.min(...ACTION_ANGLES);
const STAGE_WIDTH =
  MAIN_SIZE / 2 +
  ORBIT_RADIUS * Math.sin((MAX_ACTION_ANGLE * Math.PI) / 180) +
  MINI_SIZE +
  LABEL_CHIP_WIDTH +
  adminSpacing.md;
const STAGE_HEIGHT =
  MAIN_SIZE / 2 +
  ORBIT_RADIUS * Math.cos((MIN_ACTION_ANGLE * Math.PI) / 180) +
  MINI_SIZE / 2 +
  adminSpacing.md;
const OPEN_MS = 320;
const CLOSE_MS = 220;
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

function orbitOffset(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: -radius * Math.sin(rad),
    y: -radius * Math.cos(rad),
  };
}

function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  return reduceMotion;
}

type MainFabButtonProps = {
  open: boolean;
  palette: ThemePalette;
  progress: Animated.Value;
  onPress: () => void;
};

const MainFabButton = memo(function MainFabButton({ open, palette, progress, onPress }: MainFabButtonProps) {
  const mainScale = useRef(new Animated.Value(1)).current;
  const mainOpacity = useRef(new Animated.Value(1)).current;

  const ringScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 4.5],
    extrapolate: "clamp",
  });
  const ringOpacity = progress.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 0.16, 0],
    extrapolate: "clamp",
  });
  const iconCross = progress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [1, 0, 0],
    extrapolate: "clamp",
  });
  const mainIconRotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "90deg"],
  });
  const mainIconScale = progress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [1, 0.5, 0],
    extrapolate: "clamp",
  });
  const closeCross = progress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0, 1],
    extrapolate: "clamp",
  });
  const closeIconRotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["-90deg", "0deg"],
  });
  const closeIconScale = progress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0.5, 1],
    extrapolate: "clamp",
  });

  const onPressIn = useCallback(() => {
    Animated.parallel([
      Animated.timing(mainScale, {
        toValue: adminPressScale,
        duration: 100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(mainOpacity, {
        toValue: adminPressOpacity,
        duration: 100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [mainOpacity, mainScale]);

  const onPressOut = useCallback(() => {
    Animated.parallel([
      Animated.timing(mainScale, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(mainOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [mainOpacity, mainScale]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? "Close price actions" : "Open price actions"}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={styles.mainPressable}
    >
      <View style={styles.mainHit}>
        {open ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.expandRing,
              {
                backgroundColor: palette.primarySoft,
                opacity: ringOpacity,
                transform: [{ scale: ringScale }],
              },
            ]}
          />
        ) : null}

        <Animated.View
          style={[
            styles.mainButton,
            adminElevation(3),
            {
              backgroundColor: palette.primaryStrong,
              opacity: mainOpacity,
              transform: [{ scale: mainScale }],
            },
          ]}
        >
          <View style={styles.mainIconSlot}>
            <Animated.View
              style={[
                styles.mainIconLayer,
                {
                  opacity: open ? iconCross : 1,
                  transform: [{ rotate: mainIconRotate }, { scale: open ? mainIconScale : 1 }],
                },
              ]}
            >
              <MaterialCommunityIcons name="currency-inr" size={24} color={palette.onPrimary} />
            </Animated.View>
            {open ? (
              <Animated.View
                style={[
                  styles.mainIconLayer,
                  {
                    opacity: closeCross,
                    transform: [{ rotate: closeIconRotate }, { scale: closeIconScale }],
                  },
                ]}
              >
                <MaterialCommunityIcons name="close" size={24} color={palette.onPrimary} />
              </Animated.View>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Pressable>
  );
});

type RadialActionProps = {
  action: PriceAction;
  index: number;
  palette: ThemePalette;
  progress: Animated.Value;
  onPress: (action: PriceAction) => void;
};

const RadialAction = memo(function RadialAction({ action, index, palette, progress, onPress }: RadialActionProps) {
  const target = useMemo(() => orbitOffset(ACTION_ANGLES[index] ?? 50, ORBIT_RADIUS), [index]);
  const STAGGER_RATIO = 40 / OPEN_MS;
  const revealStart = 0.02 + index * STAGGER_RATIO;
  const moveEnd = Math.min(revealStart + 0.5, 1);
  const revealEnd = Math.min(revealStart + 0.4, 1);
  const labelStart = Math.min(revealStart + 0.1, 1);
  const labelEnd = Math.min(labelStart + 0.3, 1);

  const translateX = progress.interpolate({
    inputRange: [0, revealStart, moveEnd, 1],
    outputRange: [0, 0, target.x, target.x],
    extrapolate: "clamp",
  });
  const translateY = progress.interpolate({
    inputRange: [0, revealStart, moveEnd, 1],
    outputRange: [0, 0, target.y, target.y],
    extrapolate: "clamp",
  });
  const itemOpacity = progress.interpolate({
    inputRange: [0, revealStart, revealEnd, 1],
    outputRange: [0, 0, 1, 1],
    extrapolate: "clamp",
  });
  const itemScale = progress.interpolate({
    inputRange: [0, revealStart, moveEnd, 1],
    outputRange: [0.2, 0.2, 1, 1],
    extrapolate: "clamp",
  });
  const labelOpacity = progress.interpolate({
    inputRange: [0, labelStart, labelEnd, 1],
    outputRange: [0, 0, 1, 1],
    extrapolate: "clamp",
  });
  const labelShift = progress.interpolate({
    inputRange: [0, labelStart, labelEnd, 1],
    outputRange: [6, 6, 0, 0],
    extrapolate: "clamp",
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.orbitItem,
        {
          opacity: itemOpacity,
          transform: [{ translateX }, { translateY }, { scale: itemScale }],
        },
      ]}
    >
      <View style={styles.orbitRow} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.labelChip,
            adminElevation(1),
            { backgroundColor: palette.card, opacity: labelOpacity, transform: [{ translateX: labelShift }] },
          ]}
        >
          <Text style={[adminTypography.bodyStrong, styles.actionLabel, { color: palette.textPrimary }]}>
            {action.label}
          </Text>
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => onPress(action)}
          style={({ pressed }) => [pressed ? styles.actionPressed : null]}
        >
          <View
            style={[
              styles.miniFab,
              adminElevation(2),
              { backgroundColor: action.backgroundColor },
            ]}
          >
            <MaterialCommunityIcons name={action.icon} size={20} color={action.textColor} />
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
});

export const AdminPriceActionsFab = memo(function AdminPriceActionsFab({
  palette,
  bottom,
  onPurchaseRate,
  onUpdatePrice,
  onRetailerPrice,
}: AdminPriceActionsFabProps) {
  const reduceMotion = useReduceMotion();
  const [menuVisible, setMenuVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const actions = useMemo<PriceAction[]>(
    () => [
      {
        key: "purchaseRate",
        label: "Purchase Rate",
        icon: "cart-arrow-down",
        backgroundColor: palette.primary,
        textColor: palette.onPrimary,
        onPress: onPurchaseRate,
      },
      {
        key: "updatePrice",
        label: "Update Price",
        icon: "cash-edit",
        backgroundColor: palette.success,
        textColor: palette.background,
        onPress: onUpdatePrice,
      },
      {
        key: "retailerPrice",
        label: "Retailer Price",
        icon: "tag-outline",
        backgroundColor: palette.warning,
        textColor: palette.background,
        onPress: onRetailerPrice,
      },
    ],
    [onPurchaseRate, onRetailerPrice, onUpdatePrice, palette],
  );

  const runProgress = useCallback(
    (toValue: number, onDone?: () => void) => {
      if (reduceMotion) {
        progress.setValue(toValue);
        onDone?.();
        return;
      }

      Animated.timing(progress, {
        toValue,
        duration: toValue === 1 ? OPEN_MS : CLOSE_MS,
        easing: toValue === 1 ? EASE_OUT : EASE_IN,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onDone?.();
      });
    },
    [progress, reduceMotion],
  );

  const openMenu = useCallback(() => {
    if (menuVisible) return;
    triggerHaptic();
    setMenuVisible(true);
  }, [menuVisible]);

  const closeMenu = useCallback(() => {
    if (!menuVisible) return;
    progress.stopAnimation();
    runProgress(0, () => setMenuVisible(false));
  }, [menuVisible, progress, runProgress]);

  useEffect(() => {
    if (!menuVisible) {
      progress.setValue(0);
      return;
    }
    runProgress(1);
    // ponytail: animate only on menu mount, not when runProgress identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuVisible]);

  const handleActionPress = useCallback(
    (action: PriceAction) => {
      triggerHaptic();
      progress.stopAnimation();
      runProgress(0, () => {
        setMenuVisible(false);
        action.onPress();
      });
    },
    [progress, runProgress],
  );

  const scrimOpacity = progress.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 1, 1],
    extrapolate: "clamp",
  });

  const orbitRingOpacity = progress.interpolate({
    inputRange: [0, 0.12, 0.55, 1],
    outputRange: [0, 0.22, 0.1, 0],
    extrapolate: "clamp",
  });
  const orbitRingScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [MAIN_SIZE / (ORBIT_RADIUS * 2), 1],
    extrapolate: "clamp",
  });

  return (
    <>
      {!menuVisible ? (
        <View pointerEvents="box-none" style={[styles.closedHost, { bottom }]}>
          <MainFabButton open={false} palette={palette} progress={progress} onPress={openMenu} />
        </View>
      ) : null}

      <Modal
        visible={menuVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeMenu}
      >
        <View style={styles.modalRoot}>
          <Animated.View
            pointerEvents="none"
            style={[styles.scrim, { backgroundColor: palette.overlay, opacity: scrimOpacity }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close price actions menu"
            onPress={closeMenu}
            style={StyleSheet.absoluteFill}
          />

          <View pointerEvents="box-none" style={[styles.fabAnchor, { bottom }]}>
            <View
              style={[styles.orbitStage, { width: STAGE_WIDTH, height: STAGE_HEIGHT }]}
              pointerEvents="box-none"
              collapsable={false}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.orbitRing,
                  {
                    backgroundColor: palette.primarySoft,
                    opacity: orbitRingOpacity,
                    transform: [{ scale: orbitRingScale }],
                  },
                ]}
              />
              <View style={styles.orbitOrigin} pointerEvents="box-none">
                {actions.map((action, index) => (
                  <RadialAction
                    key={action.key}
                    action={action}
                    index={index}
                    palette={palette}
                    progress={progress}
                    onPress={handleActionPress}
                  />
                ))}
                <MainFabButton open palette={palette} progress={progress} onPress={closeMenu} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  closedHost: {
    position: "absolute",
    right: adminSpacing.md,
    zIndex: 120,
  },
  modalRoot: {
    flex: 1,
    overflow: "visible",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  fabAnchor: {
    position: "absolute",
    right: adminSpacing.md,
    alignItems: "flex-end",
    justifyContent: "flex-end",
    overflow: "visible",
  },
  orbitStage: {
    overflow: "visible",
    alignItems: "flex-end",
    justifyContent: "flex-end",
  },
  orbitRing: {
    position: "absolute",
    right: MAIN_SIZE / 2 - ORBIT_RADIUS,
    bottom: MAIN_SIZE / 2 - ORBIT_RADIUS,
    width: ORBIT_RADIUS * 2,
    height: ORBIT_RADIUS * 2,
    borderRadius: ORBIT_RADIUS,
  },
  orbitOrigin: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: MAIN_SIZE,
    height: MAIN_SIZE,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  orbitItem: {
    position: "absolute",
    right: MAIN_SIZE / 2 - MINI_SIZE / 2,
    bottom: MAIN_SIZE / 2 - MINI_SIZE / 2,
    overflow: "visible",
  },
  orbitRow: {
    flexDirection: "row",
    alignItems: "center",
    overflow: "visible",
  },
  labelChip: {
    marginRight: 16,
    borderRadius: adminRadii.control,
    paddingHorizontal: adminSpacing.sm,
    paddingVertical: adminSpacing.xs,
    flexShrink: 0,
    minWidth: LABEL_CHIP_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    textAlign: "center",
  },
  miniFab: {
    width: MINI_SIZE,
    height: MINI_SIZE,
    borderRadius: MINI_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.96 }],
  },
  mainPressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  mainHit: {
    width: MAIN_SIZE,
    height: MAIN_SIZE,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  expandRing: {
    position: "absolute",
    width: MAIN_SIZE,
    height: MAIN_SIZE,
    borderRadius: MAIN_SIZE / 2,
  },
  mainButton: {
    width: MAIN_SIZE,
    height: MAIN_SIZE,
    borderRadius: MAIN_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  mainIconSlot: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  mainIconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
