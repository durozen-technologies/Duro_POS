import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState, type ComponentProps, useEffect } from "react";
import { Modal, Pressable, StyleSheet, View, ScrollView } from "react-native";
import { ShopText as Text } from "@/components/ui/shop-text";
import type { CalendarPickerColors } from "./calendar-date-picker";

type TimeIconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

type TimePickerFieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  colors: CalendarPickerColors;
  icon?: TimeIconName;
  onPress: () => void;
};

type TimePickerModalProps = {
  visible: boolean;
  title: string;
  value?: string | null;
  colors: CalendarPickerColors;
  onSelect: (time: string) => void;
  onClose: () => void;
};

export function TimePickerField({
  label,
  value,
  placeholder = "Select time",
  colors,
  icon = "clock-outline",
  onPress,
}: TimePickerFieldProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select ${label}`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.fieldButton,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: pressed ? 0.78 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.fieldValue,
            { color: value ? colors.textPrimary : colors.textMuted },
          ]}
        >
          {value || placeholder}
        </Text>
        <MaterialCommunityIcons name={icon} size={19} color={colors.accent} />
      </Pressable>
    </View>
  );
}

export function TimePickerModal({
  visible,
  title,
  value,
  colors,
  onSelect,
  onClose,
}: TimePickerModalProps) {
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);
  const [isPM, setIsPM] = useState(false);

  useEffect(() => {
    if (visible) {
      if (value) {
        const [h, m] = value.split(":").map(Number);
        if (h !== undefined && m !== undefined && !isNaN(h) && !isNaN(m)) {
          setIsPM(h >= 12);
          setHour(h % 12 === 0 ? 12 : h % 12);
          setMinute(m);
        }
      } else {
        const now = new Date();
        const h = now.getHours();
        setIsPM(h >= 12);
        setHour(h % 12 === 0 ? 12 : h % 12);
        setMinute(Math.floor(now.getMinutes() / 5) * 5);
      }
    }
  }, [visible, value]);

  const handleApply = () => {
    let h24 = hour;
    if (isPM && hour < 12) h24 += 12;
    if (!isPM && hour === 12) h24 = 0;
    
    const hStr = h24.toString().padStart(2, "0");
    const mStr = minute.toString().padStart(2, "0");
    onSelect(`${hStr}:${mStr}`);
  };

  const hours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.content}>
            <View style={[styles.amPmWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                onPress={() => setIsPM(false)}
                style={[
                  styles.amPmBtn,
                  !isPM && { backgroundColor: colors.accentSoft, borderColor: colors.accent }
                ]}
              >
                <Text style={[styles.amPmText, { color: !isPM ? colors.accent : colors.textMuted }]}>AM</Text>
              </Pressable>
              <Pressable
                onPress={() => setIsPM(true)}
                style={[
                  styles.amPmBtn,
                  isPM && { backgroundColor: colors.accentSoft, borderColor: colors.accent }
                ]}
              >
                <Text style={[styles.amPmText, { color: isPM ? colors.accent : colors.textMuted }]}>PM</Text>
              </Pressable>
            </View>

            <View style={styles.gridRow}>
              <View style={styles.gridColumn}>
                <Text style={[styles.columnLabel, { color: colors.textMuted }]}>Hour</Text>
                <View style={styles.grid}>
                  {hours.map((h) => (
                    <Pressable
                      key={h}
                      onPress={() => setHour(h)}
                      style={[
                        styles.cell,
                        { borderColor: colors.surface },
                        hour === h && { backgroundColor: colors.accent, borderColor: colors.accent }
                      ]}
                    >
                      <Text style={[styles.cellText, { color: hour === h ? colors.onAccent : colors.textPrimary }]}>
                        {h}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <View style={styles.gridColumn}>
                <Text style={[styles.columnLabel, { color: colors.textMuted }]}>Minute</Text>
                <View style={styles.grid}>
                  {minutes.map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setMinute(m)}
                      style={[
                        styles.cell,
                        { borderColor: colors.surface },
                        minute === m && { backgroundColor: colors.accent, borderColor: colors.accent }
                      ]}
                    >
                      <Text style={[styles.cellText, { color: minute === m ? colors.onAccent : colors.textPrimary }]}>
                        {m.toString().padStart(2, "0")}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          </View>

          <View style={[styles.footer, { borderColor: colors.border }]}>
            <Pressable
              onPress={handleApply}
              style={[styles.applyBtn, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.applyText, { color: colors.onAccent }]}>Apply Time</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fieldWrap: {
    gap: 8,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  fieldButton: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    overflow: "hidden",
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
  },
  closeBtn: {
    padding: 4,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 20,
  },
  amPmWrap: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
  },
  amPmBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  amPmText: {
    fontSize: 14,
    fontWeight: "800",
  },
  gridRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  gridColumn: {
    flex: 1,
    gap: 12,
  },
  columnLabel: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  cell: {
    width: 60,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cellText: {
    fontSize: 16,
    fontWeight: "800",
  },
  divider: {
    width: 1,
    height: "100%",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  applyBtn: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  applyText: {
    fontSize: 15,
    fontWeight: "800",
  },
});
