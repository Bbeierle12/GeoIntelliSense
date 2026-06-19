#!/usr/bin/env bash
# =============================================================================
# GeoIntelliSense Yard Management API Test Suite
# Tests CRUD on /api/yard/features, spatial bbox filtering, error handling,
# and /api/yard/context composite endpoint.
#
# Usage: bash tests/yard_api.test.sh
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
PASS_COUNT=0
FAIL_COUNT=0
CREATED_IDS=()

# -- Colors --
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# -- Helpers --

pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    echo -e "  ${GREEN}PASS${NC} $1"
}

fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo -e "  ${RED}FAIL${NC} $1"
    if [[ -n "${2:-}" ]]; then
        echo -e "       ${RED}$2${NC}"
    fi
}

assert_status() {
    local expected="$1" actual="$2" label="$3"
    if [[ "$actual" == "$expected" ]]; then
        pass "$label (HTTP $actual)"
    else
        fail "$label" "expected HTTP $expected, got $actual"
    fi
}

assert_json_field() {
    local json="$1" field="$2" label="$3"
    local val
    val=$(echo "$json" | jq -r "$field" 2>/dev/null)
    if [[ -n "$val" && "$val" != "null" ]]; then
        pass "$label — field $field present"
    else
        fail "$label" "field $field is missing or null"
    fi
}

cleanup_feature() {
    local id="$1"
    curl -s -o /dev/null -X DELETE "${BASE_URL}/api/yard/features/${id}" 2>/dev/null || true
}

# -- Dependency check --

echo "=== Checking dependencies ==="

if ! command -v jq &>/dev/null; then
    echo "jq not found, attempting to install..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y -qq jq
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y jq
    elif command -v brew &>/dev/null; then
        brew install jq
    else
        echo "ERROR: Cannot install jq automatically. Please install it manually."
        exit 1
    fi
fi

if ! command -v curl &>/dev/null; then
    echo "ERROR: curl is required but not installed."
    exit 1
fi

echo "  jq: $(jq --version)"
echo "  curl: $(curl --version | head -1)"

# -- Connectivity check --

echo ""
echo "=== Checking API connectivity ==="

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/yard/features" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "000" ]]; then
    echo -e "${RED}ERROR: Cannot reach ${BASE_URL}. Is the server running?${NC}"
    exit 1
fi
echo "  API reachable at ${BASE_URL} (HTTP ${HTTP_CODE})"

# =============================================================================
# 1. Cleanup any existing test data
# =============================================================================

echo ""
echo "=== Phase 1: Pre-test cleanup ==="

EXISTING=$(curl -s "${BASE_URL}/api/yard/features")
EXISTING_IDS=$(echo "$EXISTING" | jq -r '.features[]? | select(.name | startswith("__TEST_")) | .id' 2>/dev/null || true)

if [[ -n "$EXISTING_IDS" ]]; then
    while IFS= read -r id; do
        cleanup_feature "$id"
        echo "  Cleaned up pre-existing test feature: $id"
    done <<< "$EXISTING_IDS"
else
    echo "  No pre-existing test data found."
fi

# =============================================================================
# 2. POST create — verify 201 and response fields
# =============================================================================

echo ""
echo "=== Test 2: POST /api/yard/features (create) ==="

CREATE_BODY='{
    "name": "__TEST_garden_bed",
    "vertices": [
        {"lat": 40.7128, "lng": -74.0060},
        {"lat": 40.7130, "lng": -74.0060},
        {"lat": 40.7130, "lng": -74.0058},
        {"lat": 40.7128, "lng": -74.0058}
    ],
    "area_sqft": 150.5,
    "area_sqm": 13.98,
    "measurement_type": "map",
    "metadata": {"type": "garden_bed", "test": true}
}'

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "$CREATE_BODY" \
    "${BASE_URL}/api/yard/features")

HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

assert_status "201" "$HTTP_STATUS" "POST create returns 201"

FEATURE_ID=$(echo "$BODY" | jq -r '.id' 2>/dev/null)
if [[ -n "$FEATURE_ID" && "$FEATURE_ID" != "null" ]]; then
    CREATED_IDS+=("$FEATURE_ID")
    pass "Response contains id ($FEATURE_ID)"
else
    fail "Response missing id field"
fi

assert_json_field "$BODY" ".name" "POST create"
assert_json_field "$BODY" ".areaSqft" "POST create"
assert_json_field "$BODY" ".areaSqm" "POST create"
assert_json_field "$BODY" ".vertices" "POST create"
assert_json_field "$BODY" ".geometry" "POST create"
assert_json_field "$BODY" ".measurementType" "POST create"
assert_json_field "$BODY" ".createdAt" "POST create"

# Verify the name matches
RETURNED_NAME=$(echo "$BODY" | jq -r '.name')
if [[ "$RETURNED_NAME" == "__TEST_garden_bed" ]]; then
    pass "POST create — name matches input"
else
    fail "POST create — name mismatch" "expected '__TEST_garden_bed', got '$RETURNED_NAME'"
fi

# Verify vertices count
VERTEX_COUNT=$(echo "$BODY" | jq '.vertices | length')
if [[ "$VERTEX_COUNT" == "4" ]]; then
    pass "POST create — vertices count is 4"
else
    fail "POST create — vertices count wrong" "expected 4, got $VERTEX_COUNT"
fi

# =============================================================================
# 3. POST with invalid data (missing vertices) — verify 422 or 400
# =============================================================================

echo ""
echo "=== Test 3: POST with invalid data (missing vertices) ==="

INVALID_BODY='{
    "name": "__TEST_invalid_no_vertices",
    "area_sqft": 50.0,
    "area_sqm": 4.65,
    "measurement_type": "map",
    "metadata": {}
}'

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "$INVALID_BODY" \
    "${BASE_URL}/api/yard/features")

HTTP_STATUS=$(echo "$RESPONSE" | tail -1)

if [[ "$HTTP_STATUS" == "422" || "$HTTP_STATUS" == "400" ]]; then
    pass "POST invalid data returns $HTTP_STATUS (expected 422 or 400)"
else
    fail "POST invalid data" "expected 422 or 400, got $HTTP_STATUS"
fi

# Also test with too few vertices (less than 3)
INVALID_BODY_FEW='{
    "name": "__TEST_invalid_few_vertices",
    "vertices": [
        {"lat": 40.0, "lng": -74.0},
        {"lat": 40.1, "lng": -74.1}
    ],
    "area_sqft": 50.0,
    "area_sqm": 4.65,
    "measurement_type": "map",
    "metadata": {}
}'

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "$INVALID_BODY_FEW" \
    "${BASE_URL}/api/yard/features")

HTTP_STATUS=$(echo "$RESPONSE" | tail -1)

if [[ "$HTTP_STATUS" == "422" || "$HTTP_STATUS" == "400" ]]; then
    pass "POST with <3 vertices returns $HTTP_STATUS (expected 422 or 400)"
else
    fail "POST with <3 vertices" "expected 422 or 400, got $HTTP_STATUS"
fi

# =============================================================================
# 4. GET list — verify returns created feature
# =============================================================================

echo ""
echo "=== Test 4: GET /api/yard/features (list) ==="

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/yard/features")
HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

assert_status "200" "$HTTP_STATUS" "GET list returns 200"

# Verify response has features array and count
assert_json_field "$BODY" ".features" "GET list"
assert_json_field "$BODY" ".count" "GET list"

# Verify our created feature appears in the list
FOUND=$(echo "$BODY" | jq --arg id "$FEATURE_ID" '.features[] | select(.id == $id) | .id' 2>/dev/null)
if [[ -n "$FOUND" && "$FOUND" != "null" ]]; then
    pass "GET list — created feature $FEATURE_ID found in results"
else
    fail "GET list" "created feature $FEATURE_ID not found in results"
fi

# =============================================================================
# 5. GET with bbox filter — verify spatial filtering
# =============================================================================

echo ""
echo "=== Test 5: GET /api/yard/features?bbox= (spatial filter) ==="

# Bounding box that contains our test feature (NYC area)
RESPONSE=$(curl -s -w "\n%{http_code}" \
    "${BASE_URL}/api/yard/features?bbox=40.71,74.01,40.72,-74.00")
HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

assert_status "200" "$HTTP_STATUS" "GET with bbox returns 200"

# Bounding box that DOES contain our feature (proper envelope around it)
RESPONSE_IN=$(curl -s -w "\n%{http_code}" \
    "${BASE_URL}/api/yard/features?bbox=40.712,-74.007,40.714,-74.005")
HTTP_STATUS_IN=$(echo "$RESPONSE_IN" | tail -1)
BODY_IN=$(echo "$RESPONSE_IN" | sed '$d')

assert_status "200" "$HTTP_STATUS_IN" "GET with containing bbox returns 200"

FOUND_IN=$(echo "$BODY_IN" | jq --arg id "$FEATURE_ID" '[.features[] | select(.id == $id)] | length')
if [[ "$FOUND_IN" -ge 1 ]]; then
    pass "GET bbox — feature found inside containing bbox"
else
    fail "GET bbox" "feature not found inside containing bbox"
fi

# Bounding box far away from our feature (should NOT contain it)
RESPONSE_OUT=$(curl -s -w "\n%{http_code}" \
    "${BASE_URL}/api/yard/features?bbox=10.0,10.0,11.0,11.0")
HTTP_STATUS_OUT=$(echo "$RESPONSE_OUT" | tail -1)
BODY_OUT=$(echo "$RESPONSE_OUT" | sed '$d')

assert_status "200" "$HTTP_STATUS_OUT" "GET with distant bbox returns 200"

FOUND_OUT=$(echo "$BODY_OUT" | jq --arg id "$FEATURE_ID" '[.features[] | select(.id == $id)] | length')
if [[ "$FOUND_OUT" -eq 0 ]]; then
    pass "GET bbox — feature NOT found in distant bbox (correct exclusion)"
else
    fail "GET bbox" "feature unexpectedly found in distant bbox"
fi

# =============================================================================
# 6. GET single by ID — verify full response
# =============================================================================

echo ""
echo "=== Test 6: GET /api/yard/features/:id (single) ==="

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/yard/features/${FEATURE_ID}")
HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

assert_status "200" "$HTTP_STATUS" "GET single returns 200"

assert_json_field "$BODY" ".id" "GET single"
assert_json_field "$BODY" ".name" "GET single"
assert_json_field "$BODY" ".areaSqft" "GET single"
assert_json_field "$BODY" ".areaSqm" "GET single"
assert_json_field "$BODY" ".vertices" "GET single"
assert_json_field "$BODY" ".geometry" "GET single"
assert_json_field "$BODY" ".measurementType" "GET single"
assert_json_field "$BODY" ".createdAt" "GET single"
assert_json_field "$BODY" ".updatedAt" "GET single"

# Verify the ID matches
RETURNED_ID=$(echo "$BODY" | jq -r '.id')
if [[ "$RETURNED_ID" == "$FEATURE_ID" ]]; then
    pass "GET single — ID matches request"
else
    fail "GET single — ID mismatch" "expected $FEATURE_ID, got $RETURNED_ID"
fi

# Verify geometry is valid GeoJSON Polygon
GEOM_TYPE=$(echo "$BODY" | jq -r '.geometry.type' 2>/dev/null)
if [[ "$GEOM_TYPE" == "Polygon" ]]; then
    pass "GET single — geometry type is Polygon"
else
    fail "GET single — geometry type" "expected 'Polygon', got '$GEOM_TYPE'"
fi

# =============================================================================
# 7. GET with non-existent ID — verify 404
# =============================================================================

echo ""
echo "=== Test 7: GET /api/yard/features/:id (non-existent) ==="

FAKE_UUID="00000000-0000-0000-0000-000000000000"
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/yard/features/${FAKE_UUID}")
HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

assert_status "404" "$HTTP_STATUS" "GET non-existent ID returns 404"

# Verify error message present
ERROR_MSG=$(echo "$BODY" | jq -r '.error' 2>/dev/null)
if [[ -n "$ERROR_MSG" && "$ERROR_MSG" != "null" ]]; then
    pass "GET 404 — error message present"
else
    fail "GET 404" "error message missing from response"
fi

# =============================================================================
# 8. DELETE — verify removal
# =============================================================================

echo ""
echo "=== Test 8: DELETE /api/yard/features/:id ==="

RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "${BASE_URL}/api/yard/features/${FEATURE_ID}")
HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

assert_status "200" "$HTTP_STATUS" "DELETE returns 200"

# Verify message field
assert_json_field "$BODY" ".message" "DELETE response"

# Verify the feature is actually gone
RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/yard/features/${FEATURE_ID}")
HTTP_STATUS=$(echo "$RESPONSE" | tail -1)

assert_status "404" "$HTTP_STATUS" "GET after DELETE returns 404"

# =============================================================================
# 9. DELETE already-deleted — verify 404
# =============================================================================

echo ""
echo "=== Test 9: DELETE already-deleted feature ==="

RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "${BASE_URL}/api/yard/features/${FEATURE_ID}")
HTTP_STATUS=$(echo "$RESPONSE" | tail -1)

assert_status "404" "$HTTP_STATUS" "DELETE already-deleted returns 404"

# Remove from our cleanup list since it is already deleted
CREATED_IDS=("${CREATED_IDS[@]/$FEATURE_ID/}")

# =============================================================================
# 10. GET /api/yard/context — verify response structure
# =============================================================================

echo ""
echo "=== Test 10: GET /api/yard/context ==="

RESPONSE=$(curl -s -w "\n%{http_code}" \
    "${BASE_URL}/api/yard/context?lat=40.7128&lng=-74.0060")
HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

assert_status "200" "$HTTP_STATUS" "GET /api/yard/context returns 200"

# Verify top-level structure keys exist (values may be null/unavailable)
for field in ".lat" ".lng" ".elevation" ".weather" ".airQuality" ".soil"; do
    KEY_EXISTS=$(echo "$BODY" | jq "has(\"${field#.}\")" 2>/dev/null)
    if [[ "$KEY_EXISTS" == "true" ]]; then
        pass "GET context — key '${field#.}' present"
    else
        fail "GET context" "key '${field#.}' missing from response"
    fi
done

# Verify lat/lng echo back correctly
RETURNED_LAT=$(echo "$BODY" | jq '.lat')
RETURNED_LNG=$(echo "$BODY" | jq '.lng')
if [[ "$RETURNED_LAT" == "40.7128" && "$RETURNED_LNG" == "-74.006" ]]; then
    pass "GET context — lat/lng echoed correctly"
else
    fail "GET context — lat/lng echo" "got lat=$RETURNED_LAT lng=$RETURNED_LNG"
fi

# =============================================================================
# 11. Post-test cleanup
# =============================================================================

echo ""
echo "=== Phase 11: Post-test cleanup ==="

# Clean up any remaining test features (belt-and-suspenders)
REMAINING=$(curl -s "${BASE_URL}/api/yard/features")
REMAINING_IDS=$(echo "$REMAINING" | jq -r '.features[]? | select(.name | startswith("__TEST_")) | .id' 2>/dev/null || true)

CLEANED=0
if [[ -n "$REMAINING_IDS" ]]; then
    while IFS= read -r id; do
        [[ -z "$id" ]] && continue
        cleanup_feature "$id"
        CLEANED=$((CLEANED + 1))
    done <<< "$REMAINING_IDS"
fi

echo "  Cleaned up $CLEANED remaining test feature(s)."

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "========================================"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo -e "  Tests run: ${TOTAL}"
echo -e "  ${GREEN}PASSED: ${PASS_COUNT}${NC}"
echo -e "  ${RED}FAILED: ${FAIL_COUNT}${NC}"
echo "========================================"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
    exit 1
fi

exit 0
