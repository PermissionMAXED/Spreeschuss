package dev.cuprum.cuprum.net;

import java.text.Normalizer;
import java.util.Objects;

/**
 * Minecraft-free bounds / Unicode helpers for the payload contract (plan §3.2): every C2S string
 * is length-bounded at decode (codec cap + canonical-constructor check), NFC-normalized
 * server-side before use, and semantically validated (no control characters) at the guard's
 * VALUE step; range-check distances are bounded to a hard interaction maximum. Unit-tested from
 * {@code src/test} (plan D9).
 */
public final class NetBounds {
    /** Hard upper bound for any C2S range-check distance (blocks, eye to target center). */
    public static final double MAX_RANGE_DISTANCE = 8.0;

    private NetBounds() {
    }

    /** True when {@code value} is already in Unicode NFC form. */
    public static boolean isNfc(String value) {
        Objects.requireNonNull(value, "value");
        return Normalizer.isNormalized(value, Normalizer.Form.NFC);
    }

    /** Returns the NFC normalization of {@code value} (identity for already-normalized input). */
    public static String toNfc(String value) {
        Objects.requireNonNull(value, "value");
        return Normalizer.normalize(value, Normalizer.Form.NFC);
    }

    /** True when {@code value} is at most {@code maxChars} UTF-16 code units long. */
    public static boolean fitsLength(String value, int maxChars) {
        Objects.requireNonNull(value, "value");
        return value.length() <= maxChars;
    }

    /**
     * True when {@code value} still fits {@code maxChars} after NFC normalization. NFC can grow a
     * string, so honest bounds must hold for the normalized form the server will actually use.
     */
    public static boolean fitsLengthNfc(String value, int maxChars) {
        return fitsLength(toNfc(value), maxChars);
    }

    /**
     * True when {@code value} contains no C0/C1 control characters (U+0000–U+001F,
     * U+007F–U+009F — includes NUL, TAB, LF, CR, DEL, NEL) and no Unicode line/paragraph
     * separators (U+2028, U+2029). Honest text payloads never need these; they enable log
     * injection and terminal-escape tricks, so the guard's VALUE step rejects them as
     * violations — never silently strips them.
     */
    public static boolean isLogSafe(String value) {
        Objects.requireNonNull(value, "value");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isISOControl(c) || c == '\u2028' || c == '\u2029') {
                return false;
            }
        }
        return true;
    }

    /**
     * Defensive log sanitizer: replaces every character {@link #isLogSafe} rejects with its
     * {@code \\uXXXX} escape, leaving everything else untouched (identity for clean input).
     * Used wherever remote-controlled text reaches a log line, even after validation.
     */
    public static String escapeForLog(String value) {
        Objects.requireNonNull(value, "value");
        StringBuilder escaped = null;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isISOControl(c) || c == '\u2028' || c == '\u2029') {
                if (escaped == null) {
                    escaped = new StringBuilder(value.length() + 8);
                    escaped.append(value, 0, i);
                }
                escaped.append(String.format("\\u%04X", (int) c));
            } else if (escaped != null) {
                escaped.append(c);
            }
        }
        return escaped == null ? value : escaped.toString();
    }

    /**
     * True when {@code maxDistance} is a valid guard range bound: finite, strictly positive and
     * at most {@link #MAX_RANGE_DISTANCE}. NaN and infinities fail (the negated-comparison shape
     * would otherwise let NaN slip through range math).
     */
    public static boolean isValidRangeDistance(double maxDistance) {
        return Double.isFinite(maxDistance) && maxDistance > 0.0 && maxDistance <= MAX_RANGE_DISTANCE;
    }

    /**
     * Canonical-constructor helper: returns {@code value} unchanged or throws
     * {@link IllegalArgumentException} when it exceeds {@code maxChars} UTF-16 code units.
     * A decode-time throw disconnects the peer — correct for hard protocol violations.
     */
    public static String requireBounded(String value, int maxChars, String fieldName) {
        Objects.requireNonNull(value, fieldName);
        if (value.length() > maxChars) {
            throw new IllegalArgumentException(
                    fieldName + " length " + value.length() + " exceeds bound " + maxChars);
        }
        return value;
    }
}
