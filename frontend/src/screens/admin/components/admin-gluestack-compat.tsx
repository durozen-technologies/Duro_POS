import { memo } from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  StyleSheet,
  useColorScheme,
  type TextInputProps,
} from "react-native";

import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "@/components/gluestack";
import { cn } from "@/utils/cn";

import {
  adminPressOpacity,
  adminPressScale,
  adminRadii,
  adminSpacing,
  adminTypography,
  getAdminPalette,
} from "../admin-dashboard-theme";

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
  size?: "md" | "sm";
  className?: string;
  textClassName?: string;
};

export const Button = memo(function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "md",
  className,
  textClassName,
}: ButtonProps) {
  const palette = getAdminPalette(useColorScheme());
  const isSecondary = variant === "secondary";
  const isDisabled = disabled || loading;
  const backgroundColor = isSecondary
    ? palette.card
    : variant === "danger"
      ? palette.danger
      : palette.primary;
  const borderColor = isSecondary ? palette.border : backgroundColor;
  const textColor = isSecondary ? palette.textPrimary : palette.onPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      className={cn("items-center justify-center", className)}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === "sm" ? styles.buttonSm : styles.buttonMd,
        {
          backgroundColor,
          borderColor,
          opacity: isDisabled ? 0.55 : pressed ? adminPressOpacity : 1,
          transform: [{ scale: pressed && !isDisabled ? adminPressScale : 1 }],
        },
      ]}
    >
      <View style={styles.buttonInner}>
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <Text
            className={cn("text-center font-semibold", textClassName)}
            style={[
              styles.buttonText,
              size === "sm" ? styles.buttonTextSm : null,
              { color: textColor },
            ]}
          >
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
});

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
  suffix?: string;
  className?: string;
};

export const TextField = memo(function TextField({
  label,
  error,
  suffix,
  className,
  style,
  ...props
}: TextFieldProps) {
  const palette = getAdminPalette(useColorScheme());

  return (
    <View style={styles.fieldStack}>
      <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>{label}</Text>
      <View
        style={[
          styles.fieldShell,
          {
            backgroundColor: palette.surfaceMuted,
            borderColor: error ? palette.danger : palette.border,
          },
        ]}
      >
        <TextInput
          autoCorrect={false}
          className={cn("flex-1", className)}
          cursorColor={palette.primary}
          editable
          placeholderTextColor={palette.textMuted}
          selectionColor={palette.primary}
          style={[styles.fieldInput, { color: palette.textPrimary }, style]}
          underlineColorAndroid="transparent"
          {...props}
        />
        {suffix ? <Text style={[styles.fieldSuffix, { color: palette.textMuted }]}>{suffix}</Text> : null}
      </View>
      {error ? <Text style={[styles.fieldError, { color: palette.danger }]}>{error}</Text> : null}
    </View>
  );
});

type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  const palette = getAdminPalette(useColorScheme());

  return (
    <View
      style={[
        styles.emptyCard,
        {
          backgroundColor: palette.card,
          borderColor: palette.border,
        },
      ]}
    >
      <MaterialCommunityIcons name="clipboard-text-outline" size={28} color={palette.textMuted} />
      <View style={styles.emptyCopy}>
        <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>{title}</Text>
        <Text style={[styles.emptyDescription, { color: palette.textMuted }]}>{description}</Text>
      </View>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </View>
  );
}

type LoadingStateProps = {
  label?: string;
  fullscreen?: boolean;
};

export function LoadingState({ label = "Loading...", fullscreen = false }: LoadingStateProps) {
  const palette = getAdminPalette(useColorScheme());

  return (
    <View
      style={[
        styles.loadingShell,
        fullscreen ? styles.loadingFullscreen : null,
        { backgroundColor: fullscreen ? palette.background : "transparent" },
      ]}
    >
      <ActivityIndicator color={palette.primary} size="large" />
      <Text style={[styles.loadingLabel, { color: palette.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
  },
  buttonMd: {
    borderRadius: adminRadii.control,
    minHeight: 48,
    paddingHorizontal: adminSpacing.lg,
  },
  buttonSm: {
    borderRadius: adminRadii.control,
    minHeight: 40,
    paddingHorizontal: adminSpacing.md,
  },
  buttonInner: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  buttonText: adminTypography.bodyStrong,
  buttonTextSm: {
    fontSize: 14,
  },
  fieldStack: {
    gap: adminSpacing.sm,
  },
  fieldLabel: adminTypography.caption,
  fieldShell: {
    alignItems: "center",
    borderRadius: adminRadii.control,
    borderWidth: 1,
    flexDirection: "row",
    paddingHorizontal: adminSpacing.md,
  },
  fieldInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 48,
  },
  fieldSuffix: adminTypography.caption,
  fieldError: adminTypography.body,
  emptyCard: {
    alignItems: "center",
    borderRadius: adminRadii.card,
    borderStyle: "dashed",
    borderWidth: 1,
    gap: adminSpacing.md,
    paddingHorizontal: adminSpacing.lg,
    paddingVertical: adminSpacing.xl,
  },
  emptyCopy: {
    alignItems: "center",
    gap: adminSpacing.xs,
  },
  emptyTitle: adminTypography.sectionTitle,
  emptyDescription: {
    ...adminTypography.body,
    maxWidth: 320,
    textAlign: "center",
  },
  loadingShell: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: adminSpacing.xl,
    gap: adminSpacing.sm,
  },
  loadingFullscreen: {
    flex: 1,
    paddingHorizontal: adminSpacing.lg,
  },
  loadingLabel: adminTypography.body,
});
