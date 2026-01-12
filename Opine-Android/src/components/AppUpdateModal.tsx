import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { appUpdateService, UpdateInfo } from '../services/appUpdateService';

interface AppUpdateModalProps {
  visible: boolean;
  updateInfo: UpdateInfo | null;
  onClose: () => void;
  onSkip?: () => void;
}

export const AppUpdateModal: React.FC<AppUpdateModalProps> = ({
  visible,
  updateInfo,
  onClose,
  onSkip
}) => {
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [installing, setInstalling] = useState(false);

  // Reset states when modal closes
  useEffect(() => {
    if (!visible) {
      setDownloading(false);
      setDownloadProgress(0);
      setInstalling(false);
    }
  }, [visible]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleUpdate = async () => {
    if (!updateInfo) return;

    try {
      setDownloading(true);
      setDownloadProgress(0);

      // Extract filename from URL or use default
      const urlParts = updateInfo.downloadUrl.split('/');
      const filename = urlParts[urlParts.length - 1] || `Convergent-v${updateInfo.latestVersionCode}.apk`;

      console.log(`📥 Starting download: ${filename}`);

      // Download APK with progress tracking
      const downloadResult = await appUpdateService.downloadUpdate(
        updateInfo.downloadUrl,
        filename,
        (progress) => {
          setDownloadProgress(progress.progress);
        }
      );

      if (!downloadResult.success || !downloadResult.fileUri) {
        throw new Error(downloadResult.error || 'Download failed');
      }

      console.log(`✅ Download complete: ${downloadResult.fileUri}`);
      setDownloading(false);
      setDownloadProgress(100);

      // Install APK
      setInstalling(true);
      const installResult = await appUpdateService.installApk(downloadResult.fileUri);

      if (!installResult.success) {
        throw new Error(installResult.error || 'Installation failed');
      }

      // Success - installation intent launched
      Alert.alert(
        'Update Ready',
        'Please complete the installation in the installer window. The app will restart after installation.',
        [{ text: 'OK' }]
      );

      setInstalling(false);
      onClose();

    } catch (error: any) {
      console.error('❌ Update error:', error);
      setDownloading(false);
      setInstalling(false);
      Alert.alert(
        'Update Failed',
        error.message || 'Failed to download or install the update. Please try again later.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleSkip = () => {
    if (updateInfo && onSkip) {
      appUpdateService.skipVersion(updateInfo.latestVersionCode);
      onSkip();
    }
    onClose();
  };

  if (!updateInfo) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={updateInfo.isForceUpdate ? undefined : onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <Ionicons name="cloud-download-outline" size={32} color="#2563eb" />
            <Text style={styles.title}>Update Available</Text>
          </View>

          {/* Content */}
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.versionText}>
              Version {updateInfo.latestVersion} is now available
            </Text>

            <View style={styles.infoRow}>
              <Ionicons name="document-text-outline" size={18} color="#6b7280" />
              <Text style={styles.infoText}>
                Size: {formatFileSize(updateInfo.fileSize)}
              </Text>
            </View>

            {updateInfo.releaseNotes && (
              <View style={styles.releaseNotesContainer}>
                <Text style={styles.releaseNotesTitle}>What's New:</Text>
                <Text style={styles.releaseNotesText}>{updateInfo.releaseNotes}</Text>
              </View>
            )}

            {downloading && (
              <View style={styles.progressContainer}>
                <View style={styles.progressBarContainer}>
                  <View style={[styles.progressBar, { width: `${downloadProgress}%` }]} />
                </View>
                <Text style={styles.progressText}>
                  Downloading... {downloadProgress}%
                </Text>
              </View>
            )}

            {installing && (
              <View style={styles.progressContainer}>
                <ActivityIndicator size="small" color="#2563eb" />
                <Text style={styles.progressText}>
                  Preparing installation...
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            {!downloading && !installing && (
              <>
                {!updateInfo.isForceUpdate && (
                  <TouchableOpacity
                    style={[styles.button, styles.skipButton]}
                    onPress={handleSkip}
                  >
                    <Text style={styles.skipButtonText}>Later</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.button, styles.updateButton]}
                  onPress={handleUpdate}
                >
                  <Ionicons name="download-outline" size={20} color="#fff" style={styles.buttonIcon} />
                  <Text style={styles.updateButtonText}>Update Now</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 12
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center'
  },
  content: {
    padding: 20,
    maxHeight: 300
  },
  versionText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2563eb',
    marginBottom: 16,
    textAlign: 'center'
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 8
  },
  infoText: {
    fontSize: 14,
    color: '#6b7280'
  },
  releaseNotesContainer: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#f3f4f6',
    borderRadius: 8
  },
  releaseNotesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8
  },
  releaseNotesText: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20
  },
  progressContainer: {
    marginTop: 16,
    alignItems: 'center',
    gap: 8
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden'
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 4
  },
  progressText: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4
  },
  actions: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 12
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  updateButton: {
    backgroundColor: '#2563eb'
  },
  updateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  skipButton: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db'
  },
  skipButtonText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '600'
  },
  buttonIcon: {
    marginRight: 0
  }
});



