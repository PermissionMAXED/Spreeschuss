package dev.cuprum.cuprum.handbook;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * MC-free search core (plan D9: tested in {@code src/test} without Minecraft classes). The
 * client builds {@link Doc}s from the synced pages + <i>localized</i> strings after every
 * sync payload and post-{@code languages} client reload; this class owns the deterministic
 * tokenizer, folding and ranking so the JUnit suite pins the behavior exactly.
 *
 * <p>Contract (handbook-config.md §5): lowercase + diacritic folding; prefix/substring
 * matching; ranked title &gt; subject &gt; body/extra; ties broken by document id ascending.
 * Deterministic: no hash-order iteration, no locale-dependent casing surprises
 * ({@link Locale#ROOT}).
 */
public final class HandbookSearchCore {
    /** Score weights: title > subject > body/extra; prefix beats substring within a field. */
    static final int TITLE_PREFIX = 1000;
    static final int TITLE_SUBSTRING = 500;
    static final int SUBJECT_PREFIX = 100;
    static final int SUBJECT_SUBSTRING = 50;
    static final int BODY_SUBSTRING = 10;

    /** One searchable document: id + localized strings (all folding happens in here). */
    public record Doc(String id, String title, List<String> subjects, List<String> body) {
        public Doc {
            if (id == null || id.isBlank()) {
                throw new IllegalArgumentException("doc id must be non-blank");
            }
            title = title == null ? "" : title;
            subjects = subjects == null ? List.of() : List.copyOf(subjects);
            body = body == null ? List.of() : List.copyOf(body);
        }
    }

    /** A ranked hit; score is stable for identical inputs. */
    public record Hit(String id, int score) {
    }

    private HandbookSearchCore() {
    }

    /** Lowercases ({@link Locale#ROOT}) and strips combining diacritics (NFD fold). */
    public static String fold(String input) {
        if (input == null || input.isEmpty()) {
            return "";
        }
        String decomposed = Normalizer.normalize(input.toLowerCase(Locale.ROOT), Normalizer.Form.NFD);
        StringBuilder out = new StringBuilder(decomposed.length());
        for (int i = 0; i < decomposed.length(); i++) {
            char c = decomposed.charAt(i);
            if (Character.getType(c) != Character.NON_SPACING_MARK) {
                out.append(c);
            }
        }
        return out.toString();
    }

    /** Splits folded text into non-empty letter/digit runs (deterministic token order). */
    public static List<String> tokenize(String input) {
        String folded = fold(input);
        List<String> tokens = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (int i = 0; i < folded.length(); i++) {
            char c = folded.charAt(i);
            if (Character.isLetterOrDigit(c)) {
                current.append(c);
            } else if (current.length() > 0) {
                tokens.add(current.toString());
                current.setLength(0);
            }
        }
        if (current.length() > 0) {
            tokens.add(current.toString());
        }
        return List.copyOf(tokens);
    }

    /**
     * Ranked search: every query token must match somewhere in a document (AND semantics);
     * the document score is the sum of its best per-token field scores. Blank queries return
     * no hits (the UI shows the full listing instead).
     */
    public static List<Hit> search(List<Doc> docs, String query) {
        List<String> queryTokens = tokenize(query);
        if (queryTokens.isEmpty()) {
            return List.of();
        }
        List<Hit> hits = new ArrayList<>();
        for (Doc doc : docs) {
            int total = 0;
            boolean allMatched = true;
            for (String token : queryTokens) {
                int best = bestFieldScore(doc, token);
                if (best == 0) {
                    allMatched = false;
                    break;
                }
                total += best;
            }
            if (allMatched) {
                hits.add(new Hit(doc.id(), total));
            }
        }
        hits.sort(Comparator.comparingInt(Hit::score).reversed().thenComparing(Hit::id));
        return List.copyOf(hits);
    }

    private static int bestFieldScore(Doc doc, String token) {
        int best = fieldScore(doc.title(), token, TITLE_PREFIX, TITLE_SUBSTRING);
        for (String subject : doc.subjects()) {
            best = Math.max(best, fieldScore(subject, token, SUBJECT_PREFIX, SUBJECT_SUBSTRING));
        }
        for (String body : doc.body()) {
            best = Math.max(best, fieldScore(body, token, BODY_SUBSTRING, BODY_SUBSTRING));
        }
        return best;
    }

    private static int fieldScore(String field, String token, int prefixScore, int substringScore) {
        for (String fieldToken : tokenize(field)) {
            if (fieldToken.startsWith(token)) {
                return prefixScore;
            }
        }
        return fold(field).contains(token) ? substringScore : 0;
    }
}
