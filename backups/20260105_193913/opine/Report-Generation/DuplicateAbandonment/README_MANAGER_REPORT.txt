═══════════════════════════════════════════════════════════════════════════════
MANAGER DUPLICATE REPORT - EXPLANATION
═══════════════════════════════════════════════════════════════════════════════

REPORT FILE:
Manager_Duplicate_Report_2026-01-04T10-47-22.csv

HOW TO OPEN:
1. Open Microsoft Excel or Google Sheets
2. File → Open → Select the CSV file
3. The report will display in spreadsheet format

═══════════════════════════════════════════════════════════════════════════════
WHAT THIS REPORT SHOWS
═══════════════════════════════════════════════════════════════════════════════

This report proves that 1,409 responses marked as "abandoned" are TRUE DUPLICATES
of other interviews. Each row shows:

1. ORIGINAL RESPONSE (kept for analysis)
   - Response ID, Status, Date Created
   - Interview Start Time, End Time, Duration
   - Number of Questions Answered
   - GPS Location (if available)
   - Audio Recording Status

2. DUPLICATE RESPONSE (marked as abandoned)
   - Response ID, Status (now "abandoned")
   - Interview Start Time, End Time, Duration
   - Number of Questions Answered
   - GPS Location (if available)
   - Audio Recording Status

3. PROOF OF DUPLICATION
   - "Why Duplicate?" column explains in plain English
   - "Evidence of Duplication" lists all matching fields
   - "All Fields Match?" confirms if data is identical

═══════════════════════════════════════════════════════════════════════════════
KEY COLUMNS EXPLAINED
═══════════════════════════════════════════════════════════════════════════════

Group #: Groups responses that are duplicates of each other
Content Hash: Digital fingerprint proving they're identical
Why Duplicate?: Simple explanation of why they match
Time Difference: How many minutes apart they were submitted
All Fields Match?: Yes = completely identical, Mostly = nearly identical
Evidence of Duplication: List of all matching fields (timing, answers, location, etc.)

═══════════════════════════════════════════════════════════════════════════════
SUMMARY STATISTICS
═══════════════════════════════════════════════════════════════════════════════

Total Duplicate Groups: 1,175
Total Duplicates Marked as Abandoned: 1,409
Date of Detection: January 4, 2026

═══════════════════════════════════════════════════════════════════════════════
WHY THESE ARE DUPLICATES
═══════════════════════════════════════════════════════════════════════════════

These responses have identical "Content Hash" - a digital fingerprint created from:
- Interview start time
- Interview end time  
- Total duration
- All question responses
- GPS location (for CAPI interviews)

When all these match exactly, it means the SAME interview was submitted multiple times.
This can happen due to:
- Network issues causing retries
- App sync problems
- User accidentally submitting twice

Only the ORIGINAL (first submitted) response is kept. Duplicates are marked as
"abandoned" to prevent double-counting in analysis.

═══════════════════════════════════════════════════════════════════════════════
