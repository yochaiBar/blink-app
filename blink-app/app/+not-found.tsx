import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "@/constants/colors";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={styles.container}>
        <Text style={styles.emoji}>🫣</Text>
        <Text style={styles.title}>Page not found</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Back to groups</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: theme.bg,
    gap: 10,
  },
  emoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: theme.text,
  },
  link: {
    marginTop: 15,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: theme.coral,
    borderRadius: 12,
  },
  linkText: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: theme.white,
  },
});
