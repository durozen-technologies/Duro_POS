import { useEffect, useRef, useState } from "react";
import {
  type TextStyle,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  TouchableWithoutFeedback,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Eye,
  EyeOff,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  Store,
  TriangleAlert,
  User2,
} from "lucide-react-native";

import { branding } from "@/constants/branding";
import { Image } from "expo-image";
import {
  Button as TButton,
  Input,
  ScrollView,
  Spinner,
  Text,
  View as Stack,
  XStack,
  YStack,
} from "tamagui";

import { login } from "@/api/auth";
import { toApiError } from "@/api/client";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { usePriceStore } from "@/store/price-store";

const logoImage = require("../../../assets/Logo.png");

const fieldInputTextStyle: TextStyle = {
  fontWeight: "700",
};

const C = {
  background: "#F6F8F5",
  hero: "#09110D",
  heroDeep: "#050806",
  heroSoft: "rgba(255,255,255,0.07)",
  heroBorder: "rgba(255,255,255,0.14)",
  card: "#FFFFFF",
  surface: "#F3F7F4",
  surfaceStrong: "#ECF5EF",
  border: "#DCE6DF",
  borderStrong: "#B9D5C4",
  accent: "#16A34A",
  accentDark: "#166534",
  accentBlack: "#0F2A1A",
  accentSoft: "#DCFCE7",
  ink: "#101827",
  muted: "#667085",
  mutedDark: "#475467",
  danger: "#DC2626",
  dangerBorder: "#FECACA",
  dangerSoft: "#FEF2F2",
  white: "#FFFFFF",
};

type FieldName = "username" | "password";

function collapseWhitespace(value: string) {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: C.mutedDark,
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 1.1,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
}

function IconTile({
  children,
  tone = "soft",
}: {
  children: React.ReactNode;
  tone?: "soft" | "inverse";
}) {
  return (
    <Stack
      width={44}
      height={44}
      alignItems="center"
      justifyContent="center"
      borderRadius={12}
      borderWidth={1}
      borderColor={tone === "inverse" ? C.heroBorder : C.borderStrong}
      backgroundColor={tone === "inverse" ? C.heroSoft : C.accentSoft}
    >
      {children}
    </Stack>
  );
}

function SecurityChip({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <XStack
      alignItems="center"
      gap={7}
      minHeight={34}
      paddingHorizontal={12}
      borderRadius={10}
      borderWidth={1}
      borderColor={C.heroBorder}
      backgroundColor="rgba(255,255,255,0.06)"
    >
      {icon}
      <Text
        numberOfLines={1}
        style={{
          color: "#DDFBE8",
          fontSize: 11,
          fontWeight: "800",
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </XStack>
  );
}

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [focusedField, setFocusedField] = useState<FieldName | null>(null);

  const setSession = useAuthStore((state) => state.setSession);
  const resetCart = useCartStore((state) => state.resetCart);
  const clearPrices = usePriceStore((state) => state.clear);

  const credentialsReady = Boolean(collapseWhitespace(username).trim() && password.trim());

  useEffect(() => {
    const keyboardShowEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";

    const subscription = Keyboard.addListener(keyboardShowEvent, () => {
      if (!focusedField) {
        return;
      }

      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollTo({
          y: focusedField === "password" ? 260 : 160,
          animated: true,
        });
      });
    });

    return () => subscription.remove();
  }, [focusedField]);

  async function handleLogin() {
    const normalizedUsername = collapseWhitespace(username).trim();

    if (!normalizedUsername || !password.trim()) {
      setErrorMessage("Username and password are required.");
      return;
    }

    Keyboard.dismiss();

    setSubmitting(true);
    setErrorMessage("");

    try {
      const response = await login({
        username: normalizedUsername,
        password,
      });

      resetCart();
      clearPrices();

      setSession(response.access_token, response.user);
    } catch (error) {
      setErrorMessage(toApiError(error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function clearError() {
    if (errorMessage) {
      setErrorMessage("");
    }
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={C.heroDeep} />

      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: C.background }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            ref={scrollViewRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            bounces={false}
            backgroundColor={C.background}
            contentContainerStyle={{
              flexGrow: 1,
              backgroundColor: C.background,
            }}
          >
            <YStack flex={1} backgroundColor={C.background}>
              <YStack
                minHeight={244}
                paddingHorizontal={22}
                paddingTop={insets.top + 18}
                paddingBottom={28}
                backgroundColor={C.hero}
                borderBottomWidth={1}
                borderBottomColor="rgba(255,255,255,0.08)"
              >
                <YStack width="100%" maxWidth={520} alignSelf="center" gap={14}>
                  <XStack alignItems="center" justifyContent="space-between" gap={16}>
                    <XStack alignItems="center" gap={12} flex={1} minWidth={0}>
                      <Stack
                        width={82}
                        height={82}
                        alignItems="center"
                        justifyContent="center"
                        borderRadius={18}
                        borderWidth={1}
                        borderColor={C.heroBorder}
                        backgroundColor={C.heroSoft}
                      >
                        <Image
                          source={logoImage}
                          style={{ width: 74, height: 74, borderRadius: 12, overflow: "hidden" }}
                          contentFit="contain"
                        />
                      </Stack>

                      <YStack flex={1} minWidth={0}>
                        <Text
                          numberOfLines={2}
                          style={{
                            color: C.white,
                            fontSize: 20,
                            lineHeight: 25,
                            fontWeight: "900",
                            flexShrink: 1,
                          }}
                        >
                          {branding.appName}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={{
                            color: "#9AE6B4",
                            fontSize: 12,
                            fontWeight: "900",
                            letterSpacing: 1.2,
                            marginTop: 3,
                          }}
                        >
                          Point of Sale
                        </Text>
                      </YStack>
                    </XStack>

                    <IconTile tone="inverse">
                      <ShieldCheck size={22} color="#BBF7D0" strokeWidth={2.5} />
                    </IconTile>
                  </XStack>

                  <YStack gap={8} marginTop={0}>
                    <Text
                      style={{
                        color: "rgba(255,255,255,0.76)",
                        fontSize: 14,
                        lineHeight: 21,
                        fontWeight: "600",
                      }}
                    >
                      Manage billing, inventory, pricing, and staff operations from one secure counter.
                    </Text>
                  </YStack>

                </YStack>
              </YStack>

              <YStack
                flex={1}
                justifyContent="space-between"
                marginTop={-28}
                paddingHorizontal={18}
                paddingBottom={insets.bottom + 26}
              >
                <YStack
                  width="100%"
                  maxWidth={520}
                  alignSelf="center"
                  gap={22}
                  padding={18}
                  borderRadius={16}
                  borderWidth={1}
                  borderColor={C.border}
                  backgroundColor={C.card}
                  shadowColor="#07110B"
                  shadowOpacity={0.14}
                  shadowRadius={18}
                  shadowOffset={{ width: 0, height: 10 }}
                  elevation={5}
                >
                  <YStack gap={6}>
                    <Text
                      style={{
                        color: C.ink,
                        fontSize: 24,
                        lineHeight: 30,
                        fontWeight: "900",
                      }}
                    >
                      Welcome back
                    </Text>
                    <Text
                      style={{
                        color: C.muted,
                        fontSize: 13,
                        lineHeight: 20,
                        fontWeight: "600",
                      }}
                    >
                      Use your staff credentials to enter the billing workspace.
                    </Text>
                  </YStack>

                  <YStack gap={16}>
                    <YStack gap={8}>
                      <FieldLabel>Username</FieldLabel>
                      <XStack
                        alignItems="center"
                        gap={12}
                        paddingHorizontal={13}
                        minHeight={62}
                        borderRadius={14}
                        borderWidth={1.5}
                        borderColor={focusedField === "username" ? C.accent : C.border}
                        backgroundColor={focusedField === "username" ? "#FAFFFC" : C.surface}
                      >
                        <IconTile>
                          <User2 size={20} color={C.accentDark} strokeWidth={2.4} />
                        </IconTile>
                        <Input
                          flex={1}
                          unstyled
                          value={username}
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoComplete="username"
                          textContentType="username"
                          placeholder="Enter your username"
                          placeholderTextColor={C.muted as never}
                          color={C.ink}
                          fontSize={16}
                          fontWeight="700"
                          style={fieldInputTextStyle}
                          paddingVertical={15}
                          onFocus={() => setFocusedField("username")}
                          onBlur={() => setFocusedField(null)}
                          onChangeText={(value) => {
                            setUsername(value);
                            clearError();
                          }}
                          returnKeyType="next"
                          blurOnSubmit={false}
                        />
                      </XStack>
                    </YStack>

                    <YStack gap={8}>
                      <FieldLabel>Password</FieldLabel>
                      <XStack
                        alignItems="center"
                        gap={12}
                        paddingHorizontal={13}
                        minHeight={62}
                        borderRadius={14}
                        borderWidth={1.5}
                        borderColor={focusedField === "password" ? C.accent : C.border}
                        backgroundColor={focusedField === "password" ? "#FAFFFC" : C.surface}
                      >
                        <IconTile>
                          <LockKeyhole size={20} color={C.accentDark} strokeWidth={2.4} />
                        </IconTile>
                        <Input
                          flex={1}
                          unstyled
                          secureTextEntry={!showPassword}
                          autoCorrect={false}
                          autoComplete="password"
                          textContentType="password"
                          placeholder="Enter your password"
                          placeholderTextColor={C.muted as never}
                          color={C.ink}
                          fontSize={16}
                          fontWeight="700"
                          style={fieldInputTextStyle}
                          paddingVertical={15}
                          onFocus={() => setFocusedField("password")}
                          onBlur={() => setFocusedField(null)}
                          onChangeText={(value) => {
                            setPassword(value);
                            clearError();
                          }}
                          returnKeyType="done"
                          onSubmitEditing={handleLogin}
                        />

                        <TButton
                          accessibilityRole="button"
                          accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                          width={44}
                          height={44}
                          padding={0}
                          borderRadius={12}
                          borderWidth={1}
                          borderColor={C.border}
                          backgroundColor={C.card}
                          pressStyle={{ scale: 0.97, backgroundColor: C.surfaceStrong }}
                          onPress={() => setShowPassword((prev) => !prev)}
                        >
                          {showPassword ? (
                            <EyeOff size={20} color={C.mutedDark} strokeWidth={2.4} />
                          ) : (
                            <Eye size={20} color={C.mutedDark} strokeWidth={2.4} />
                          )}
                        </TButton>
                      </XStack>
                    </YStack>
                  </YStack>

                  {errorMessage ? (
                    <XStack
                      alignItems="flex-start"
                      gap={11}
                      padding={14}
                      borderRadius={14}
                      borderWidth={1}
                      borderColor={C.dangerBorder}
                      backgroundColor={C.dangerSoft}
                    >
                      <TriangleAlert size={19} color={C.danger} strokeWidth={2.5} />
                      <Text
                        style={{
                          color: "#B42318",
                          fontSize: 13,
                          lineHeight: 19,
                          fontWeight: "800",
                          flex: 1,
                        }}
                      >
                        {errorMessage}
                      </Text>
                    </XStack>
                  ) : null}

                  <TButton
                    accessibilityRole="button"
                    accessibilityLabel="Enter workspace"
                    onPress={handleLogin}
                    disabled={submitting}
                    minHeight={54}
                    borderRadius={14}
                    borderWidth={1}
                    borderColor={credentialsReady ? "#1F5D35" : C.borderStrong}
                    backgroundColor={credentialsReady ? C.accentBlack : "#315B3D"}
                    opacity={submitting ? 0.82 : 1}
                    pressStyle={{ scale: 0.985, backgroundColor: "#0B2014" }}
                  >
                    {submitting ? (
                      <XStack alignItems="center" justifyContent="center" gap={10}>
                        <Spinner color={C.white} />
                        <Text style={{ color: C.white, fontSize: 15, fontWeight: "900" }}>
                          Signing in...
                        </Text>
                      </XStack>
                    ) : (
                      <XStack alignItems="center" justifyContent="center" gap={9}>
                        <LogIn size={18} color={C.white} strokeWidth={2.5} />
                        <Text style={{ color: C.white, fontSize: 15, fontWeight: "900" }}>
                          Enter workspace
                        </Text>
                      </XStack>
                    )}
                  </TButton>
                </YStack>

                <XStack
                  width="100%"
                  maxWidth={520}
                  alignSelf="center"
                  alignItems="center"
                  justifyContent="center"
                  gap={8}
                  paddingTop={18}
                  paddingHorizontal={12}
                >
                  <Store size={16} color={C.mutedDark} strokeWidth={2.2} />
                  <Text
                    style={{
                      color: C.mutedDark,
                      fontSize: 12,
                      lineHeight: 18,
                      fontWeight: "600",
                    }}
                  >
                    Powered by Durozen Technologies Pvt Ltd.
                  </Text>
                </XStack>
              </YStack>
            </YStack>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </>
  );
}
