// ═══════════════════════════════════════════════════════════════════════════════
// LoginScreen.tsx — Production-grade authentication entry point
// ═══════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Linking,
  Pressable,
  StatusBar,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Eye,
  EyeOff,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  TriangleAlert,
  User2,
} from "lucide-react-native";
import { Image } from "expo-image";

import { branding } from "@/constants/branding";
import { login } from "@/api/auth";
import { toApiError } from "@/api/client";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { usePriceStore } from "@/store/price-store";

// ─── Types ───────────────────────────────────────────────────────────────────

type FieldName = "username" | "password";

interface FieldState {
  value: string;
  error: string | null;
  touched: boolean;
}

// ─── Theme Tokens ────────────────────────────────────────────────────────────
// Centralized JS color values for icon tinting and dynamic styles.
// These MUST stay in sync with the NativeWind tailwind.config theme tokens.

const TINT = {
  accent: "#0F7642",
  muted: "#4B6356",
  danger: "#DC2626",
  dangerText: "#B42318",
  white: "#FFFFFF",
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const LOGO_SOURCE = require("../../../assets/Logo.png");

const ANIM = {
  staggerDelay: 120,
  duration: 500,
  slideDistance: 24,
  pressScale: 0.97,
  pressDuration: 80,
  releaseDuration: 150,
} as const;

const VALIDATION = {
  username: {
    required: "Username is required.",
    maxLength: 128,
    tooLong: "Username must not exceed 128 characters.",
  },
  password: {
    required: "Password is required.",
  },
} as const;

const SCROLL_OFFSET_BY_FIELD: Record<FieldName, number> = {
  username: 160,
  password: 260,
} as const;

const FALLBACK_ERROR_MESSAGE =
  "An unexpected error occurred. Please try again.";

// ─── Pure Utilities ──────────────────────────────────────────────────────────

function sanitizeUsername(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function validateField(name: FieldName, value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) return VALIDATION[name].required;

  if (name === "username" && trimmed.length > VALIDATION.username.maxLength) {
    return VALIDATION.username.tooLong;
  }

  return null;
}

function resolveErrorMessage(
  error: ReturnType<typeof toApiError>
): string {
  if (error.status === 401) return "Invalid username or password.";
  if (error.status === 403) return "Access denied. Please contact your administrator.";
  if (error.status === 429) return "Too many login attempts. Please wait a moment before retrying.";
  const message = error.message.trim();
  if (message) return message;
  return FALLBACK_ERROR_MESSAGE;
}

// ─── Form State Hook ─────────────────────────────────────────────────────────

function useLoginForm() {
  const [fields, setFields] = useState<Record<FieldName, FieldState>>({
    username: { value: "", error: null, touched: false },
    password: { value: "", error: null, touched: false },
  });

  const updateValue = useCallback((field: FieldName, value: string) => {
    setFields((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        value,
        error: prev[field].touched ? validateField(field, value) : null,
      },
    }));
  }, []);

  const markTouched = useCallback((field: FieldName) => {
    setFields((prev) => {
      if (prev[field].touched) return prev;
      return {
        ...prev,
        [field]: {
          ...prev[field],
          touched: true,
          error: validateField(field, prev[field].value),
        },
      };
    });
  }, []);

  const validateAll = useCallback((): boolean => {
    let isValid = true;

    setFields((prev) => {
      const next: Record<FieldName, FieldState> = {
        username: { ...prev.username },
        password: { ...prev.password },
      };

      for (const field of ["username", "password"] as const) {
        const error = validateField(field, prev[field].value);
        next[field] = { ...prev[field], touched: true, error };
        if (error) isValid = false;
      }

      return next;
    });

    return isValid;
  }, []);

  const reset = useCallback(() => {
    setFields({
      username: { value: "", error: null, touched: false },
      password: { value: "", error: null, touched: false },
    });
  }, []);

  const credentials = useMemo(
    () => ({
      username: sanitizeUsername(fields.username.value),
      password: fields.password.value.trim(),
    }),
    [fields.username.value, fields.password.value]
  );

  const canSubmit = useMemo(
    () => Boolean(credentials.username && credentials.password),
    [credentials]
  );

  const hasErrors = useMemo(
    () => Boolean(fields.username.error || fields.password.error),
    [fields.username.error, fields.password.error]
  );

  return {
    fields,
    credentials,
    canSubmit,
    hasErrors,
    updateValue,
    markTouched,
    validateAll,
    reset,
  };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FieldLabel({
  children,
  nativeID,
}: {
  children: string;
  nativeID: string;
}) {
  return (
    <Text
      className="text-[11px] font-bold uppercase tracking-widest text-muted"
      nativeID={nativeID}
    >
      {children}
    </Text>
  );
}

interface InputFieldProps {
  field: FieldName;
  label: string;
  value: string;
  error: string | null;
  touched: boolean;
  isFocused: boolean;
  isDisabled: boolean;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onSubmitEditing?: () => void;
  returnKeyType: "next" | "done";
  secureTextEntry?: boolean;
  inputRef?: React.RefObject<TextInput | null>;
  trailingElement?: React.ReactNode;
}

function InputField({
  field,
  label,
  value,
  error,
  touched,
  isFocused,
  isDisabled,
  onChangeText,
  onFocus,
  onBlur,
  onSubmitEditing,
  returnKeyType,
  secureTextEntry = false,
  inputRef,
  trailingElement,
}: InputFieldProps) {
  const hasError = touched && error;
  const labelID = `${field}-label`;
  const errorID = `${field}-error`;

  const borderClass = hasError
    ? "border-danger"
    : isFocused
      ? "border-accent"
      : "border-border";

  const bgClass = isFocused ? "bg-white" : "bg-surface";

  const iconColor = hasError
    ? TINT.danger
    : isFocused
      ? TINT.accent
      : TINT.muted;

  const LeadingIcon = field === "username" ? User2 : LockKeyhole;

  return (
    <View className="gap-2.5">
      <FieldLabel nativeID={labelID}>{label}</FieldLabel>

      <View
        className={`min-h-[52px] flex-row items-center gap-3 rounded-card border-2 px-3.5 ${borderClass} ${bgClass}`}
      >
        <LeadingIcon size={20} color={iconColor} strokeWidth={2.4} />

        <TextInput
          ref={inputRef}
          className="flex-1 text-base font-bold text-ink"
          value={value}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={secureTextEntry}
          autoComplete={
            field === "username" ? "username" : "current-password"
          }
          textContentType={field === "username" ? "username" : "password"}
          placeholder={`Enter your ${label.toLowerCase()}`}
          placeholderTextColor={TINT.muted}
          editable={!isDisabled}
          onFocus={onFocus}
          onBlur={onBlur}
          onChangeText={onChangeText}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={returnKeyType === "done"}
          aria-labelledby={labelID}
          aria-invalid={hasError ? true : undefined}
          aria-errormessage={hasError ? errorID : undefined}
          importantForAccessibility={hasError ? "yes" : "no"}
        />

        {trailingElement}
      </View>

      {hasError ? (
        <Text
          className="text-xs font-semibold text-danger pl-1"
          nativeID={errorID}
          role="alert"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View
      className="flex-row items-start gap-3 rounded-card border border-dangerSoft bg-dangerSoft p-3.5"
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <TriangleAlert
        size={18}
        color={TINT.danger}
        strokeWidth={2.5}
      />
      <Text className="flex-1 text-sm font-semibold leading-snug text-dangerText">
        {message}
      </Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const passwordInputRef = useRef<TextInput>(null);

  // Form state
  const {
    fields,
    credentials,
    canSubmit,
    hasErrors,
    updateValue,
    markTouched,
    validateAll,
    reset,
  } = useLoginForm();

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<FieldName | null>(null);

  // Submission lock — prevents double-taps and rapid retries
  const submitLockRef = useRef(false);

  // Store actions
  const setSession = useAuthStore((s) => s.setSession);
  const resetCart = useCartStore((s) => s.resetCart);
  const clearPrices = usePriceStore((s) => s.clear);

  // ── Entrance Animations ────────────────────────────────────────────────

  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerTranslate = useRef(
    new Animated.Value(ANIM.slideDistance)
  ).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslate = useRef(
    new Animated.Value(ANIM.slideDistance)
  ).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.stagger(ANIM.staggerDelay, [
      Animated.parallel([
        Animated.timing(headerOpacity, {
          toValue: 1,
          duration: ANIM.duration,
          useNativeDriver: true,
        }),
        Animated.timing(headerTranslate, {
          toValue: 0,
          duration: ANIM.duration,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: ANIM.duration,
          useNativeDriver: true,
        }),
        Animated.timing(cardTranslate, {
          toValue: 0,
          duration: ANIM.duration,
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start();
    return () => animation.stop();
  }, [cardOpacity, cardTranslate, headerOpacity, headerTranslate]);

  // ── Submit Logic ───────────────────────────────────────────────────────

  const handleLogin = useCallback(async () => {
    if (submitLockRef.current || submitting) return;
    submitLockRef.current = true;

    const isValid = validateAll();
    if (!isValid) {
      submitLockRef.current = false;
      return;
    }

    Keyboard.dismiss();
    setSubmitting(true);
    setFormError(null);

    try {
      const response = await login({
        username: credentials.username,
        password: credentials.password,
      });

      resetCart();
      clearPrices();
      reset();
      setSession(response.access_token, response.user);
    } catch (error) {
      setFormError(resolveErrorMessage(toApiError(error)));
    } finally {
      setSubmitting(false);
      setTimeout(() => {
        submitLockRef.current = false;
      }, 500);
    }
  }, [
    submitting,
    validateAll,
    credentials,
    resetCart,
    clearPrices,
    reset,
    setSession,
  ]);

  // ── Button Press Animation ─────────────────────────────────────────────

  const handlePressIn = useCallback(() => {
    Animated.timing(buttonScale, {
      toValue: ANIM.pressScale,
      duration: ANIM.pressDuration,
      useNativeDriver: true,
    }).start();
  }, [buttonScale]);

  const handlePressOut = useCallback(() => {
    Animated.timing(buttonScale, {
      toValue: 1,
      duration: ANIM.releaseDuration,
      useNativeDriver: true,
    }).start();
  }, [buttonScale]);

  // ── Field Handlers ─────────────────────────────────────────────────────

  const handleUsernameChange = useCallback(
    (text: string) => {
      updateValue("username", text);
      if (formError) setFormError(null);
    },
    [updateValue, formError]
  );

  const handlePasswordChange = useCallback(
    (text: string) => {
      updateValue("password", text);
      if (formError) setFormError(null);
    },
    [updateValue, formError]
  );

  const handleUsernameFocus = useCallback(
    () => setFocusedField("username"),
    []
  );

  const handleUsernameBlur = useCallback(() => {
    setFocusedField(null);
    markTouched("username");
  }, [markTouched]);

  const handlePasswordFocus = useCallback(
    () => setFocusedField("password"),
    []
  );

  const handlePasswordBlur = useCallback(() => {
    setFocusedField(null);
    markTouched("password");
  }, [markTouched]);

  const handleUsernameSubmitEditing = useCallback(() => {
    passwordInputRef.current?.focus();
  }, []);

  const togglePasswordVisibility = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  // ── Derived State ──────────────────────────────────────────────────────

  const isButtonActive = canSubmit && !hasErrors && !submitting;
  const shouldAnimateButton = canSubmit && !hasErrors && !submitting;

  const passwordToggleIcon = showPassword ? (
    <EyeOff
      size={20}
      color={
        focusedField === "password" ? TINT.accent : TINT.muted
      }
      strokeWidth={2.4}
    />
  ) : (
    <Eye
      size={20}
      color={
        focusedField === "password" ? TINT.accent : TINT.muted
      }
      strokeWidth={2.4}
    />
  );

  const passwordTrailing = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        showPassword ? "Hide password" : "Show password"
      }
      className="h-10 w-10 items-center justify-center rounded-control active:bg-surface"
      onPress={togglePasswordVisibility}
      disabled={submitting}
    >
      {passwordToggleIcon}
    </Pressable>
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor="#F2F7F4" />

      <TouchableWithoutFeedback
        onPress={Keyboard.dismiss}
        accessible={false}
      >
        <KeyboardAwareScrollView
          enableOnAndroid={true}
          keyboardShouldPersistTaps="handled"
          extraScrollHeight={30}
          extraHeight={80}
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            bounces={false}
            className="flex-1 bg-background"
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              paddingTop: insets.top + 32,
              paddingBottom: insets.bottom + 32,
              paddingHorizontal: 20,
            }}
          >
            <View className="w-full max-w-[420px] self-center">
              {/* ── Header / Logo ─────────────────────────────────────── */}
              <Animated.View
                className="mb-8 items-center gap-4"
                style={{
                  opacity: headerOpacity,
                  transform: [{ translateY: headerTranslate }],
                }}
              >
                <View className="h-24 w-24 items-center justify-center rounded-3xl border border-accent/20 bg-accentSoft/50 shadow-sm">
                  <Image
                    source={LOGO_SOURCE}
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: 18,
                      overflow: "hidden",
                    }}
                    contentFit="contain"
                    accessibilityLabel={`${branding.appName} logo`}
                  />
                </View>

                <View className="items-center gap-1.5">
                  <Text className="text-center text-3xl font-bold tracking-tight text-ink">
                    {branding.appName}
                  </Text>
                  <Text className="text-center text-[13px] font-bold uppercase tracking-widest text-accent">
                    Point of Sale
                  </Text>
                </View>
              </Animated.View>

              {/* ── Form Card ─────────────────────────────────────────── */}
              <Animated.View
                className="w-full gap-6 rounded-[24px] border border-border bg-card p-6 shadow-float"
                style={{
                  opacity: cardOpacity,
                  transform: [{ translateY: cardTranslate }],
                }}
              >
                <View className="gap-1.5">
                  <Text className="text-xl font-bold tracking-tight text-ink">
                    Welcome back
                  </Text>
                  <Text className="text-sm font-medium text-muted">
                    Sign in with your staff credentials.
                  </Text>
                </View>

                {/* ── Fields ──────────────────────────────────────────── */}
                <View className="gap-5">
                  <InputField
                    field="username"
                    label="Username"
                    value={fields.username.value}
                    error={fields.username.error}
                    touched={fields.username.touched}
                    isFocused={focusedField === "username"}
                    isDisabled={submitting}
                    onChangeText={handleUsernameChange}
                    onFocus={handleUsernameFocus}
                    onBlur={handleUsernameBlur}
                    onSubmitEditing={handleUsernameSubmitEditing}
                    returnKeyType="next"
                  />

                  <InputField
                    field="password"
                    label="Password"
                    value={fields.password.value}
                    error={fields.password.error}
                    touched={fields.password.touched}
                    isFocused={focusedField === "password"}
                    isDisabled={submitting}
                    onChangeText={handlePasswordChange}
                    onFocus={handlePasswordFocus}
                    onBlur={handlePasswordBlur}
                    onSubmitEditing={handleLogin}
                    returnKeyType="done"
                    secureTextEntry={!showPassword}
                    inputRef={passwordInputRef}
                    trailingElement={passwordTrailing}
                  />
                </View>

                {/* ── Form-level Error ────────────────────────────────── */}
                {formError ? <ErrorBanner message={formError} /> : null}

                {/* ── Submit Button ───────────────────────────────────── */}
                <Animated.View
                  style={{ transform: [{ scale: buttonScale }] }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Sign in to workspace"
                    accessibilityState={{
                      disabled: !isButtonActive,
                      busy: submitting,
                    }}
                    onPress={handleLogin}
                    onPressIn={
                      shouldAnimateButton
                        ? handlePressIn
                        : undefined
                    }
                    onPressOut={
                      shouldAnimateButton
                        ? handlePressOut
                        : undefined
                    }
                    disabled={submitting}
                    className={`mt-2 min-h-[52px] flex-row items-center justify-center gap-2.5 rounded-card border ${
                      isButtonActive
                        ? "border-accentDeep bg-accent active:bg-accentDeep"
                        : "border-border bg-surface"
                    } ${submitting ? "opacity-80" : ""}`}
                  >
                    {submitting ? (
                      <>
                        <ActivityIndicator
                          color={
                            isButtonActive
                              ? TINT.white
                              : TINT.muted
                          }
                        />
                        <Text
                          className={`text-base font-bold ${
                            isButtonActive
                              ? "text-white"
                              : "text-muted"
                          }`}
                        >
                          Signing in…
                        </Text>
                      </>
                    ) : (
                      <>
                        <LogIn
                          size={18}
                          color={
                            isButtonActive
                              ? TINT.white
                              : TINT.muted
                          }
                          strokeWidth={2.5}
                        />
                        <Text
                          className={`text-base font-bold ${
                            isButtonActive
                              ? "text-white"
                              : "text-muted"
                          }`}
                        >
                          Enter workspace
                        </Text>
                      </>
                    )}
                  </Pressable>
                </Animated.View>
              </Animated.View>

              {/* ── Footer ────────────────────────────────────────────── */}
              <Animated.View
                className="mt-8 flex-row items-center justify-center"
                style={{
                  opacity: Animated.multiply(cardOpacity, 0.9),
                }}
              >
                <Pressable 
                  className="flex-row items-center gap-2 rounded-full border border-border bg-white px-4 py-2 shadow-sm active:bg-surface"
                  onPress={() => Linking.openURL("https://durozen.in").catch(() => {})}
                >
                  <ShieldCheck
                    size={14}
                    color={TINT.accent}
                    strokeWidth={2.5}
                  />
                  <Text className="text-[11px] font-bold uppercase tracking-wider text-muted">
                    Secure POS <Text className="text-accent/50">•</Text> By <Text className="text-accent">Durozen Tech</Text>
                  </Text>
                </Pressable>
              </Animated.View>
            </View>
          </KeyboardAwareScrollView>
        </TouchableWithoutFeedback>
    </>
  );
}