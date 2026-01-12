#!/bin/bash

# APK Signing Verification Script
# This script helps diagnose "App not installed" issues by comparing APK signatures

set -e

echo "=========================================="
echo "APK Signing Verification Tool"
echo "=========================================="
echo ""

# Check if APK files are provided
if [ $# -lt 1 ]; then
    echo "Usage: $0 <apk1> [apk2]"
    echo ""
    echo "Examples:"
    echo "  $0 version11.apk version12.apk  # Compare two APKs"
    echo "  $0 version12.apk                 # Check single APK"
    echo ""
    exit 1
fi

APK1=$1
APK2=$2

# Check if keytool is available
if ! command -v keytool &> /dev/null; then
    echo "ERROR: keytool not found. Please install Java JDK:"
    echo "  sudo apt install openjdk-17-jdk"
    exit 1
fi

# Check if aapt is available (optional but helpful)
AAPT_AVAILABLE=false
if command -v aapt &> /dev/null; then
    AAPT_AVAILABLE=true
elif [ -f "$ANDROID_HOME/build-tools"/*/aapt ]; then
    AAPT_AVAILABLE=true
    AAPT_PATH=$(find "$ANDROID_HOME/build-tools" -name aapt | head -1)
fi

# Function to extract APK info
extract_apk_info() {
    local apk=$1
    local label=$2
    
    echo "----------------------------------------"
    echo "Analyzing: $label"
    echo "File: $apk"
    echo "----------------------------------------"
    
    if [ ! -f "$apk" ]; then
        echo "ERROR: File not found: $apk"
        return 1
    fi
    
    # File size
    echo "File Size: $(du -h "$apk" | cut -f1)"
    echo ""
    
    # Signing certificate
    echo "Signing Certificate:"
    echo "-------------------"
    if keytool -printcert -jarfile "$apk" 2>/dev/null; then
        echo ""
        # Extract certificate fingerprint
        CERT_FINGERPRINT=$(keytool -printcert -jarfile "$apk" 2>/dev/null | grep -A 2 "Certificate fingerprints" | grep SHA256 | awk '{print $4}')
        echo "SHA256 Fingerprint: $CERT_FINGERPRINT"
    else
        echo "ERROR: Could not extract certificate. APK may be unsigned or corrupted."
        return 1
    fi
    echo ""
    
    # Package info (if aapt is available)
    if [ "$AAPT_AVAILABLE" = true ]; then
        echo "Package Information:"
        echo "-------------------"
        if [ -n "$AAPT_PATH" ]; then
            "$AAPT_PATH" dump badging "$apk" 2>/dev/null | grep -E "(package|versionCode|versionName)" || echo "Could not extract package info"
        else
            aapt dump badging "$apk" 2>/dev/null | grep -E "(package|versionCode|versionName)" || echo "Could not extract package info"
        fi
        echo ""
    fi
    
    # APK integrity check
    echo "APK Integrity:"
    echo "-------------"
    if unzip -t "$apk" > /dev/null 2>&1; then
        echo "✓ APK file is valid (not corrupted)"
    else
        echo "✗ APK file is CORRUPTED!"
        echo "  This could be the cause of 'App not installed' error."
        return 1
    fi
    echo ""
}

# Analyze first APK
extract_apk_info "$APK1" "APK 1"

# If second APK provided, analyze and compare
if [ -n "$APK2" ]; then
    extract_apk_info "$APK2" "APK 2"
    
    echo "=========================================="
    echo "COMPARISON RESULTS"
    echo "=========================================="
    echo ""
    
    # Extract fingerprints
    FINGERPRINT1=$(keytool -printcert -jarfile "$APK1" 2>/dev/null | grep -A 2 "Certificate fingerprints" | grep SHA256 | awk '{print $4}')
    FINGERPRINT2=$(keytool -printcert -jarfile "$APK2" 2>/dev/null | grep -A 2 "Certificate fingerprints" | grep SHA256 | awk '{print $4}')
    
    if [ -z "$FINGERPRINT1" ] || [ -z "$FINGERPRINT2" ]; then
        echo "ERROR: Could not extract fingerprints for comparison"
        exit 1
    fi
    
    if [ "$FINGERPRINT1" = "$FINGERPRINT2" ]; then
        echo "✓ SIGNING KEYS MATCH"
        echo "  Both APKs are signed with the same key."
        echo "  This is GOOD - updates should work."
        echo ""
        echo "If users still get 'App not installed' error:"
        echo "  1. Check for corrupted downloads"
        echo "  2. Verify sufficient storage space"
        echo "  3. Check Android version compatibility"
    else
        echo "✗ SIGNING KEYS DO NOT MATCH"
        echo "  This is the PROBLEM!"
        echo ""
        echo "APK 1 Fingerprint: $FINGERPRINT1"
        echo "APK 2 Fingerprint: $FINGERPRINT2"
        echo ""
        echo "SOLUTION:"
        echo "  Android requires the same signing key for app updates."
        echo "  You must rebuild the newer APK using the SAME key as the older one."
        echo ""
        echo "If using EAS Build:"
        echo "  1. Check your EAS credentials: eas credentials"
        echo "  2. Ensure you're using the same Android keystore"
        echo "  3. Rebuild the APK with the correct credentials"
        echo ""
        echo "If building locally:"
        echo "  1. Locate the keystore used for APK 1"
        echo "  2. Use that SAME keystore to build APK 2"
        echo "  3. Never create a new keystore for updates"
        exit 1
    fi
fi

echo ""
echo "=========================================="
echo "Verification Complete"
echo "=========================================="







