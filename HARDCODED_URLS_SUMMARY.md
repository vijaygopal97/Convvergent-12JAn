# Hardcoded URLs Analysis - Complete Summary

## 📊 **Total Hardcoded URLs Found: 13 locations**

---

## 📱 **React Native App (Opine-Android) - 6 instances**

### **Critical (Main API Service):**
1. **`src/services/api.ts:6`**
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** 🔴 CRITICAL - Used by ALL API calls
   - **Affects:** Every API request in the app

### **High Impact (Interview Interface):**
2. **`src/screens/InterviewInterface.tsx:71`**
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** 🟠 HIGH - Interview interface API calls

3. **`src/services/InterviewInterface.tsx:68`**
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** 🟠 HIGH - Interview service API calls

### **Medium Impact (Response Details):**
4. **`src/components/ResponseDetailsModal.tsx:270`**
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** 🟡 MEDIUM - CATI recording downloads

5. **`src/components/ResponseDetailsModal.tsx:484`**
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** 🟡 MEDIUM - Audio proxy URLs

6. **`src/screens/InterviewDetails.tsx:152`**
   ```typescript
   const API_BASE_URL = 'https://convo.convergentview.com';
   ```
   - **Impact:** 🟡 MEDIUM - Audio URLs

---

## 🌐 **Web App (opine/frontend) - 9 instances**

### **SEO Configuration (Low Impact):**
1. **`frontend/src/config/seo.js:10`** - `canonical: "https://convo.convergentview.com"`
2. **`frontend/src/config/seo.js:12`** - `ogImage: "https://convo.convergentview.com/og-image.jpg"`
3. **`frontend/src/config/seo.js:23`** - `canonical: "https://convo.convergentview.com"`
4. **`frontend/src/config/seo.js:32`** - `canonical: "https://convo.convergentview.com/about"`
5. **`frontend/src/config/seo.js:39`** - `canonical: "https://convo.convergentview.com/contact"`
6. **`frontend/src/config/seo.js:48`** - `canonical: "https://convo.convergentview.com/register"`
7. **`frontend/src/config/seo.js:54`** - `canonical: "https://convo.convergentview.com/login"`
8. **`frontend/src/config/seo.js:83`** - `logo: "https://convo.convergentview.com/logo.png"`
   - **Impact:** 🟢 LOW - SEO metadata only (doesn't affect functionality)

### **Development Config (Low Impact):**
9. **`frontend/vite.config.js:11`** - `allowedHosts: ['convo.convergentview.com', ...]`
   - **Impact:** 🟢 LOW - Vite dev server only

### **✅ Already Good (Using Environment Variables):**
- `frontend/src/services/api.js` - Uses `VITE_API_BASE_URL` ✅
- `frontend/src/utils/config.js` - Has `getApiBaseUrl()` function ✅

---

## 🔧 **Backend (opine/backend) - 3 instances**

1. **`backend/server.js:65`** - CORS allowedOrigins
   ```javascript
   allowedOrigins = [CORS_ORIGIN, 'https://convo.convergentview.com', ...]
   ```
   - **Impact:** 🟡 MEDIUM - CORS configuration

2. **`backend/test_load_balancer_distribution.js:5`** - Test file
   - **Impact:** 🟢 LOW - Test only

3. **`backend/test_1000_survey_api_load.js:5`** - Test file
   - **Impact:** 🟢 LOW - Test only

---

## 💡 **Recommended Solution: Unified Configuration**

### **Strategy: Centralized Config Files**

#### **For React Native App:**

**Step 1: Create `src/config/api.ts`**
```typescript
// Centralized API configuration
const getApiBaseUrl = () => {
  // Priority 1: Environment variable (Expo)
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  }
  
  // Priority 2: Constants from app.json (if using Expo Constants)
  // const Constants = require('expo-constants');
  // if (Constants.expoConfig?.extra?.apiBaseUrl) {
  //   return Constants.expoConfig.extra.apiBaseUrl;
  // }
  
  // Priority 3: Default fallback
  return 'https://convo.convergentview.com';
};

export const API_BASE_URL = getApiBaseUrl();
export default API_BASE_URL;
```

**Step 2: Update `app.json`**
```json
{
  "expo": {
    "extra": {
      "apiBaseUrl": "https://convo.convergentview.com"
    }
  }
}
```

**Step 3: Replace all 6 hardcoded URLs**
- Replace: `const API_BASE_URL = 'https://convo.convergentview.com';`
- With: `import { API_BASE_URL } from '../config/api';` (or relative path)

---

#### **For Web App:**

**Step 1: Update `seo.js`**
```javascript
// Get base URL from environment or window location
const getBaseUrl = () => {
  // Priority 1: Environment variable
  if (import.meta.env.VITE_BASE_URL) {
    return import.meta.env.VITE_BASE_URL;
  }
  
  // Priority 2: Current window origin (dynamic)
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  
  // Priority 3: Default fallback
  return 'https://convo.convergentview.com';
};

const BASE_URL = getBaseUrl();

export const SEO_CONFIG = {
  default: {
    canonical: BASE_URL,
    ogImage: `${BASE_URL}/og-image.jpg`,
    // ...
  },
  routes: {
    "/": {
      canonical: BASE_URL,
      // ...
    },
    "/about": {
      canonical: `${BASE_URL}/about`,
      // ...
    },
    // ... other routes
  }
};
```

**Step 2: Add to `.env`**
```env
VITE_BASE_URL=https://convo.convergentview.com
```

**Note:** `api.js` and `config.js` are already good ✅

---

#### **For Backend:**

**Step 1: Update `server.js`**
```javascript
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3001';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://convo.convergentview.com';
const ADDITIONAL_ORIGINS = process.env.ADDITIONAL_CORS_ORIGINS 
  ? process.env.ADDITIONAL_CORS_ORIGINS.split(',').map(o => o.trim())
  : ['https://opine.exypnossolutions.com'];

const allowedOrigins = CORS_ORIGIN.includes(',') 
  ? CORS_ORIGIN.split(',').map(origin => origin.trim())
  : [CORS_ORIGIN, FRONTEND_URL, ...ADDITIONAL_ORIGINS].filter(Boolean);
```

**Step 2: Add to `.env`**
```env
FRONTEND_URL=https://convo.convergentview.com
ADDITIONAL_CORS_ORIGINS=https://opine.exypnossolutions.com
```

---

## 📋 **Implementation Priority**

### **High Priority (Affects Functionality):**
1. ✅ React Native: `src/services/api.ts` (CRITICAL)
2. ✅ React Native: Interview interface files (HIGH)
3. ✅ Backend: CORS configuration (MEDIUM)

### **Low Priority (Doesn't Affect Functionality):**
4. ⚠️ Web App: SEO config (LOW - metadata only)
5. ⚠️ Web App: Vite config (LOW - dev server only)
6. ⚠️ Backend: Test files (LOW - testing only)

---

## ✅ **Benefits of Unified Configuration**

1. **Single Source of Truth:**
   - Change URL in one place (config file or env)
   - All components automatically use new URL

2. **Environment-Specific:**
   - Development: `http://localhost:5000`
   - Staging: `https://staging.example.com`
   - Production: `https://convo.convergentview.com`

3. **Easy Deployment:**
   - No code changes needed
   - Just update `.env` or `app.json`
   - Rebuild/restart

4. **Maintainability:**
   - Clear where URLs are configured
   - Easy to find and update
   - Less prone to errors

---

## ⚠️ **Important Notes**

1. **React Native (Expo):**
   - Use `EXPO_PUBLIC_*` prefix for environment variables
   - Or use `app.json` extra config
   - Variables must be available at build time

2. **Web App (Vite):**
   - Use `VITE_*` prefix for environment variables
   - Variables must be in `.env` file
   - Access via `import.meta.env.VITE_*`

3. **Backend (Node.js):**
   - Use standard `process.env.*`
   - Load from `.env` file using `dotenv`
   - Can be set at runtime

4. **Test Files:**
   - Can keep hardcoded URLs (they're for testing specific environments)

---

## 🔄 **Migration Steps (When Ready)**

1. **Create config files** (one per platform)
2. **Add environment variables** to `.env` files
3. **Replace hardcoded URLs** with imports
4. **Test in each environment** (dev, staging, prod)
5. **Update documentation** with new configuration

