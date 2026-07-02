import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

const ACCENT = "#0F7642";
const INK = "#0A110D";
const MUTED = "#4B6356";

export type SuperAdminDropdownOption<T extends string> = {
  value: T;
  label: string;
  sublabel?: string;
};

function RadioRow({
  label,
  sublabel,
  selected,
  onPress,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className="min-h-[52px] flex-row items-center gap-4 border-b border-border px-5 active:bg-surface"
      onPress={onPress}
    >
      <View
        className={`h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? "border-accent" : "border-border"}`}
      >
        {selected ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
      </View>
      <View className="flex-1">
        <Text
          className={`text-sm ${selected ? "font-semibold text-ink" : "font-medium text-ink"}`}
        >
          {label}
        </Text>
        {sublabel ? <Text className="text-xs text-muted">{sublabel}</Text> : null}
      </View>
      {selected ? (
        <MaterialCommunityIcons name="check" size={16} color={ACCENT} />
      ) : null}
    </Pressable>
  );
}

export function SuperAdminSelectDropdown<T extends string>({
  label,
  options,
  value,
  onSelect,
  disabled = false,
}: {
  label: string;
  options: SuperAdminDropdownOption<T>[];
  value: T;
  onSelect: (v: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? value}`}
        accessibilityState={{ disabled }}
        className={`flex-1 flex-row items-center justify-between rounded-control border border-border bg-card px-3 py-2 ${disabled ? "opacity-50" : "active:bg-surface"}`}
        style={{ minHeight: 44 }}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        <View className="mr-2 flex-1">
          <Text className="text-xs text-muted">{label}</Text>
          <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
            {selected?.label ?? value}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={18} color={MUTED} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 justify-end bg-black/50"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="flex-1"
            onPress={() => setOpen(false)}
          />
          <View className="rounded-t-2xl bg-card pb-10">
            <View className="items-center pb-2 pt-3">
              <View className="h-1 w-10 rounded-full bg-border" />
            </View>
            <View className="flex-row items-center justify-between border-b border-border px-5 pb-3">
              <Text className="text-base font-semibold text-ink">{label}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                className="min-h-[44px] min-w-[44px] items-center justify-center active:opacity-80"
                onPress={() => setOpen(false)}
              >
                <MaterialCommunityIcons name="close" size={20} color={INK} />
              </Pressable>
            </View>
            {options.map((option) => (
              <RadioRow
                key={option.value}
                label={option.label}
                sublabel={option.sublabel}
                selected={value === option.value}
                onPress={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
              />
            ))}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
