#!/bin/bash

echo "=== Testing Audio Proxy Endpoint ==="
echo ""

# Test 1: Check if backend is running
echo "1. Checking backend status..."
pm2 list | grep opine-backend | grep -q online && echo "   ✅ Backend is running" || echo "   ❌ Backend is not running"

# Test 2: Check route is defined
echo ""
echo "2. Checking route definition..."
grep -q "router.get('/audio/\*'" /var/www/opine/backend/routes/surveyResponseRoutes.js && echo "   ✅ Route defined" || echo "   ❌ Route not found"

# Test 3: Check controller function
echo ""
echo "3. Checking controller function..."
grep -q "const streamAudioProxy" /var/www/opine/backend/controllers/surveyResponseController.js && echo "   ✅ Controller function exists" || echo "   ❌ Controller function not found"

# Test 4: Check path extraction logic
echo ""
echo "4. Checking path extraction logic..."
grep -q "pathMatch = pathWithoutQuery.match" /var/www/opine/backend/controllers/surveyResponseController.js && echo "   ✅ Path extraction logic exists" || echo "   ❌ Path extraction logic not found"

# Test 5: Check frontend proxy URL construction
echo ""
echo "5. Checking frontend proxy URL construction..."
grep -q "getProxyUrl" /var/www/opine/frontend/src/components/dashboard/ResponseDetailsModal.jsx && echo "   ✅ Frontend getProxyUrl function exists" || echo "   ❌ Frontend getProxyUrl function not found"

echo ""
echo "=== Test Complete ==="
echo ""
echo "To test manually:"
echo "1. Open Response Details Modal"
echo "2. Check browser console for proxy URL logs"
echo "3. Check network tab for /api/survey-responses/audio/ requests"
echo "4. Check backend logs: pm2 logs opine-backend | grep streamAudioProxy"
