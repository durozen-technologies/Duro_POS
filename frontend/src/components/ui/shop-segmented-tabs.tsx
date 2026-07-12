import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { appTheme } from "@/constants/theme";
import { ShopText as Text } from "./shop-text";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const styles = StyleSheet.create({
  segmentedTabs: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    flexDirection: "row",
    gap: 4,
    backgroundColor: appTheme.surface,
    borderColor: appTheme.border,
  },
  segmentedTab: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 12,
  },
  segmentedTabText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    flexShrink: 1,
  },
  activeTab: {
    backgroundColor: appTheme.card,
    borderColor: appTheme.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
});

export const ShopSegmentedTabs = memo(function ShopSegmentedTabs<TValue extends string>({
  items,
  activeValue,
  onChange,
  scrollable = false,
}: {
  items: { value: TValue; label: string; icon?: IconName }[];
  activeValue: TValue;
  onChange: (value: TValue) => void;
  scrollable?: boolean;
}) {
  const content = items.map((item) => {
    const active = item.value === activeValue;
    return (
      <Pressable
        key={item.value}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => onChange(item.value)}
        style={[
          styles.segmentedTab,
          !scrollable && { flex: 1 },
          scrollable && { paddingHorizontal: 16 },
          active && styles.activeTab,
        ]}
      >
        {item.icon ? (
          <MaterialCommunityIcons
            name={item.icon}
            size={16}
            color={active ? appTheme.accentDeep : appTheme.muted}
          />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.segmentedTabText,
            { color: active ? appTheme.accentDeep : appTheme.muted },
          ]}
        >
          {item.label}
        </Text>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <View style={[styles.segmentedTabs, { padding: 0, gap: 0 }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ padding: 4, gap: 4 }}
        >
          {content}
        </ScrollView>
      </View>
    );
  }

  return <View style={styles.segmentedTabs}>{content}</View>;
});
