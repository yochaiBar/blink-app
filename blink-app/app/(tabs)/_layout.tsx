import { Tabs } from "expo-router";
import { Users, Zap, User } from "lucide-react-native";
import React from "react";
import { Platform, View } from "react-native";
import { Image } from "expo-image";
import { theme } from "@/constants/colors";
import { useApp } from "@/providers/AppProvider";

function ProfileTabIcon({ color, size }: { color: string; size: number }) {
  const { user } = useApp();

  if (user.avatar && user.avatar.startsWith("http")) {
    const isActive = color === theme.coral;
    return (
      <View
        style={{
          width: size + 4,
          height: size + 4,
          borderRadius: (size + 4) / 2,
          borderWidth: 2,
          borderColor: isActive ? theme.coral : "transparent",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Image
          source={{ uri: user.avatar }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
          }}
          contentFit="cover"
        />
      </View>
    );
  }

  return <User size={size} color={color} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.coral,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.bg,
          borderTopColor: theme.border,
          borderTopWidth: 0.5,
          ...(Platform.OS === "web" ? { height: 60 } : {}),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600" as const,
        },
      }}
    >
      <Tabs.Screen
        name="(blinks)"
        options={{
          title: "Blinks",
          tabBarIcon: ({ color, size }) => (
            <Zap size={size} color={color} fill={color === theme.coral ? theme.coral : "transparent"} />
          ),
        }}
      />
      <Tabs.Screen
        name="(groups)"
        options={{
          title: "Groups",
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "You",
          tabBarIcon: ({ color, size }) => (
            <ProfileTabIcon color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
