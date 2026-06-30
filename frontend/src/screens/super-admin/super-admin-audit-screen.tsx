import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { toApiError } from "@/api/client";
import { fetchAuditLogRows, type AuditLogRead } from "@/api/super-admin";
import type { AppStackParamList } from "@/navigation/types";
import type { UUID } from "@/types/api";

type Nav = NativeStackNavigationProp<AppStackParamList, "SuperAdminAudit">;

const ACCENT = "#0F7642";
const INK = "#0A110D";
const MUTED = "#4B6356";
const PAGE_SIZE = 50;

function formatTimestamp(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Convert snake_case entity types → readable labels */
function formatEntityType(raw: string): string {
  return raw
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function SuperAdminAuditScreen() {
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [items, setItems] = useState<AuditLogRead[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<{ created_at: string; id: UUID } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchAuditLogRows({ limit: PAGE_SIZE });
      setItems(page.items);
      setHasMore(page.has_more);
      cursorRef.current =
        page.has_more && page.next_cursor_created_at && page.next_cursor_id
          ? {
              created_at: page.next_cursor_created_at,
              id: page.next_cursor_id,
            }
          : null;
    } catch (err) {
      setError(toApiError(err).message || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchAuditLogRows({
        limit: PAGE_SIZE,
        cursor_created_at: cursor.created_at,
        cursor_id: cursor.id,
      });
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(page.has_more);
      cursorRef.current =
        page.has_more && page.next_cursor_created_at && page.next_cursor_id
          ? {
              created_at: page.next_cursor_created_at,
              id: page.next_cursor_id,
            }
          : null;
    } catch (err) {
      setError(toApiError(err).message || "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = search.trim()
    ? items.filter(
        (it) =>
          it.action.toLowerCase().includes(search.toLowerCase()) ||
          it.entity_type.toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  const renderItem = useCallback(
    ({ item }: { item: AuditLogRead }) => (
      <View className="flex-row items-start gap-3 border-b border-border px-4 py-4">
        {/* Icon */}
        <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-surface border border-border">
          <MaterialCommunityIcons name="history" size={16} color={MUTED} />
        </View>

        {/* Content */}
        <View className="flex-1">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-sm font-medium text-ink leading-tight">
              {item.action}
            </Text>
            <Text className="text-xs text-muted">
              {formatTimestamp(item.created_at)}
            </Text>
          </View>
          <View className="mt-2 flex-row items-center">
            <View className="rounded bg-surface px-2 py-0.5 border border-border">
              <Text className="text-[10px] font-semibold text-muted">
                {formatEntityType(item.entity_type)}
              </Text>
            </View>
          </View>
        </View>
      </View>
    ),
    [],
  );

  const listHeader = (
    <View>
      {/* Search with icon */}
      <View className="px-4 pb-2 pt-3">
        <View className="flex-row items-center gap-2 rounded-control border border-border bg-card px-3">
          <MaterialCommunityIcons name="magnify" size={18} color={MUTED} />
          <TextInput
            accessibilityLabel="Search audit log"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-[44px] flex-1 text-sm text-ink"
            placeholder="Search actions or entity types…"
            placeholderTextColor={MUTED}
            returnKeyType="search"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setSearch("")}
            >
              <MaterialCommunityIcons
                name="close-circle"
                size={16}
                color={MUTED}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {error ? (
        <View className="mx-4 mb-2 mt-1 rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
          <Text className="text-sm text-danger">{error}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <View className="mx-auto w-full max-w-5xl flex-1">
        {/* Screen header */}
        <View className="flex-row items-center gap-3 px-4 pb-2 pt-10">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-card active:opacity-80"
            onPress={() => navigation.goBack()}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color={INK} />
          </Pressable>
          <View className="flex-1">
            <Text className="text-2xl font-bold text-ink">Audit Log</Text>
            {!loading ? (
              <Text className="mt-0.5 text-xs text-muted">
                {items.length} entries{hasMore ? "+" : ""}{" "}
                {search.trim() ? `· ${filtered.length} matching` : ""}
              </Text>
            ) : null}
          </View>
        </View>

        {loading && items.length === 0 ? (
          <View>
            {listHeader}
            <ActivityIndicator className="mt-6" color={ACCENT} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              <View className="mt-10 items-center px-8">
                <MaterialCommunityIcons
                  name="shield-search"
                  size={40}
                  color={MUTED}
                />
                <Text className="mt-3 text-center text-sm font-medium text-ink">
                  {search ? "No matching entries" : "No audit entries yet"}
                </Text>
                {search ? (
                  <Pressable
                    accessibilityRole="button"
                    className="mt-3"
                    onPress={() => setSearch("")}
                  >
                    <Text className="text-xs font-semibold text-accent">
                      Clear search
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            }
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator className="my-4" color={ACCENT} />
              ) : hasMore && !search ? (
                <Pressable
                  accessibilityRole="button"
                  className="mx-4 my-4 min-h-[44px] items-center justify-center rounded-control border border-border bg-card active:opacity-80"
                  onPress={() => void loadMore()}
                >
                  <Text className="text-sm font-medium text-ink">
                    Load more
                  </Text>
                </Pressable>
              ) : null
            }
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.4}
            initialNumToRender={25}
            maxToRenderPerBatch={15}
            windowSize={5}
            removeClippedSubviews
            renderItem={renderItem}
          />
        )}
      </View>
    </View>
  );
}
