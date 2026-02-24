import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Camera, Check } from 'lucide-react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '@/constants/colors';
import { useApp } from '@/providers/AppProvider';

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateProfile } = useApp();

  const [name, setName] = useState<string>(user.name);
  const [username, setUsername] = useState<string>(user.username.replace('@', ''));
  const [bio, setBio] = useState<string>(user.bio);
  const [avatar, setAvatar] = useState<string>(user.avatar);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const hasChanges = name !== user.name || `@${username}` !== user.username || bio !== user.bio || avatar !== user.avatar;

  const handlePickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setAvatar(result.assets[0].uri);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      Alert.alert('Error', 'Could not open photo library');
    }
  }, []);

  const handleTakePhoto = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera access is required to take a photo');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setAvatar(result.assets[0].uri);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      // Camera not available
    }
  }, []);

  const handleChangePhoto = useCallback(() => {
    if (Platform.OS === 'web') {
      handlePickImage();
      return;
    }

    Alert.alert('Change Photo', 'Choose an option', [
      { text: 'Take Photo', onPress: handleTakePhoto },
      { text: 'Choose from Library', onPress: handlePickImage },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handlePickImage, handleTakePhoto]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert('Oops', 'Name cannot be empty');
      return;
    }
    if (!username.trim()) {
      Alert.alert('Oops', 'Username cannot be empty');
      return;
    }

    setIsSaving(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      await updateProfile({
        name: name.trim(),
        username: `@${username.trim()}`,
        bio: bio.trim(),
        avatar,
      });
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [name, username, bio, avatar, updateProfile, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="edit-profile-back">
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={[styles.saveBtn, !hasChanges && styles.saveBtnDisabled]}
          disabled={!hasChanges || isSaving}
          testID="save-profile-btn"
        >
          <Check size={18} color={hasChanges ? theme.white : theme.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatarContainer} onPress={handleChangePhoto} activeOpacity={0.8}>
            <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" />
            <View style={styles.editAvatarBtn}>
              <Camera size={16} color={theme.white} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleChangePhoto}>
            <Text style={styles.changePhotoText}>Change Photo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={theme.textMuted}
            maxLength={30}
            testID="edit-name-input"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Username</Text>
          <View style={styles.usernameRow}>
            <Text style={styles.atSign}>@</Text>
            <TextInput
              style={[styles.input, styles.usernameInput]}
              value={username}
              onChangeText={(text) => setUsername(text.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="username"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              maxLength={20}
              testID="edit-username-input"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell friends about yourself..."
            placeholderTextColor={theme.textMuted}
            multiline
            maxLength={100}
            testID="edit-bio-input"
          />
          <Text style={styles.charCount}>{bio.length}/100</Text>
        </View>

        <TouchableOpacity
          style={[styles.saveMainBtn, (!hasChanges || isSaving) && styles.saveMainBtnDisabled]}
          onPress={handleSave}
          disabled={!hasChanges || isSaving}
          activeOpacity={0.85}
        >
          <Text style={[styles.saveMainBtnText, (!hasChanges || isSaving) && styles.saveMainBtnTextDisabled]}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Text>
        </TouchableOpacity>
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
  saveBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: theme.surface,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 10,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: theme.coral,
  },
  editAvatarBtn: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.coral,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: theme.bg,
  },
  changePhotoText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: theme.coral,
  },
  field: {
    marginBottom: 22,
  },
  label: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    color: theme.text,
    fontWeight: '600' as const,
    borderWidth: 1,
    borderColor: theme.border,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingLeft: 16,
  },
  atSign: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: theme.coral,
  },
  usernameInput: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    paddingLeft: 4,
  },
  bioInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    color: theme.textMuted,
    textAlign: 'right',
    marginTop: 6,
  },
  saveMainBtn: {
    backgroundColor: theme.coral,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveMainBtnDisabled: {
    backgroundColor: theme.surface,
  },
  saveMainBtnText: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: theme.white,
  },
  saveMainBtnTextDisabled: {
    color: theme.textMuted,
  },
});
