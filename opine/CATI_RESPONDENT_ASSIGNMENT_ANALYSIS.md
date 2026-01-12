# CATI Respondent Assignment - Complete Analysis

## 📋 How Respondents Are Assigned

### Assignment Logic
**File:** `/var/www/opine/backend/controllers/catiInterviewController.js`  
**Function:** `startCatiInterview()` (lines 446-515)

### Key Rules:
1. **ONLY `status: 'pending'` respondents are assigned**
2. **Selection Priority:**
   - First: Priority-based AC selection (if AC priority file exists)
   - Second: Non-prioritized ACs (excluding Priority 0 ACs)
   - Third: Any pending respondent (excluding Priority 0 ACs)
3. **Sorting:** `createdAt: 1` (oldest first)
4. **Once assigned:**
   - Status changes to `'assigned'`
   - `assignedTo` = interviewer ID
   - `assignedAt` = current timestamp

---

## 🔄 Status Flow

### Status Transitions:
1. **Starting Interview:**
   - `'pending'` → `'assigned'`

2. **Making Call:**
   - `'assigned'` → `'calling'`

3. **Abandoning:**
   - `'call_later'` → `'pending'` (with `priority: 10`)
   - `'call_failed'` → `'pending'` (for retry)
   - Other reasons → specific status (e.g., `'not_interested'`, `'busy'`, `'does_not_exist'`)

4. **Completing:**
   - `'calling'` → `'interview_success'`

---

## ❓ Why Changing Status to "Pending" Doesn't Work as Expected

### The Problem:
When you manually change a respondent's status to `'pending'`:
- ✅ The respondent **CAN** be assigned again
- ❌ But it will be selected based on **ORIGINAL `createdAt` timestamp**
- ❌ If there are many older `'pending'` respondents, it won't be selected immediately
- ❌ The system selects the **OLDEST** `'pending'` respondent first

### Example:
```
Respondent A: createdAt = 2025-01-01, status = 'pending'
Respondent B: createdAt = 2025-01-05, status = 'interview_success'
Respondent C: createdAt = 2025-01-10, status = 'pending'

You change Respondent B to 'pending':
- Respondent B: createdAt = 2025-01-05, status = 'pending' (changed)

Next assignment will be:
1. Respondent A (oldest pending)
2. Respondent B (if A is assigned)
3. Respondent C (if A and B are assigned)
```

---

## 🔍 How to Check Next Respondent

### Method 1: MongoDB Query (Direct)
```javascript
// Connect to MongoDB
use your_database_name

// Find next respondent (all ACs)
db.catirespondentqueues.findOne({
  survey: ObjectId("68fd1915d41841da463f0d46"),
  status: "pending"
}).sort({ createdAt: 1 })

// Find next respondent (specific AC)
db.catirespondentqueues.findOne({
  survey: ObjectId("68fd1915d41841da463f0d46"),
  status: "pending",
  "respondentContact.ac": "AC_NAME"
}).sort({ createdAt: 1 })

// Find next respondent (with priority)
db.catirespondentqueues.findOne({
  survey: ObjectId("68fd1915d41841da463f0d46"),
  status: "pending"
}).sort({ priority: -1, createdAt: 1 })
```

### Method 2: Check via API
**Endpoint:** `POST /api/cati-interview/start/:surveyId`  
**Response:** Returns the next assigned respondent (if available)

---

## ✅ How to Put Respondent Back for Manual Recall

### Option 1: Reset to Pending (End of Queue - Recommended for Manual Recall)
**Use Case:** You want to call this respondent again, but after all other pending respondents.

```javascript
db.catirespondentqueues.updateOne(
  { _id: ObjectId("RESPONDENT_ID") },
  { 
    $set: { 
      status: "pending",
      createdAt: new Date(),  // ⚠️ CRITICAL: Put at end of queue
      assignedTo: null,
      assignedAt: null,
      priority: 0  // Reset priority
    }
  }
)
```

**Result:** Respondent will be selected **AFTER** all existing pending respondents.

---

### Option 2: Reset to Pending (High Priority - Front of Queue)
**Use Case:** You want to call this respondent **IMMEDIATELY** (next assignment).

```javascript
db.catirespondentqueues.updateOne(
  { _id: ObjectId("RESPONDENT_ID") },
  { 
    $set: { 
      status: "pending",
      priority: 999,  // ⚠️ CRITICAL: High priority (will be selected first)
      assignedTo: null,
      assignedAt: null
    }
  }
)
```

**Result:** Respondent will be selected **BEFORE** all other pending respondents (if AC matches priority).

---

### Option 3: Reset to Pending (Same Position - Keep Original Order)
**Use Case:** You want to keep the original queue position.

```javascript
db.catirespondentqueues.updateOne(
  { _id: ObjectId("RESPONDENT_ID") },
  { 
    $set: { 
      status: "pending",
      assignedTo: null,
      assignedAt: null
      // ⚠️ Keep original createdAt - will be selected in original order
    }
  }
)
```

**Result:** Respondent will be selected based on original `createdAt` timestamp.

---

## 📊 Summary

### To Check Next Respondent:
```bash
# MongoDB query
db.catirespondentqueues.findOne({
  survey: ObjectId("68fd1915d41841da463f0d46"),
  status: "pending"
}).sort({ priority: -1, createdAt: 1 })
```

### To Put Respondent Back for Manual Recall:
**For immediate recall (next assignment):**
```javascript
db.catirespondentqueues.updateOne(
  { _id: ObjectId("RESPONDENT_ID") },
  { $set: { status: "pending", priority: 999, assignedTo: null, assignedAt: null } }
)
```

**For recall after other pending respondents:**
```javascript
db.catirespondentqueues.updateOne(
  { _id: ObjectId("RESPONDENT_ID") },
  { $set: { status: "pending", createdAt: new Date(), assignedTo: null, assignedAt: null, priority: 0 } }
)
```

---

## ⚠️ Important Notes

1. **Only `'pending'` status is assigned** - All other statuses are excluded
2. **`createdAt` determines order** - Oldest pending respondents are selected first
3. **`priority` can override order** - Higher priority respondents are selected first (if AC matches)
4. **AC filtering applies** - If interviewer has assigned ACs, only those ACs are considered
5. **Manual status changes work** - But you must also update `createdAt` or `priority` to control position

