import { Stack } from "expo-router";
import React from "react";
import { theme } from "@/constants/colors";

export default function GroupsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="group-detail"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="challenge-history"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="group-leaderboard"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="group-prompt"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}
