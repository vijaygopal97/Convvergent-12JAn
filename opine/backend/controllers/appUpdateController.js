const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * @desc    Check for app updates
 * @route   GET /api/app/check-update
 * @access  Public (but can add auth if needed)
 */
const checkAppUpdate = async (req, res) => {
  try {
    const currentVersion = req.query.version || req.query.versionCode || null;
    const currentVersionCode = currentVersion ? parseInt(currentVersion) : null;
    
    // APK directory
    const apkDir = path.join(__dirname, '../../uploads/apks');
    
    // Ensure directory exists
    if (!fs.existsSync(apkDir)) {
      fs.mkdirSync(apkDir, { recursive: true });
    }
    
    // Scan directory for APK files
    // Naming convention: Convergent-v{versionCode}.apk
    // Example: Convergent-v14.apk, Convergent-v15.apk
    const files = fs.readdirSync(apkDir);
    const apkFiles = files.filter(file => 
      file.toLowerCase().endsWith('.apk') && 
      file.toLowerCase().includes('convergent')
    );
    
    if (apkFiles.length === 0) {
      return res.json({
        success: true,
        hasUpdate: false,
        message: 'No APK files found on server'
      });
    }
    
    // Extract version codes from filenames
    // Pattern: Convergent-v{number}.apk or Convergent-v{number}-*.apk
    const apkVersions = apkFiles.map(file => {
      const match = file.match(/Convergent-v(\d+)/i);
      if (match && match[1]) {
        const versionCode = parseInt(match[1]);
        return {
          versionCode,
          filename: file,
          filepath: path.join(apkDir, file)
        };
      }
      return null;
    }).filter(Boolean).sort((a, b) => b.versionCode - a.versionCode); // Sort descending
    
    if (apkVersions.length === 0) {
      return res.json({
        success: true,
        hasUpdate: false,
        message: 'No valid APK files found (check naming convention: Convergent-v{versionCode}.apk)'
      });
    }
    
    // Get latest version (highest versionCode)
    const latestVersion = apkVersions[0];
    
    // Check if update is available
    const hasUpdate = currentVersionCode === null || currentVersionCode < latestVersion.versionCode;
    
    // Get file info
    const stats = fs.statSync(latestVersion.filepath);
    const fileSize = stats.size;
    
    // Generate file hash for verification
    const fileBuffer = fs.readFileSync(latestVersion.filepath);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    // Build download URL - FIXED: Properly detect HTTPS when behind nginx proxy
    // Check X-Forwarded-Proto header (set by nginx) for HTTPS detection
    // This ensures download URLs are HTTPS even when backend receives HTTP from nginx
    // This is a backend-only fix - no app update required (works with existing APKs)
    let downloadUrl;
    
    if (process.env.BASE_URL) {
      // If BASE_URL is explicitly set, use it (should include protocol)
      const baseURL = process.env.BASE_URL;
      downloadUrl = baseURL.endsWith('/') 
        ? `${baseURL}api/app/download/${latestVersion.versionCode}`
        : `${baseURL}/api/app/download/${latestVersion.versionCode}`;
    } else {
      // Detect protocol from request headers (for nginx proxy scenarios)
      // X-Forwarded-Proto is set by nginx when proxying HTTPS requests
      let protocol = 'https'; // Default to HTTPS for security (required for Android 9+)
      
      const forwardedProto = req.headers['x-forwarded-proto'];
      if (forwardedProto === 'https' || forwardedProto === 'http') {
        protocol = forwardedProto;
      } else if (req.secure) {
        // req.secure is true if connection is HTTPS (direct connection, not proxied)
        protocol = 'https';
      } else if (req.protocol === 'https') {
        protocol = 'https';
      }
      // Otherwise keep default 'https'
      
      const host = req.get('host');
      const baseURL = `${protocol}://${host}`;
      downloadUrl = `${baseURL}/api/app/download/${latestVersion.versionCode}`;
    }
    
    // Check if this is a force update (critical version)
    // You can customize this logic - for now, no force updates
    const isForceUpdate = false;
    const minRequiredVersion = null; // Set this if you want to force updates for old versions
    
    const response = {
      success: true,
      hasUpdate: hasUpdate,
      currentVersion: currentVersionCode,
      latestVersion: latestVersion.versionCode.toString(),
      latestVersionCode: latestVersion.versionCode,
      downloadUrl: downloadUrl,
      fileSize: fileSize,
      fileHash: fileHash,
      filename: latestVersion.filename,
      releaseDate: stats.mtime.toISOString(),
      isForceUpdate: isForceUpdate,
      minRequiredVersion: minRequiredVersion,
      // Optional: Add release notes here (can be stored in a JSON file or database)
      releaseNotes: `Version ${latestVersion.versionCode} - Bug fixes and improvements`
    };
    
    // If no update, still return success but with hasUpdate: false
    if (!hasUpdate) {
      response.message = 'App is up to date';
    }
    
    console.log(`📱 App update check - Current: ${currentVersionCode}, Latest: ${latestVersion.versionCode}, Update available: ${hasUpdate}`);
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error checking app update:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check for app updates',
      error: error.message
    });
  }
};

/**
 * @desc    Download APK file by version code
 * @route   GET /api/app/download/:versionCode
 * @access  Public (but can add auth if needed)
 */
const downloadApp = async (req, res) => {
  try {
    const versionCode = parseInt(req.params.versionCode);
    
    if (isNaN(versionCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid version code'
      });
    }
    
    // APK directory
    const apkDir = path.join(__dirname, '../../uploads/apks');
    
    // Find APK file for this version
    // Support multiple naming patterns:
    // - Convergent-v{versionCode}.apk (preferred)
    // - Convergent-v{versionCode}-*.apk (with suffix)
    const files = fs.readdirSync(apkDir);
    let apkFile = files.find(file => {
      const lowerFile = file.toLowerCase();
      if (!lowerFile.endsWith('.apk')) return false;
      
      // Exact match: Convergent-v{versionCode}.apk
      if (lowerFile === `convergent-v${versionCode}.apk`) {
        return true;
      }
      
      // Pattern match: Convergent-v{versionCode}-*.apk
      const pattern = new RegExp(`^convergent-v${versionCode}-.*\\.apk$`, 'i');
      return pattern.test(file);
    });
    
    if (!apkFile) {
      return res.status(404).json({
        success: false,
        message: `APK file for version ${versionCode} not found. Expected naming: Convergent-v${versionCode}.apk`
      });
    }
    
    const filePath = path.join(apkDir, apkFile);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'APK file not found on server'
      });
    }
    
    // Get file stats
    const stats = fs.statSync(filePath);
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${apkFile}"`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Generate and set ETag for caching
    const fileHash = crypto.createHash('md5').update(filePath + stats.mtime.getTime()).digest('hex');
    res.setHeader('ETag', fileHash);
    
    // Check If-None-Match header for conditional requests
    const clientETag = req.headers['if-none-match'];
    if (clientETag === fileHash) {
      return res.status(304).end(); // Not Modified
    }
    
    // Stream file to client
    console.log(`📥 Downloading APK: ${apkFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('❌ Error streaming APK file:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error streaming APK file',
          error: error.message
        });
      }
    });
    
  } catch (error) {
    console.error('❌ Error downloading app:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download app',
        error: error.message
      });
    }
  }
};

module.exports = {
  checkAppUpdate,
  downloadApp
};



