"""Pure checkout feature encoding; no training, I/O, dependencies or coercion."""
import math

FEATURE_CONTRACT_VERSION = "eta-checkout-features-v1"
ORDERED_FEATURES = (
    "distanceKm", "itemCount", "hourSin", "hourCos", "isMonday", "isTuesday",
    "isWednesday", "isThursday", "isFriday", "isSaturday",
)


def finite_number(value):
    # bool is an int subclass in Python but is not a valid JS number.
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def encode_checkout_features(row):
    """Return ten features; expected validation failures raise allowlisted ValueError."""
    if not isinstance(row, dict) or set(row) != {"distanceKm", "itemCount", "hourOfDay", "dayOfWeek"}:
        raise ValueError("invalid_shape")
    distance, count, hour, day = (row[name] for name in ("distanceKm", "itemCount", "hourOfDay", "dayOfWeek"))
    if not finite_number(distance) or distance < 0:
        raise ValueError("invalid_distance")
    if not finite_number(count) or count % 1 != 0 or count <= 0:
        raise ValueError("invalid_item_count")
    if not finite_number(hour) or hour % 1 != 0 or not 0 <= hour <= 23:
        raise ValueError("invalid_hour")
    if not finite_number(day) or day % 1 != 0 or not 0 <= day <= 6:
        raise ValueError("invalid_weekday")
    angle = 2 * math.pi * hour / 24
    return [distance, count, math.sin(angle), math.cos(angle)] + [int(day == i) for i in range(1, 7)]
