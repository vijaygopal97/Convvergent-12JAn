#!/bin/bash

# Test load balancer distribution
echo "Testing Load Balancer Distribution (30 requests)..."
echo ""

results=""
for i in {1..30}; do
    server=$(curl -s http://localhost/health 2>/dev/null | grep -o '"server":"[^"]*"' | head -1 | cut -d'"' -f4)
    results="${results}${server}\n"
    sleep 0.1
done

echo "Distribution:"
echo -e "$results" | sort | uniq -c | sort -rn
echo ""
echo "Expected: Primary (60%), Server 1 (40%)"





