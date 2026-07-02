import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { ComponentProps } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { authenticatedImageSource } from "@/utils/item-images";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export function ItemThumbnail({
  uri,
  recyclingKey,
  size,
  borderRadius,
  backgroundColor,
  borderColor,
  icon = "image-outline",
  iconColor = "#6C7A70",
  iconSize = 20,
  style,
}: {
  uri: string;
  recyclingKey: string;
  size: number;
  borderRadius: number;
  backgroundColor: string;
  borderColor?: string;
  icon?: IconName;
  iconColor?: string;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.thumbnail,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor,
          borderColor,
          borderWidth: borderColor ? StyleSheet.hairlineWidth : 0,
        },
        style,
      ]}
    >
      {uri ? (
        <Image
          source={authenticatedImageSource(uri)}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`${recyclingKey}:${uri}`}
          transition={120}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <MaterialCommunityIcons name={icon} size={iconSize} color={iconColor} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
});
