# APK Update Issue: "App Not Installed" Troubleshooting Guide

## Problem Summary
Some interviewers on **Version 11** cannot update to **Version 12** APK. They get "App not installed" error. This affects only some users, not all.

## Root Causes (Most Likely to Least Likely)

### 1. **Different Signing Keys** ⚠️ MOST COMMON
**Problem:** If Version 11 and Version 12 APKs were signed with different keys, Android will reject the update to prevent security issues.

**How to Check:**
```bash
# Check signing certificate of existing APK (Version 11)
keytool -printcert -jarfile version11.apk

# Check signing certificate of new APK (Version 12)
keytool -printcert -jarfile version12.apk

# If the certificates don't match, that's the problem!
```

**Solution:**
- **CRITICAL:** Always use the SAME signing key for all APK versions
- If using EAS Build, ensure you're using the same credentials
- If building locally, use the same keystore file
- Never create a new keystore for updates

### 2. **Corrupted APK Download**
**Problem:** Some users may have incomplete or corrupted APK files.

**Solution:**
- Provide MD5/SHA256 checksums for APK files
- Ask users to re-download the APK
- Use a reliable file hosting service
- Provide download via multiple channels (email, cloud storage, etc.)

### 3. **Insufficient Storage Space**
**Problem:** Android needs space for both old and new APK during installation.

**Solution:**
- Ask users to free up at least 100-200MB before installing
- Clear app cache: Settings > Apps > Convergent > Storage > Clear Cache

### 4. **Package Name Mismatch**
**Problem:** Package name changed between versions (unlikely but possible).

**Current Package Name:** `com.convergentinterviewer`

**How to Verify:**
```bash
# Extract package name from APK
aapt dump badging version12.apk | grep package
```

### 5. **Version Code Not Incrementing Properly**
**Problem:** Version code must always increase.

**Current Status:**
- Version 11: versionCode should be 11
- Version 12: versionCode should be 12 (or higher)
- Current app.json shows versionCode: 13

**Verify in app.json:**
```json
"android": {
  "versionCode": 12,  // Must be > 11
  "package": "com.convergentinterviewer"
}
```

### 6. **Android Version Compatibility**
**Problem:** Some older Android devices may have compatibility issues.

**Solution:**
- Check minimum SDK version in build.gradle
- Ensure targetSdkVersion is compatible

## Immediate Solutions (Without Uninstalling)

### Solution 1: Verify and Fix Signing Key Consistency

**If using EAS Build:**
1. Check your EAS credentials:
   ```bash
   eas credentials
   ```
2. Ensure you're using the same Android keystore for all builds
3. If you accidentally created a new keystore, you need to:
   - **Option A:** Rebuild Version 12 with the SAME key as Version 11
   - **Option B:** Create a migration APK (see Solution 2)

**If building locally:**
1. Locate your keystore file (usually `android/app/upload-keystore.jks` or similar)
2. Ensure you use the SAME keystore for all builds
3. Never delete or recreate the keystore

### Solution 2: Create a Migration APK (If Keys Are Different)

If Version 11 and 12 have different signing keys, you need a migration path:

1. **Create a "Bridge" APK:**
   - Build a new APK (Version 12.1) signed with Version 11's key
   - This APK should:
     - Have versionCode 12 (or higher)
     - Export all offline data to external storage
     - Display instructions for users

2. **Create Final APK:**
   - Build Version 13 signed with Version 12's key
   - Users install Version 12.1 first (preserves data)
   - Then install Version 13 (uses new key)

**Better Approach:** Rebuild Version 12 with the correct key to avoid this complexity.

### Solution 3: Data Export Before Update (Temporary Workaround)

If signing keys are different and you can't rebuild immediately:

1. **Create a data export feature in Version 11:**
   - Add a "Backup Data" button in settings
   - Export all offline data to a JSON file in Downloads folder
   - Users can backup, uninstall, install Version 12, then restore

2. **Add data import in Version 12:**
   - On first launch, check for backup file
   - Import data if found

### Solution 4: Provide Clear Instructions to Affected Users

Create a user guide for affected interviewers:

```markdown
# How to Update to Version 12

## If you get "App not installed" error:

### Step 1: Backup Your Data
1. Open the app
2. Go to Settings
3. Tap "Export Data" or "Backup"
4. Wait for backup to complete
5. Note the backup file location

### Step 2: Free Up Space
1. Go to Settings > Apps > Convergent
2. Tap "Clear Cache" (NOT Clear Data!)
3. Ensure you have at least 100MB free space

### Step 3: Re-download APK
1. Delete the old APK file
2. Re-download Version 12 APK from the link
3. Verify file size matches expected size

### Step 4: Try Installation
1. Open the downloaded APK
2. If it still fails, contact support with:
   - Your Android version
   - Device model
   - Error message screenshot
```

## Prevention for Future Versions

### 1. **Always Use Same Signing Key**
```bash
# Save your keystore in a secure location
# Document the keystore location and password
# Use the same keystore for ALL builds
```

### 2. **Version Code Management**
- Always increment versionCode in app.json
- Never decrease versionCode
- Use semantic versioning: versionCode = major * 100 + minor * 10 + patch

### 3. **Build Process Standardization**
- Use EAS Build consistently (recommended)
- Or use the same local build environment
- Document your build process

### 4. **APK Verification**
Before distributing:
```bash
# Verify APK signature
jarsigner -verify -verbose -certs version12.apk

# Check version code
aapt dump badging version12.apk | grep versionCode

# Generate checksum
md5sum version12.apk > version12.md5
sha256sum version12.apk > version12.sha256
```

### 5. **Test Updates Before Distribution**
- Always test updating from previous version
- Test on multiple Android versions
- Test on different device manufacturers

## Quick Diagnostic Commands

### Check APK Signing:
```bash
# Install Android SDK build-tools first
keytool -printcert -jarfile app-release.apk
```

### Check Version Code:
```bash
aapt dump badging app-release.apk | grep versionCode
```

### Check Package Name:
```bash
aapt dump badging app-release.apk | grep package
```

### Verify APK Integrity:
```bash
# Check if APK is valid
aapt dump badging app-release.apk
# If this fails, APK is corrupted
```

## Recommended Action Plan

1. **Immediate (Today):**
   - [ ] Verify signing keys match between Version 11 and 12
   - [ ] Check if affected users have corrupted downloads
   - [ ] Provide re-download links with checksums

2. **Short-term (This Week):**
   - [ ] If keys don't match, rebuild Version 12 with correct key
   - [ ] Add data export feature to Version 11 (if needed)
   - [ ] Create user instructions document

3. **Long-term (Ongoing):**
   - [ ] Standardize build process
   - [ ] Document keystore location and credentials
   - [ ] Set up automated APK verification
   - [ ] Test updates before each release

## Contact Information for Support

If users continue to have issues:
- Collect device information (Android version, model)
- Collect APK file information (size, checksum)
- Check if issue is device-specific or APK-specific
- Consider providing device-specific builds if needed

---

## Technical Details

### Current Configuration:
- **Package Name:** `com.convergentinterviewer`
- **Current Version:** 13 (in app.json)
- **Build System:** Expo with EAS Build
- **Build Profile:** preview (APK format)

### EAS Build Signing:
EAS Build automatically manages signing keys. To ensure consistency:
1. Never delete EAS credentials
2. Use the same Expo account for all builds
3. Use the same build profile (preview/production)

### Local Build Signing:
If building locally, you must:
1. Generate a keystore once
2. Save it securely
3. Configure it in `android/app/build.gradle`
4. Use it for ALL future builds







