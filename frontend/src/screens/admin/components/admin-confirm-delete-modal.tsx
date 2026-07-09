import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ThemePalette } from "../admin-dashboard-theme";
import { adminElevation, adminRadii } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";

export type ConfirmDeleteCredentials = {
  username: string;
  password: string;
};

type Props = {
  visible: boolean;
  title: string;
  resourceName: string;
  message: string;
  signedInUsername: string;
  palette: ThemePalette;
  busy?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: (credentials: ConfirmDeleteCredentials) => void;
};

export function AdminConfirmDeleteModal({
  visible,
  title,
  resourceName,
  message,
  signedInUsername,
  palette,
  busy = false,
  errorMessage = null,
  onCancel,
  onConfirm,
}: Props) {
  const [username, setUsername] = useState(signedInUsername);
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setUsername(signedInUsername);
    setPassword("");
    setPasswordVisible(false);
  }, [signedInUsername, visible]);

  const canSubmit = username.trim().length >= 3 && password.length >= 1 && !busy;

  const handleConfirm = useCallback(() => {
    if (!canSubmit) {
      return;
    }
    triggerHaptic();
    onConfirm({
      username: username.trim().toLowerCase(),
      password,
    });
  }, [canSubmit, onConfirm, password, username]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.backdrop, { backgroundColor: palette.overlay }]}
      >
        <Pressable style={StyleSheet.absoluteFill} disabled={busy} onPress={busy ? undefined : onCancel} />
        <View style={styles.wrap} pointerEvents="box-none">
          <View
            style={[
              styles.card,
              adminElevation(3),
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <View style={styles.header}>
              <View style={[styles.iconWrap, { backgroundColor: palette.dangerSoft }]}>
                <MaterialCommunityIcons name="alert-octagon-outline" size={28} color={palette.danger} />
              </View>
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
                <Text numberOfLines={2} style={[styles.resource, { color: palette.textMuted }]}>
                  {resourceName}
                </Text>
              </View>
            </View>

            <View style={[styles.warnBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
              <Text style={[styles.warnBody, { color: palette.danger }]}>{message}</Text>
              <Text style={[styles.warnStrong, { color: palette.danger }]}>This cannot be undone</Text>
            </View>

            <View style={styles.fields}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: palette.textMuted }]}>Admin username</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  accessibilityLabel="Admin username"
                  placeholder="Your username"
                  placeholderTextColor={palette.textMuted}
                  value={username}
                  onChangeText={setUsername}
                  style={[
                    styles.input,
                    {
                      backgroundColor: palette.surfaceMuted,
                      borderColor: palette.border,
                      color: palette.textPrimary,
                    },
                  ]}
                />
              </View>
              <View style={styles.field}>
                <Text style={[styles.label, { color: palette.textMuted }]}>Admin password</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busy}
                    accessibilityLabel="Admin password"
                    placeholder="Confirm your password"
                    placeholderTextColor={palette.textMuted}
                    secureTextEntry={!passwordVisible}
                    value={password}
                    onChangeText={setPassword}
                    onSubmitEditing={handleConfirm}
                    style={[
                      styles.input,
                      styles.passwordInput,
                      {
                        backgroundColor: palette.surfaceMuted,
                        borderColor: palette.border,
                        color: palette.textPrimary,
                      },
                    ]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
                    disabled={busy}
                    onPress={() => setPasswordVisible((value) => !value)}
                    style={[
                      styles.eyeButton,
                      { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                      size={22}
                      color={palette.textMuted}
                    />
                  </Pressable>
                </View>
              </View>
            </View>

            {errorMessage ? (
              <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
                <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel delete"
                disabled={busy}
                onPress={onCancel}
                style={[
                  styles.actionButton,
                  { backgroundColor: palette.backgroundElevated, borderColor: palette.border, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.actionLabel, { color: palette.textPrimary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm delete"
                disabled={!canSubmit}
                onPress={handleConfirm}
                style={[
                  styles.actionButton,
                  {
                    backgroundColor: palette.danger,
                    borderColor: palette.danger,
                    opacity: canSubmit ? 1 : 0.5,
                  },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={palette.onPrimary} />
                ) : (
                  <Text style={[styles.actionLabel, { color: palette.onPrimary }]}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
  },
  wrap: {
    width: "100%",
    paddingHorizontal: 16,
    alignItems: "center",
  },
  card: {
    width: "100%",
    maxWidth: 440,
    borderWidth: 1,
    borderRadius: adminRadii.card,
    padding: 16,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    gap: 4,
    paddingTop: 2,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
  },
  resource: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
  },
  warnBox: {
    borderWidth: 1,
    borderRadius: adminRadii.control,
    padding: 12,
    gap: 6,
  },
  warnBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  warnStrong: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  fields: {
    gap: 12,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: "700",
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  passwordInput: {
    flex: 1,
  },
  eyeButton: {
    width: 48,
    height: 48,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    alignItems: "center",
    justifyContent: "center",
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: adminRadii.control,
    padding: 10,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: "900",
  },
});
