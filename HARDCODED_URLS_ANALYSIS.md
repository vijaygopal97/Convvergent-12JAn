# Hardcoded URLs Analysis - Complete Report

## 🔍 Summary

Found **hardcoded `https://convo.convergentview.com` URLs** in multiple locations across both web app and React Native app.

---

## 📱 **React Native App (Opine-Android)**

### Files with Hardcoded URLs:

1. **`src/services/api.ts`** (Line 6)
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** HIGH - This is the main API service file
   - **Used by:** All API calls in the React Native app

2. **`src/screens/InterviewInterface.tsx`** (Line 71)
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** MEDIUM - Used for specific API calls in interview interface

3. **`src/services/InterviewInterface.tsx`** (Line 68)
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** MEDIUM - Used for interview-related API calls

4. **`src/components/ResponseDetailsModal.tsx`** (Lines 270, 484)
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** MEDIUM - Used for CATI recording downloads and audio URLs

5. **`src/screens/InterviewDetails.tsx`** (Line 152)
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** LOW - Used for audio proxy URLs

---

## 🌐 **Web App (opine/frontend)**

### Files with Hardcoded URLs:

1. **`frontend/src/config/seo.js`** (Multiple lines)
   ```javascript
   canonical: "https://convo.convergentview.com",
   ogImage: "https://convo.convergentview.com/og-image.jpg",
   logo: "https://convo.convergentview.com/logo.png",
   ```
   - **Impact:** LOW - SEO metadata only
   - **Used by:** SEO configuration

2. **`frontend/vite.config.js`** (Line 11)
   ```javascript
   allowedHosts: ['convo.convergentview.com', ...]
   ```
   - **Impact:** LOW - Development server configuration
   - **Used by:** Vite dev server

### Files with GOOD Configuration (Using Environment Variables):

1. **`frontend/src/services/api.js`** ✅
   - Uses: `import.meta.env.VITE_API_BASE_URL`
   - Has smart logic for HTTPS/HTTP detection

2. **`frontend/src/utils/config.js`** ✅
   - Has `getApiBaseUrl()` function
   - Uses environment variables correctly

---

## 🔧 **Backend (opine/backend)**

### Files with Hardcoded URLs:

1. **`backend/server.js`** (Line 65)
   ```javascript
   allowedOrigins = [CORS_ORIGIN, 'https://convo.convergentview.com', ...]
   ```
   - **Impact:** MEDIUM - CORS configuration
   - **Used by:** CORS middleware

2. **`backend/test_load_balancer_distribution.js`** (Line 5)
   ```javascript
   const BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** LOW - Test file only

3. **`backend/test_1000_survey_api_load.js`** (Line 5)
   ```javascript
   const BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** LOW - Test file only

---

## 💡 **Recommended Solution: Unified Configuration**

### **Option 1: Environment Variables (Recommended)**

#### **For React Native App:**

1. **Create `src/config/api.ts`:**
   ```typescript
   const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 
                        'https://convo.convergentview.com';
   export default API_BASE_URL;
   ```

2. **Update `app.json` or `.env`:**
   ```json
   {
     "expo": {
       "extra": {
         "apiBaseUrl": "https://convo.convergentview.com"
       }
     }
   }
   ```

3. **Replace all hardcoded URLs:**
   - Import from `src/config/api.ts` instead of hardcoding
   - Use: `import API_BASE_URL from '../config/api';`

#### **For Web App:**

1. **Already using environment variables** ✅
   - Keep using `VITE_API_BASE_URL`
   - Update `.env` file for different environments

2. **For SEO config (`seo.js`):**
   ```javascript
   const BASE_URL = import.meta.env.VITE_BASE_URL || 
                    window.location.origin || 
                    'https://convo.convergentview.com';
   ```

#### **For Backend:**

1. **Update `server.js` CORS:**
   ```javascript
   const allowedOrigins = [
     process.env.CORS_ORIGIN,
     process.env.FRONTEND_URL || 'https://convo.convergentview.com',
     // ... other origins from env
   ].filter(Boolean);
   ```

---

## 📋 **Implementation Plan**

### **Step 1: React Native App**
1. Create `src/config/api.ts` with environment variable support
2. Replace all 5 hardcoded URLs with import from config
3. Add `EXPO_PUBLIC_API_BASE_URL` to `.env` or `app.json`

### **Step 2: Web App**
1. Update `seo.js` to use environment variable
2. Keep existing `api.js` and `config.js` (already good)

### **Step 3: Backend**
1. Add `FRONTEND_URL` to `.env`
2. Update CORS to use environment variable
3. Test files can keep hardcoded URLs (they're for testing only)

---

## ✅ **Benefits**

1. **Easy Environment Switching:**
   - Development: `http://localhost:5000`
   - Staging: `https://staging.example.com`
   - Production: `https://convo.convergentview.com`

2. **No Code Changes Needed:**
   - Just update `.env` or `app.json`
   - Restart/rebuild app

3. **Consistent Configuration:**
   - Single source of truth
   - Easier to maintain

---

## ⚠️ **Important Notes**

1. **React Native:** Use `EXPO_PUBLIC_*` prefix for environment variables
2. **Web App:** Use `VITE_*` prefix for Vite environment variables
3. **Backend:** Use standard `process.env.*` for Node.js
4. **Test Files:** Can keep hardcoded URLs (they're for testing only)

