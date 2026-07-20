package dev.cuprum.catalogtool;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Proves that every {@code origin=additional} catalog entry agrees 1:1 with the
 * authoritative CP0B/CP0C concept docs ({@code docs/feature-concepts}), and that the
 * docs themselves satisfy the binding CP0B quality contract, so neither the catalog nor
 * the docs can silently drift:
 *
 * <ul>
 *   <li><strong>Digest:</strong> the full-row SHA-256 over all 277 &times; 12 table cells
 *       (documented formula in INDEX.md) recomputes to the single declared 64-hex
 *       literal &mdash; any edit to any cell of any family table is detected;</li>
 *   <li><strong>Structure:</strong> the families table is internally consistent
 *       (core+stretch=count, ranges strictly ascending) and consistent with the
 *       checklist (ids, explicit sequences, waves, family strings); every family file
 *       row matches its checklist row on name/type/tier/prog/wave/deps. Family ranges
 *       and checklist rows consume the <em>explicit</em> sequences they declare; a gap
 *       in sequence coverage is legal <em>only</em> when every missing sequence is
 *       occupied by a catalog {@code origin=user} entry (CP0C: U23 holds 273 between
 *       QOL's 272 and VFX's 274) &mdash; any other hole is an error;</li>
 *   <li><strong>Row quality:</strong> all 12 cells of every family row are nonblank;
 *       test ids are unique and carry a supported prefix ({@code server_gametest:},
 *       {@code client_gametest:}, {@code unit_test:}); every Visual cell carries an
 *       ordered pair of structured {@code T2:} then {@code T3:} clauses whose trimmed
 *       bodies each hold meaningful non-punctuation text ({@code T2: ; T3:} fails);
 *       acceptance criteria contain a concrete assertion &mdash; after stripping
 *       feature-id/T-tier/wave labels, either a number bound to a unit/comparator from
 *       the documented allowlist or an explicit {@code result/state/returns/equals =
 *       VALUE} assertion (free-floating ALL_CAPS words like {@code Looks GOOD.} no
 *       longer count) &mdash; and none of the banned vague tokens; acceptance assertions
 *       respect the lexical scope of their test prefix (server tests never assert
 *       render/visual/screen/display/pixel/HUD/GUI/client/fps/frame/shader/texture/
 *       model/audio vocabulary unless the cell explicitly says it only asserts
 *       dispatch/state, unit tests never assert block/world/level/entity/player/
 *       inventory/claim/permission/render/screen/display/GUI vocabulary; words that are
 *       part of the row's own feature name refer to that named game object and are
 *       exempt); every feature id referenced in an acceptance cell (after normalizing
 *       Unicode dashes/spaces; encoded ids are impossible because all HTML entities are
 *       rejected at parse time) is a declared dependency with an earlier sequence (and
 *       core when the referencing row is core), so optional later integrations can
 *       never leak into base acceptance. The sequence and tier maps behind these
 *       reference checks are built from <em>all</em> catalog entries including user
 *       contracts, so references to U23 (sequence 273) resolve, forward user
 *       references are rejected, and tier checks see user entries;</li>
 *   <li><strong>Catalog:</strong> every additional catalog entry matches its concept row
 *       on id, sequence, name, family string, type, tier, progression tier, wave, deps,
 *       vanilla-overlap disposition and summary (= player behavior) &mdash; with no extra
 *       or missing additional entries.</li>
 * </ul>
 *
 * <p>All doc-format violations surface as error strings here (via
 * {@link CatalogValidationException} from {@link ConceptIndex}), never as raw runtime
 * exceptions, so the {@code verifyConceptParity} Gradle task prints actionable messages.
 */
public final class ConceptParity {
    /** Supported test-id shape: prefix plus a lowercase snake_case target name. */
    private static final Pattern TEST_ID =
            Pattern.compile("^(server_gametest|client_gametest|unit_test):[a-z0-9_]+$");

    /**
     * Banned vague acceptance tokens (evaluator contract): each row must assert concrete
     * observable behavior, not defer to unstated documentation, tolerances or curves.
     * The standalone capital {@code N} ban catches unresolved placeholder quantities.
     */
    private static final List<Map.Entry<Pattern, String>> BANNED_ACCEPTANCE_TOKENS = List.of(
            Map.entry(Pattern.compile("(?i)\\bdocumented\\b"), "documented"),
            Map.entry(Pattern.compile("(?i)\\bper spec\\b"), "per spec"),
            Map.entry(Pattern.compile("(?i)\\bmeasurably\\b"), "measurably"),
            Map.entry(Pattern.compile("(?i)\\btolerance\\b"), "tolerance"),
            Map.entry(Pattern.compile("(?i)\\brated\\b"), "rated"),
            Map.entry(Pattern.compile("(?i)\\bper curve\\b"), "per curve"),
            Map.entry(Pattern.compile("\\bN\\b"), "unresolved standalone N"));

    /**
     * All 17 additional family prefixes, for feature-id reference parsing. {@code VFX}
     * cannot false-match the {@code FX} alternative: the pattern requires a word
     * boundary before the prefix, and inside {@code VFX-01} there is no boundary
     * between {@code V} and {@code F}, so only the {@code VFX} alternative can match.
     */
    private static final String FAMILY_PREFIXES =
            "PWR|OXI|SHD|TES|TUB|RAIL|GOL|WEA|TOOL|EXO|MOB|GEN|FX|ADV|DEC|QOL|VFX";

    /** A feature id reference in an acceptance cell: {@code Uxx} or {@code PREFIX-xx}. */
    private static final Pattern FEATURE_ID_REF =
            Pattern.compile("\\bU\\d{2}\\b|\\b(?:" + FAMILY_PREFIXES + ")-\\d{2}\\b");

    /**
     * Labels stripped before the acceptance-concreteness check: feature ids
     * ({@code Uxx}, {@code PREFIX-xx}), visual tier labels ({@code T1}..{@code T3}) and
     * wave labels ({@code Wn}). What remains must carry a real assertion, so
     * {@code "Works at T3."} and a bare feature-id mention both fail.
     */
    private static final Pattern ACCEPTANCE_LABELS = Pattern.compile(
            "\\bU\\d{2}\\b|\\b(?:" + FAMILY_PREFIXES + ")-\\d{2}\\b|\\bT[1-3]\\b|\\bW\\d{1,2}\\b");

    /** A number: digits with optional thousands separators/decimals and ²/³ exponents. */
    private static final String NUM = "\\d[\\d,.]*(?:\u00b2|\u00b3)?";

    /**
     * Documented unit allowlist for acceptance assertions. Base units required by the
     * CP0B contract ({@code Cg}, {@code ticks}, {@code %}, {@code blocks}, {@code ms},
     * bytes/KiB, entities/items/count, radius, fps) plus the concrete gameplay units the
     * concept tables measure in (HP, damage, degrees, Hz, levels, stages, slots, stacks,
     * ops, nodes, pages, charges, shards, positions, cells, fuses, molds, hues, steps,
     * notes, waypoints, sockets, haunches, characters, carts, seconds).
     */
    private static final String UNITS = "(?:Cg(?:/t)?|ticks?|%|blocks?(?:/s|/tick)?|ms|bytes?|KiB"
            + "|entit(?:y|ies)|items?|count|radius|fps|HP|damage|degrees?|Hz|levels?|stages?|slots?"
            + "|stacks?|ops?|nodes?|pages?|charges?|shards?|positions?|cells?|fuses?|molds?|hues?"
            + "|steps?|notes?|waypoints?|sockets?|haunch(?:es)?|characters?|carts?|s\\b)";

    /** A number bound to an allowlisted unit (at most two intervening words). */
    private static final Pattern NUMBER_WITH_UNIT =
            Pattern.compile(NUM + "(?:[-\\s]\\w+){0,2}?[-\\s]" + UNITS + "|" + NUM + "\\s*%");

    /** An allowlisted quantity keyword bound to a number (e.g. {@code radius 2.5}). */
    private static final Pattern QUANTITY_WITH_NUMBER = Pattern.compile(
            "(?:radius|levels?|stages?|settings?|weights?|thresholds?|caps?|spacing|power|y)"
                    + "[\\s=\u2265\u2264-]+" + NUM);

    /**
     * A number (or the exact count words once/twice) bound to an explicit
     * comparator/bound word or symbol.
     */
    private static final Pattern NUMBER_WITH_COMPARATOR = Pattern.compile(
            "(?:exactly|at least|at most|up to|within|only|all|each of(?: the)?|of)\\s+(?:the\\s+)?"
                    + "(?:" + NUM + "|once\\b|twice\\b)"
                    + "|" + NUM + "\\s*(?:[\u00b1\u00d7\u00f7\u2265\u2264=+]|of\\s+" + NUM
                    + "|\u2013\\s*" + NUM + "|-\\s*\\d)"
                    + "|[\u2265\u2264\u00b1\u00d7=]\\s*" + NUM);

    /**
     * An explicit boolean/result/state assertion in the documented
     * {@code result/state/returns/equals = VALUE} shape: boolean literals; a
     * result/state/blockstate/output/returns keyword bound (optionally via
     * is/=/remains/stays/exactly) to a boolean, ALL_CAPS enum token, digit or quoted
     * value; {@code = VALUE}; or an equality assertion word (equals/identical/
     * byte-identical, e.g. codec equality round-trips). Free-floating ALL_CAPS words
     * carry no assertion and no longer count ({@code Looks GOOD.} fails).
     */
    private static final Pattern BOOLEAN_RESULT_STATE = Pattern.compile(
            "\\btrue\\b|\\bfalse\\b"
                    + "|\\b(?:result|state|blockstate|output|returns?)\\b\\s+"
                    + "(?:is\\s+|=+\\s*|remains\\s+|stays\\s+)?(?:exactly\\s+)?"
                    + "(?:true\\b|false\\b|[A-Z][A-Z_]+\\b|\\d|\"[^\"]*\"|'[^']*')"
                    + "|=\\s*(?:true\\b|false\\b|[A-Z][A-Z_]+\\b)"
                    + "|\\bequal(?:s|ity)?\\b|\\bidentical(?:ly)?\\b|\\bbyte-identical(?:ly)?\\b");

    /**
     * Assertion vocabulary a headless server gametest cannot verify (rendering, visual
     * output, screens/displays, pixels, HUD/GUI, client state, frame rate, shaders,
     * textures, models, audio). Rows asserting these must use {@code client_gametest:}
     * targets, unless the acceptance explicitly says it only asserts dispatch/state
     * ({@link #DISPATCH_STATE_ONLY}) or the word is part of the row's own feature name
     * (a named game object, e.g. the GOL-13 Backpack <em>Frame</em> item).
     */
    private static final Pattern SERVER_TEST_FORBIDDEN = Pattern.compile(
            "(?i)\\brender(?:s|ed|ing)?\\b|\\bvisuals?(?:ly)?\\b|\\bscreens?\\b"
                    + "|\\bdisplays?(?:ed|ing)?\\b|\\bpixels?\\b|\\bHUD\\b|\\bGUIs?\\b"
                    + "|\\bclients?(?:-side)?\\b|\\bfps\\b|\\bframes?(?:[- ]rates?)?\\b"
                    + "|\\bshaders?\\b|\\btextures?\\b|\\bmodels?\\b|\\baudio\\b");

    /**
     * The documented escape hatch for server-test vocabulary: the acceptance cell
     * explicitly declares that it only asserts dispatch/state (never the client-side
     * output itself).
     */
    private static final Pattern DISPATCH_STATE_ONLY = Pattern.compile(
            "(?i)\\bonly asserts?\\b[^.;|]*\\b(?:dispatch(?:es)?|state)\\b"
                    + "|\\basserts?\\s+only\\b[^.;|]*\\b(?:dispatch(?:es)?|state)\\b"
                    + "|\\b(?:dispatch|state)[- ]only\\b");

    /**
     * Assertion vocabulary a plain JUnit test cannot verify (blocks, world/level state,
     * entities, players, inventories, claims/permissions, rendering, screens/displays,
     * GUI). Rows asserting these must use gametest targets; words that are part of the
     * row's own feature name are exempt as named game objects.
     */
    private static final Pattern UNIT_TEST_FORBIDDEN = Pattern.compile(
            "(?i)\\bblocks?\\b|\\bworlds?\\b|\\blevels?\\b|\\bentit(?:y|ies)\\b|\\bplayers?\\b"
                    + "|\\binventor(?:y|ies)\\b|\\bclaims?\\b|\\bpermissions?\\b"
                    + "|\\brender(?:s|ed|ing)?\\b|\\bscreens?\\b|\\bdisplays?(?:ed|ing)?\\b|\\bGUIs?\\b");

    /**
     * Unicode dash/space forms normalized to ASCII before feature-id extraction so a
     * lookalike hyphen (en dash, non-breaking hyphen, minus sign, figure dash) or a
     * non-breaking space cannot smuggle an id past {@link #FEATURE_ID_REF}. Entity-coded
     * ids (e.g. {@code PWR&#45;22}) cannot reach this point at all: every HTML entity is
     * rejected while reading the file.
     */
    private static String normalizeForIdExtraction(String text) {
        return text
                .replace('\u2010', '-').replace('\u2011', '-').replace('\u2012', '-')
                .replace('\u2013', '-').replace('\u2014', '-').replace('\u2212', '-')
                .replace('\u00a0', ' ').replace('\u2007', ' ').replace('\u202f', ' ');
    }

    /** A word of the row's own feature name (>= 3 letters), for scope-word exemption. */
    private static final Pattern NAME_WORD = Pattern.compile("[A-Za-z]{3,}");

    private ConceptParity() {
    }

    public static List<String> validate(Path catalogFile, Path docsDir) throws IOException {
        return validate(CatalogValidator.parseObject(catalogFile), docsDir);
    }

    public static List<String> validate(JsonObject catalog, Path docsDir) throws IOException {
        List<String> errors = new ArrayList<>();

        ConceptIndex index;
        try {
            index = ConceptIndex.parse(docsDir);
        } catch (CatalogValidationException e) {
            errors.add("concept parity: INDEX.md: " + e.getMessage());
            return errors;
        }

        // Sequence and tier maps over ALL catalog entries (user contracts included),
        // plus the set of global sequences occupied by user entries — the only
        // sequences an additional-checklist hole may legally skip (CP0C: U23 at 273).
        Map<String, Integer> catalogSequenceById = new HashMap<>();
        Map<String, String> catalogTierById = new HashMap<>();
        Set<Integer> userOccupiedSequences = new HashSet<>();
        for (JsonElement element : catalog.getAsJsonArray("entries")) {
            JsonObject entry = element.getAsJsonObject();
            String entryId = entry.get("id").getAsString();
            int entrySequence = entry.get("sequence").getAsInt();
            catalogSequenceById.put(entryId, entrySequence);
            catalogTierById.put(entryId, entry.get("tier").getAsString());
            if ("user".equals(entry.get("origin").getAsString())) {
                userOccupiedSequences.add(entrySequence);
            }
        }

        // 1. Families table internal consistency, and consistency with the checklist.
        // Ranges consume their explicit declared sequences: they must ascend strictly,
        // and any skipped sequence must be occupied by a catalog user entry.
        List<ConceptIndex.ChecklistRow> checklist = index.checklist();
        int expectedSeq = -1;
        int totalFromRanges = 0;
        for (ConceptIndex.FamilyRange range : index.familyRanges().values()) {
            if (expectedSeq != -1 && range.seqLo() != expectedSeq) {
                if (range.seqLo() < expectedSeq) {
                    errors.add("concept parity: family " + range.prefix() + " range starts at " + range.seqLo()
                            + " but previous family ends at " + (expectedSeq - 1)
                            + " (family ranges must ascend without overlap)");
                } else {
                    reportUnoccupiedHole(errors, "family " + range.prefix() + " range",
                            expectedSeq, range.seqLo() - 1, userOccupiedSequences);
                }
            }
            expectedSeq = range.seqHi() + 1;
            if (range.seqHi() - range.seqLo() + 1 != range.count()) {
                errors.add("concept parity: family " + range.prefix() + " declares count " + range.count()
                        + " but range " + range.seqLo() + "-" + range.seqHi() + " spans "
                        + (range.seqHi() - range.seqLo() + 1));
            }
            if (range.core() + range.stretch() != range.count()) {
                errors.add("concept parity: family " + range.prefix() + " core (" + range.core()
                        + ") + stretch (" + range.stretch() + ") != count (" + range.count() + ")");
            }
            totalFromRanges += range.count();
        }
        if (totalFromRanges != checklist.size()) {
            errors.add("concept parity: families-table total " + totalFromRanges
                    + " != checklist row count " + checklist.size());
        }

        // Checklist rows consume their explicit declared sequences: strictly increasing
        // from the first family's low bound, with any skipped sequence occupied by a
        // catalog user entry (an unoccupied or additional-occupied hole is an error).
        int expectedRowSeq = index.familyRanges().values().iterator().next().seqLo();
        for (int i = 0; i < checklist.size(); i++) {
            ConceptIndex.ChecklistRow row = checklist.get(i);
            if (row.seq() != expectedRowSeq) {
                if (row.seq() < expectedRowSeq) {
                    errors.add("concept parity: checklist row " + row.id() + " has seq " + row.seq()
                            + " but position requires at least " + expectedRowSeq
                            + " (checklist sequences must be strictly increasing)");
                } else {
                    reportUnoccupiedHole(errors, "checklist row " + row.id(),
                            expectedRowSeq, row.seq() - 1, userOccupiedSequences);
                }
            }
            expectedRowSeq = Math.max(expectedRowSeq, row.seq() + 1);
            ConceptIndex.FamilyRange range = index.familyRanges().get(row.prefix());
            if (range == null) {
                errors.add("concept parity: checklist row " + row.id() + " uses unknown family prefix '"
                        + row.prefix() + "'");
                continue;
            }
            if (row.seq() < range.seqLo() || row.seq() > range.seqHi()) {
                errors.add("concept parity: checklist row " + row.id() + " (seq " + row.seq()
                        + ") is outside family range " + range.seqLo() + "-" + range.seqHi());
            }
            String expectedId = String.format("%s-%02d", row.prefix(), row.seq() - range.seqLo() + 1);
            if (!expectedId.equals(row.id())) {
                errors.add("concept parity: checklist row at seq " + row.seq() + " must have id '"
                        + expectedId + "' but has '" + row.id() + "'");
            }
            if (!range.family().equals(row.family())) {
                errors.add("concept parity: checklist row " + row.id() + " family string '" + row.family()
                        + "' != families-table string '" + range.family() + "'");
            }
            String expectedWave = "core".equals(row.tier()) ? range.coreWave() : "W15";
            if (!expectedWave.equals(row.wave())) {
                errors.add("concept parity: checklist row " + row.id() + " (" + row.tier() + ") must have wave "
                        + expectedWave + " but has " + row.wave());
            }
        }

        // 2. Family files: parse, cross-check against the checklist, enforce row quality.
        int checklistCursor = 0;
        List<ConceptIndex.FamilyRow> familyRowsInOrder = new ArrayList<>();
        List<Integer> rowSequences = new ArrayList<>(); // explicit checklist sequences
        for (ConceptIndex.FamilyRange range : index.familyRanges().values()) {
            List<ConceptIndex.FamilyRow> familyRows;
            try {
                familyRows = ConceptIndex.parseFamilyFile(docsDir, range);
            } catch (CatalogValidationException e) {
                errors.add("concept parity: " + e.getMessage());
                return errors; // later cursor arithmetic would misalign every family
            }
            for (ConceptIndex.FamilyRow familyRow : familyRows) {
                if (checklistCursor >= checklist.size()) {
                    errors.add("concept parity: " + range.file() + " row " + familyRow.id()
                            + " has no matching checklist row");
                    continue;
                }
                ConceptIndex.ChecklistRow row = checklist.get(checklistCursor++);
                if (!row.id().equals(familyRow.id())) {
                    errors.add("concept parity: checklist seq " + row.seq() + " is " + row.id()
                            + " but " + range.file() + " lists " + familyRow.id() + " at that position");
                    continue;
                }
                compare(errors, range.file(), row.id(), "name", row.name(), familyRow.name());
                compare(errors, range.file(), row.id(), "type", row.type(), familyRow.type());
                compare(errors, range.file(), row.id(), "tier", row.tier(), familyRow.tier());
                compare(errors, range.file(), row.id(), "prog", String.valueOf(row.progressionTier()),
                        familyRow.prog());
                compare(errors, range.file(), row.id(), "wave", row.wave(), familyRow.wave());
                compare(errors, range.file(), row.id(), "deps", row.depsCell(), familyRow.depsCell());
                familyRowsInOrder.add(familyRow);
                rowSequences.add(row.seq());
            }
        }

        checkRowQuality(errors, familyRowsInOrder, rowSequences, catalogSequenceById, catalogTierById);

        // 3. Digest: the 277 x 12 cells must hash to the single declared literal.
        if (familyRowsInOrder.size() == checklist.size()) {
            String computed = ConceptIndex.computeFullRowDigest(familyRowsInOrder);
            if (!computed.equals(index.declaredDigest())) {
                errors.add("concept parity: INDEX.md full-row digest mismatch: declared '"
                        + index.declaredDigest() + "' but the family-table rows hash to '" + computed
                        + "' (a table cell changed without updating the authoritative digest)");
            }
        }

        // 4. Catalog vs concept rows.
        JsonArray entries = catalog.getAsJsonArray("entries");
        List<JsonObject> additional = new ArrayList<>();
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            if ("additional".equals(entry.get("origin").getAsString())) {
                additional.add(entry);
            }
        }
        if (additional.size() != checklist.size()) {
            errors.add("concept parity: catalog has " + additional.size()
                    + " additional entries but the concept checklist has " + checklist.size());
        }
        int n = Math.min(additional.size(), Math.min(checklist.size(), familyRowsInOrder.size()));
        for (int i = 0; i < n; i++) {
            JsonObject entry = additional.get(i);
            ConceptIndex.ChecklistRow row = checklist.get(i);
            ConceptIndex.FamilyRow familyRow = familyRowsInOrder.get(i);
            String id = entry.get("id").getAsString();
            if (!row.id().equals(id)) {
                errors.add("concept parity: additional entry at position " + i + " is '" + id
                        + "' but the concept checklist requires '" + row.id() + "'");
                continue;
            }
            compareCatalog(errors, id, "sequence", String.valueOf(row.seq()),
                    String.valueOf(entry.get("sequence").getAsInt()));
            compareCatalog(errors, id, "name", row.name(), entry.get("name").getAsString());
            compareCatalog(errors, id, "type", row.type(), entry.get("type").getAsString());
            compareCatalog(errors, id, "tier", row.tier(), entry.get("tier").getAsString());
            compareCatalog(errors, id, "progression_tier", String.valueOf(row.progressionTier()),
                    String.valueOf(entry.get("progression_tier").getAsInt()));
            compareCatalog(errors, id, "planned_wave", row.wave(), entry.get("planned_wave").getAsString());
            compareCatalog(errors, id, "family", row.family(), entry.get("family").getAsString());
            compareCatalog(errors, id, "vanilla_overlap", familyRow.vanillaOverlap(),
                    entry.get("vanilla_overlap").getAsString());
            compareCatalog(errors, id, "summary", familyRow.playerBehavior(), entry.get("summary").getAsString());
            List<String> entryDeps = new ArrayList<>();
            for (JsonElement dep : entry.getAsJsonArray("deps")) {
                entryDeps.add(dep.getAsString());
            }
            if (!familyRow.deps().equals(entryDeps)) {
                errors.add("concept parity: " + id + " catalog deps " + entryDeps
                        + " != concept deps " + familyRow.deps());
            }
        }

        return errors;
    }

    /**
     * A gap in additional sequence coverage (family ranges or checklist rows) is legal
     * only when every skipped sequence is occupied by a catalog {@code origin=user}
     * entry (CP0C: U23 at 273). A sequence occupied by nothing — or by an additional
     * entry — reports an error per missing sequence.
     */
    private static void reportUnoccupiedHole(List<String> errors, String context, int lo, int hi,
                                             Set<Integer> userOccupiedSequences) {
        for (int seq = lo; seq <= hi; seq++) {
            if (!userOccupiedSequences.contains(seq)) {
                errors.add("concept parity: " + context + " skips sequence " + seq
                        + " which is not occupied by a catalog user entry (a checklist hole is"
                        + " legal only when every missing sequence is a user contract's global"
                        + " sequence)");
            }
        }
    }

    /**
     * Per-row quality contract on the 12-cell family rows (rows arrive in global
     * sequence order with their explicit checklist sequences, 23..272 then 274..300):
     * nonblank cells; unique valid test ids; ordered {@code T2:} then {@code T3:}
     * clauses with meaningful bodies in every Visual cell; concrete acceptance per the
     * documented allowlist without banned vague tokens; lexical test-scope suitability
     * with the dispatch/state-only escape hatch and own-name exemption; and acceptance
     * id references (after Unicode normalization) restricted to declared, earlier
     * (core-for-core) dependencies. Sequence/tier lookups use the maps built from all
     * catalog entries, so user-contract references (e.g. U23) resolve and forward user
     * references fail.
     */
    private static void checkRowQuality(List<String> errors, List<ConceptIndex.FamilyRow> rows,
                                        List<Integer> rowSequences,
                                        Map<String, Integer> sequenceById,
                                        Map<String, String> tierById) {
        List<String> columnNames = List.of("ID", "Name", "Type", "Tier", "Prog", "Wave", "Deps",
                "Vanilla overlap", "Player behavior", "Visual signature", "Acceptance", "Test");
        Map<String, String> testIdOwners = new HashMap<>();

        for (int i = 0; i < rows.size(); i++) {
            ConceptIndex.FamilyRow row = rows.get(i);
            int sequence = rowSequences.get(i);
            List<String> cells = row.cells();
            for (int c = 0; c < cells.size(); c++) {
                if (cells.get(c).isBlank()) {
                    errors.add("concept parity: " + row.id() + " has a blank '" + columnNames.get(c)
                            + "' cell; all 12 family-table cells must be nonblank");
                }
            }

            String test = row.test();
            if (!test.isBlank()) {
                if (!TEST_ID.matcher(test).matches()) {
                    errors.add("concept parity: " + row.id() + " test id '" + test
                            + "' must match server_gametest:|client_gametest:|unit_test: plus a"
                            + " lowercase snake_case target");
                } else {
                    String owner = testIdOwners.putIfAbsent(test, row.id());
                    if (owner != null) {
                        errors.add("concept parity: test id '" + test + "' is used by both "
                                + owner + " and " + row.id() + "; test targets must be unique");
                    }
                }
            }

            String acceptance = row.acceptance();
            for (Map.Entry<Pattern, String> banned : BANNED_ACCEPTANCE_TOKENS) {
                if (banned.getKey().matcher(acceptance).find()) {
                    errors.add("concept parity: " + row.id() + " acceptance contains banned vague token '"
                            + banned.getValue() + "': " + acceptance);
                }
            }

            // Concreteness: after stripping feature-id/T-tier/wave labels, the cell must
            // contain a number bound to an allowlisted unit/comparator, or an explicit
            // result/state/returns/equals = VALUE assertion. "Works at T3.", "Looks
            // GOOD." and bare digits without units/comparison all fail.
            if (!acceptance.isBlank()) {
                String stripped = ACCEPTANCE_LABELS.matcher(acceptance).replaceAll(" ");
                boolean concrete = NUMBER_WITH_UNIT.matcher(stripped).find()
                        || QUANTITY_WITH_NUMBER.matcher(stripped).find()
                        || NUMBER_WITH_COMPARATOR.matcher(stripped).find()
                        || BOOLEAN_RESULT_STATE.matcher(stripped).find();
                if (!concrete) {
                    errors.add("concept parity: " + row.id() + " acceptance has no concrete assertion"
                            + " (no number bound to an allowlisted unit/comparator and no explicit"
                            + " result/state/returns/equals = VALUE assertion after label stripping;"
                            + " free-floating ALL_CAPS words do not count): " + acceptance);
                }
            }

            // Lexical test-scope suitability. Words that are part of the row's own
            // feature name refer to that named game object (e.g. the GOL-13 Backpack
            // Frame item) and are exempt; everything else in the banned vocabulary
            // fails unless the documented dispatch/state-only escape hatch is present.
            String scopeText = withoutOwnNameWords(acceptance, row.name());
            if (test.startsWith("server_gametest:")) {
                Matcher forbidden = SERVER_TEST_FORBIDDEN.matcher(scopeText);
                if (forbidden.find() && !DISPATCH_STATE_ONLY.matcher(acceptance).find()) {
                    errors.add("concept parity: " + row.id() + " has a server_gametest but its acceptance"
                            + " asserts client-side vocabulary ('" + forbidden.group()
                            + "'); render/visual/screen/display/pixel/HUD/GUI/client/fps/frame/shader/"
                            + "texture/model/audio assertions require client_gametest: unless the cell"
                            + " explicitly says it only asserts dispatch/state");
                }
            } else if (test.startsWith("unit_test:")) {
                Matcher forbidden = UNIT_TEST_FORBIDDEN.matcher(scopeText);
                if (forbidden.find()) {
                    errors.add("concept parity: " + row.id() + " has a unit_test but its acceptance"
                            + " asserts runtime vocabulary ('" + forbidden.group()
                            + "'); block/world/level/entity/player/inventory/claim/permission/render/"
                            + "screen/display/GUI assertions require a gametest");
                }
            }

            // Acceptance id references: every referenced feature other than self must be
            // a declared dependency, earlier in sequence, and core when this row is core.
            // Unicode dashes/spaces are normalized first so lookalike ids cannot hide;
            // entity-coded ids never reach here (all HTML entities are parse errors).
            Matcher ref = FEATURE_ID_REF.matcher(normalizeForIdExtraction(acceptance));
            List<String> deps = row.deps();
            List<String> reported = new ArrayList<>();
            while (ref.find()) {
                String referenced = ref.group();
                if (referenced.equals(row.id()) || reported.contains(referenced)) {
                    continue;
                }
                reported.add(referenced);
                if (!deps.contains(referenced)) {
                    errors.add("concept parity: " + row.id() + " acceptance references " + referenced
                            + " which is not a declared dependency (optional later integrations must"
                            + " not appear in base acceptance)");
                    continue;
                }
                Integer referencedSeq = sequenceById.get(referenced);
                if (referencedSeq != null && referencedSeq >= sequence) {
                    errors.add("concept parity: " + row.id() + " (seq " + sequence
                            + ") acceptance references " + referenced + " (seq " + referencedSeq
                            + ") which is not earlier in the global sequence");
                }
                String referencedTier = tierById.get(referenced);
                if ("core".equals(row.tier()) && referencedTier != null && !"core".equals(referencedTier)) {
                    errors.add("concept parity: " + row.id() + " (core) acceptance references "
                            + referenced + " (" + referencedTier + "); core acceptance may only"
                            + " reference core or user features");
                }
            }

            // Every Visual cell must carry an ordered pair of structured T2: then T3:
            // clauses whose trimmed bodies hold meaningful non-punctuation text.
            String visual = row.visualSignature();
            if (!visual.isBlank()) {
                checkVisualClauses(errors, row.id(), visual);
            }
        }
    }

    /** Minimum alphanumeric characters a T2:/T3: clause body must carry to be meaningful. */
    private static final int MIN_VISUAL_CLAUSE_ALNUM = 4;

    /**
     * Extracts the ordered {@code T2:} then {@code T3:} clauses from a Visual cell and
     * requires each trimmed clause body to contain meaningful non-punctuation text
     * (at least {@value #MIN_VISUAL_CLAUSE_ALNUM} alphanumeric characters). Missing
     * markers, {@code T3:} before {@code T2:}, and empty/punctuation-only bodies
     * ({@code T2: ; T3:}) all fail.
     */
    private static void checkVisualClauses(List<String> errors, String id, String visual) {
        int t2 = visual.indexOf("T2:");
        int t3 = visual.indexOf("T3:");
        if (t2 < 0 || t3 < 0) {
            errors.add("concept parity: " + id + " visual signature lacks explicit structured"
                    + " 'T2:' and 'T3:' fallback clauses: " + visual);
            return;
        }
        if (t3 < t2) {
            errors.add("concept parity: " + id + " visual signature has 'T3:' before 'T2:';"
                    + " the fallback clauses must appear in T2-then-T3 order: " + visual);
            return;
        }
        String clause2 = visual.substring(t2 + 3, t3).strip();
        String clause3 = visual.substring(t3 + 3).strip();
        // Trim trailing clause punctuation (separator ';', closing ')', trailing '.').
        clause2 = clause2.replaceAll("[;).\\s]+$", "");
        clause3 = clause3.replaceAll("[;).\\s]+$", "");
        for (Map.Entry<String, String> clause : List.of(
                Map.entry("T2:", clause2), Map.entry("T3:", clause3))) {
            String alnum = clause.getValue().replaceAll("[^A-Za-z0-9]", "");
            if (alnum.length() < MIN_VISUAL_CLAUSE_ALNUM) {
                errors.add("concept parity: " + id + " visual signature '" + clause.getKey()
                        + "' clause is empty or punctuation-only ('" + clause.getValue()
                        + "'); each fallback clause must carry meaningful text (at least "
                        + MIN_VISUAL_CLAUSE_ALNUM + " alphanumeric characters): " + visual);
            }
        }
    }

    /**
     * Removes occurrences of the row's own feature-name words (>= 3 letters, optional
     * plural {@code s}, case-insensitive) from the acceptance text before test-scope
     * vocabulary scanning: those words name the feature's own game object, not
     * client-side output (e.g. "the frame" in the GOL-13 Backpack Frame acceptance).
     */
    private static String withoutOwnNameWords(String acceptance, String name) {
        String result = acceptance;
        Matcher word = NAME_WORD.matcher(name);
        while (word.find()) {
            result = result.replaceAll("(?i)\\b" + Pattern.quote(word.group()) + "s?\\b", " ");
        }
        return result;
    }

    private static void compare(List<String> errors, String file, String id, String field,
                                String checklistValue, String familyValue) {
        if (!checklistValue.equals(familyValue)) {
            errors.add("concept parity: " + id + " " + field + " disagrees between INDEX.md ('"
                    + checklistValue + "') and " + file + " ('" + familyValue + "')");
        }
    }

    private static void compareCatalog(List<String> errors, String id, String field,
                                       String conceptValue, String catalogValue) {
        if (!conceptValue.equals(catalogValue)) {
            errors.add("concept parity: " + id + " catalog " + field + " '" + catalogValue
                    + "' != concept '" + conceptValue + "'");
        }
    }

    /** Compact one-line summary for the CLI success message. */
    public static String describe(Path docsDir) throws IOException {
        ConceptIndex index = ConceptIndex.parse(docsDir);
        return index.checklist().size() + " concept rows across " + index.familyRanges().size()
                + " families, full-row digest " + index.declaredDigest();
    }
}
