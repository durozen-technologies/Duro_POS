import { StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";
import type { ThemePalette } from "../admin-dashboard-theme";

export function AdminTextField({
  label,
  palette,
  ...props
}: TextInputProps & {
  label: string;
  palette: ThemePalette;
}) {
  return (
    <View style={styles.adminField}>
      <Text style={[styles.adminFieldLabel, { color: palette.textMuted }]}>{label}</Text>
      <TextInput
        autoCorrect={false}
        underlineColorAndroid="transparent"
        selectionColor={palette.primary}
        cursorColor={palette.primary}
        placeholderTextColor={palette.textMuted}
        style={[
          styles.adminFieldInput,
          { backgroundColor: palette.surfaceMuted, borderColor: palette.border, color: palette.textPrimary },
        ]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  adminField: {
    gap: 8,
  },
  adminFieldLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  adminFieldInput: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: "800",
  },
});
