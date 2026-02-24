import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react-native';
import { theme } from '@/constants/colors';

interface FAQItem {
  question: string;
  answer: string;
}

const faqData: FAQItem[] = [
  {
    question: 'What is Blink?',
    answer: 'Blink is a social photo-sharing app where you and your friends participate in timed snap challenges, answer daily prompts, maintain streaks, and compete on leaderboards. Think of it as spontaneous moments with your favorite people!',
  },
  {
    question: 'How do Snap Challenges work?',
    answer: 'When a snap challenge is active in your group, you\'ll see a timer counting down. Tap the challenge bar to enter — you\'ll get a 3-second countdown, then 10 seconds to capture your moment. After submitting, you can see what everyone else shared!',
  },
  {
    question: 'What are streaks?',
    answer: 'Streaks track how many consecutive days you\'ve submitted snaps in a group. Keep your streak alive by participating every day! The longer your streak, the higher you climb on the leaderboard.',
  },
  {
    question: 'How do I join a group?',
    answer: 'You can join a group by entering an invite code. Ask a friend to share their group\'s code, then go to Join Group from the home screen and enter it. You can also tap on a shared invite link.',
  },
  {
    question: 'How do I invite friends?',
    answer: 'Open your group, tap the invite button, and share the invite code or link with friends. They can enter the code in the app or tap the link to join directly.',
  },
  {
    question: 'What are Daily Prompts?',
    answer: 'Daily prompts are fun questions, polls, or quizzes posted in your groups. They can be open-ended questions, multiple choice polls, or trivia quizzes. Respond and see what your friends think!',
  },
  {
    question: 'How does the leaderboard work?',
    answer: 'Each group has its own leaderboard ranking members by their total snaps submitted and streak length. The top 3 members are featured on the podium. Stay active to climb the ranks!',
  },
  {
    question: 'Can others see my snaps before I submit?',
    answer: 'No! Snaps are locked until you submit your own. This ensures everyone captures their authentic moment without being influenced by others.',
  },
  {
    question: 'How do I change my privacy settings?',
    answer: 'Go to Profile → Settings → Privacy. You can control who sees your snaps: Everyone, Friends Only, or Groups Only.',
  },
  {
    question: 'What are Quiet Hours?',
    answer: 'Quiet Hours let you mute notifications during certain times (e.g., 10 PM to 8 AM). You can enable this in Settings → Notifications → Quiet Hours.',
  },
];

export default function HelpFAQScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [expanded, setExpanded] = React.useState<number | null>(null);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & FAQ</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.heroSection}>
          <Text style={styles.heroEmoji}>💡</Text>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroSubtitle}>Find answers to common questions below</Text>
        </View>

        <View style={styles.faqList}>
          {faqData.map((item, index) => {
            const isExpanded = expanded === index;
            return (
              <TouchableOpacity
                key={index}
                style={[styles.faqItem, isExpanded && styles.faqItemExpanded]}
                onPress={() => setExpanded(isExpanded ? null : index)}
                activeOpacity={0.7}
                testID={`faq-item-${index}`}
              >
                <View style={styles.faqHeader}>
                  <Text style={[styles.faqQuestion, isExpanded && styles.faqQuestionExpanded]}>
                    {item.question}
                  </Text>
                  {isExpanded ? (
                    <ChevronUp size={18} color={theme.coral} />
                  ) : (
                    <ChevronDown size={18} color={theme.textMuted} />
                  )}
                </View>
                {isExpanded && (
                  <Text style={styles.faqAnswer}>{item.answer}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.contactSection}>
          <Text style={styles.contactTitle}>Still need help?</Text>
          <Text style={styles.contactText}>
            Reach out to us at support@blink.app and we'll get back to you within 24 hours.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: theme.text,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  heroSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  heroEmoji: {
    fontSize: 44,
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: theme.text,
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  faqList: {
    gap: 8,
  },
  faqItem: {
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  faqItemExpanded: {
    borderColor: `${theme.coral}40`,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  faqQuestion: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700' as const,
    color: theme.text,
    lineHeight: 21,
  },
  faqQuestionExpanded: {
    color: theme.coral,
  },
  faqAnswer: {
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 21,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: theme.border,
  },
  contactSection: {
    alignItems: 'center',
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 20,
    marginTop: 24,
  },
  contactTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: theme.text,
    marginBottom: 8,
  },
  contactText: {
    fontSize: 13,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
});
