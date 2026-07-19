package dev.cuprum.catalogtool;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deterministic, attack-hardened parser for the CP0B concept deliverable in
 * {@code docs/feature-concepts}: the family-ranges and machine-auditable checklist
 * tables of {@code INDEX.md} plus the 12-column feature tables of the 16 family files
 * ({@code PWR.md} .. {@code QOL.md}).
 *
 * <p>The concept docs are the authoritative source for all {@code origin=additional}
 * catalog entries. This parser makes them machine-comparable so {@link ConceptParity}
 * can prove catalog/concept agreement and detect silent drift in either direction.
 *
 * <p><strong>Digest.</strong> INDEX.md publishes one authoritative full-row content
 * digest: the SHA-256 (full 64 hex chars) over the UTF-8 bytes of the compact JSON
 * array (Python {@code json.dumps(..., separators=(",", ":"), ensure_ascii=True)}) of
 * 250 arrays, one per feature in global sequence order 23&rarr;272, each holding the 12
 * normalized (whitespace-trimmed raw Markdown) table cells in column order
 * {@code [id, name, type, tier, prog, wave, deps, vanilla_overlap, player_behavior,
 * visual_signature, acceptance, test]}. {@link #computeFullRowDigest(List)} reproduces
 * that formula exactly.
 *
 * <p><strong>Parsing hardening</strong> (each rule exists because a plausible attack
 * would otherwise silently corrupt parity):
 * <ul>
 *   <li>raw-HTML/entity hiding is eliminated wholesale instead of alias-chased:
 *       the concept docs need no HTML, so {@link #readVisibleLines} rejects (anywhere in
 *       the raw file, including inside fences) any raw HTML tag or comment construct
 *       ({@code <} followed by a letter, {@code /}, {@code !} or {@code ?} &mdash; catching
 *       {@code <script>}, {@code <details>}, {@code </div>}, {@code <!-- -->},
 *       {@code <!DOCTYPE}, {@code <?xml}), any HTML entity (named or numeric, decimal or
 *       hex, case-insensitive &mdash; {@code &VerticalLine;}, {@code &verbar;},
 *       {@code &vert;}, {@code &#124;}, {@code &#x7C;}, {@code &#45;} and every other
 *       entity all fail identically), and any blockquote line ({@code >} after 0&ndash;3
 *       spaces of indent), each with a file/line/construct error;</li>
 *   <li>fenced/indented content is never authoritative: {@link #readVisibleLines} is
 *       CommonMark-aware enough to drop fenced code blocks (backtick <em>and</em> tilde
 *       fences, opener marker+length remembered, closed only by a run of the same marker
 *       at least as long, fences indented 0&ndash;3 spaces) and four-space/tab indented
 *       code lines &mdash; a digest line or table row smuggled into these simply does not
 *       exist; nested other-marker or shorter same-marker runs inside a fence remain
 *       content;</li>
 *   <li>exactly one authoritative digest line must exist among the visible lines &mdash;
 *       zero, duplicates (first/last ambiguity) and malformed digest lines all fail;</li>
 *   <li>table headers and divider rows must match the supported layout exactly; any
 *       substitution (renamed/reordered columns) fails with a
 *       {@link CatalogValidationException} naming the file and expected header;</li>
 *   <li>INDEX family links must be self-consistent: link text equals the link target
 *       and both equal {@code <PREFIX>.md}, so link retargeting fails;</li>
 *   <li>blank lines inside a table region and missing/extra feature rows are reported
 *       precisely instead of being skipped;</li>
 *   <li>escaped pipes ({@code \|}) are rejected with a precise error; encoded pipes are
 *       already impossible because every HTML entity is rejected at the raw-line level
 *       (no cell in the supported concept format may smuggle a literal pipe);</li>
 *   <li>numeric cells are parsed via {@link #parseIntCell}, producing a clean
 *       {@link CatalogValidationException} instead of a raw {@link NumberFormatException}.</li>
 * </ul>
 */
public final class ConceptIndex {
    /** One row of the INDEX.md machine-auditable checklist (250 rows, seq 23..272). */
    public record ChecklistRow(int seq, String id, String name, String family, String type,
                               String tier, int progressionTier, String wave, String depsCell) {
        public String prefix() {
            int dash = id.indexOf('-');
            return dash < 0 ? id : id.substring(0, dash);
        }
    }

    /** One row of the INDEX.md families table (16 rows, PWR..QOL). */
    public record FamilyRange(String prefix, String file, String family, int seqLo, int seqHi,
                              int count, int core, int stretch, String coreWave) {
    }

    /**
     * One row of a family file's 12-column feature table. All cells are retained as the
     * raw (whitespace-trimmed) Markdown cell content, in documented digest column order,
     * so the full-row digest can be recomputed byte-exactly.
     */
    public record FamilyRow(String id, String name, String type, String tier, String prog,
                            String wave, String depsCell, String vanillaOverlap, String playerBehavior,
                            String visualSignature, String acceptance, String test) {
        /** The 12 cells in the documented digest column order. */
        public List<String> cells() {
            return List.of(id, name, type, tier, prog, wave, depsCell, vanillaOverlap,
                    playerBehavior, visualSignature, acceptance, test);
        }

        /** The deps cell split into ids ({@code "-"} means no deps). */
        public List<String> deps() {
            return splitDepsCell(depsCell);
        }

        public int progressionTier() {
            return parseIntCell("family row '" + id + "'", "Prog", prog);
        }
    }

    static final String FAMILIES_HEADER =
            "| Prefix | File | Catalog family | Sequence | Count | Core | Stretch | Core wave |";
    static final String FAMILIES_DIVIDER = "|---|---|---|---|---|---|---|---|";
    static final String CHECKLIST_HEADER =
            "| Seq | ID | Name | Family | Type | Tier | Prog | Wave | Deps |";
    static final String CHECKLIST_DIVIDER = "|---|---|---|---|---|---|---|---|---|";
    static final String FAMILY_TABLE_HEADER =
            "| ID | Name | Type | Tier | Prog | Wave | Deps | Vanilla overlap | Player behavior"
                    + " | Visual signature | Acceptance | Test |";
    static final String FAMILY_TABLE_DIVIDER = "|---|---|---|---|---|---|---|---|---|---|---|---|";

    private static final Pattern DIGEST_LINE =
            Pattern.compile("^Content digest \\(full-row, authoritative\\): `([0-9a-f]{64})`$");
    private static final String DIGEST_MARKER = "Content digest (full-row, authoritative):";
    private static final Pattern FILE_LINK = Pattern.compile("^\\[([^\\]]+)\\]\\(([^)]+)\\)$");

    private final List<ChecklistRow> checklist;
    private final Map<String, FamilyRange> familyRanges; // insertion order = family order
    private final String declaredDigest;

    private ConceptIndex(List<ChecklistRow> checklist, Map<String, FamilyRange> familyRanges, String declaredDigest) {
        this.checklist = List.copyOf(checklist);
        this.familyRanges = familyRanges;
        this.declaredDigest = declaredDigest;
    }

    public List<ChecklistRow> checklist() {
        return checklist;
    }

    /** Family prefix &rarr; families-table row, in INDEX.md declaration order. */
    public Map<String, FamilyRange> familyRanges() {
        return familyRanges;
    }

    /** The full-row digest literal declared in INDEX.md (64 hex chars). */
    public String declaredDigest() {
        return declaredDigest;
    }

    /**
     * Recomputes the documented full-row SHA-256 digest from the 250 family rows in
     * global sequence order (see class javadoc for the exact formula).
     */
    public static String computeFullRowDigest(List<FamilyRow> rowsInSequenceOrder) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < rowsInSequenceOrder.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append('[');
            List<String> cells = rowsInSequenceOrder.get(i).cells();
            for (int c = 0; c < cells.size(); c++) {
                if (c > 0) {
                    sb.append(',');
                }
                appendJsonAsciiString(sb, cells.get(c));
            }
            sb.append(']');
        }
        sb.append(']');
        return sha256Hex(sb.toString());
    }

    /** Parses {@code INDEX.md} inside the given concept docs directory. */
    public static ConceptIndex parse(Path docsDir) throws IOException {
        List<String> lines = readVisibleLines(docsDir.resolve("INDEX.md"), "INDEX.md");

        String declaredDigest = parseSingleDigestLine(lines);
        Map<String, FamilyRange> familyRanges = parseFamiliesTable(lines);
        List<ChecklistRow> checklist = parseChecklistTable(lines);

        if (checklist.isEmpty() || familyRanges.isEmpty()) {
            throw new CatalogValidationException(
                    "INDEX.md parsed to an empty checklist or families table");
        }
        return new ConceptIndex(checklist, familyRanges, declaredDigest);
    }

    /** Fence opener/closer: 0-3 spaces of indent, then a run of {@code `} or {@code ~}. */
    private static final Pattern FENCE_LINE = Pattern.compile("^( {0,3})(`{3,}|~{3,})(.*)$");

    /**
     * Any raw HTML tag or comment construct: {@code <} followed by a letter (opening
     * tag), {@code /} (closing tag), {@code !} (comment/declaration/CDATA) or {@code ?}
     * (processing instruction). Bare {@code <} used as a less-than sign stays legal.
     */
    private static final Pattern RAW_HTML_CONSTRUCT = Pattern.compile("<[A-Za-z/!?][^\\s>]*>?");

    /**
     * Any HTML entity, named or numeric (decimal or hex), case-insensitive. Banning the
     * whole class ({@code &vert;}, {@code &verbar;}, {@code &VerticalLine;},
     * {@code &#124;}, {@code &#x7C;}, {@code &#45;}, ...) removes every encoded-character
     * hiding vector at once instead of chasing individual aliases.
     */
    private static final Pattern HTML_ENTITY =
            Pattern.compile("&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);");

    /** A CommonMark blockquote line: {@code >} after 0-3 spaces of indent. */
    private static final Pattern BLOCKQUOTE_LINE = Pattern.compile("^ {0,3}>.*$");

    /**
     * Reads a file, rejects every hiding vector the docs do not need, and keeps only the
     * CommonMark-visible lines, so hidden content can never be mistaken for
     * authoritative tables or digest lines.
     *
     * <p><strong>Rejected outright</strong> (anywhere in the raw file, including inside
     * fences, with a file/line/construct error): raw HTML tag/comment constructs
     * ({@link #RAW_HTML_CONSTRUCT}), HTML entities ({@link #HTML_ENTITY}) and blockquote
     * lines ({@link #BLOCKQUOTE_LINE}). The concept format needs none of these, so a
     * {@code <script>}/{@code <details>}-wrapped table, an HTML-commented digest, an
     * entity-encoded pipe or hyphen, and a blockquoted decoy row all fail loudly.
     *
     * <p><strong>Dropped</strong> (treated as nonexistent):
     * <ul>
     *   <li><strong>fenced code blocks</strong> &mdash; both backtick and tilde fences,
     *       indented 0&ndash;3 spaces. The opener's marker character and run length are
     *       remembered; only a run of the <em>same</em> marker at least as long (with
     *       nothing but whitespace after it) closes the fence. Other-marker runs and
     *       shorter same-marker runs inside the fence remain fence content (a nested
     *       decoy fence cannot re-expose content). Per CommonMark, a backtick opener
     *       with backticks in its info string is not a fence opener at all;</li>
     *   <li><strong>indented code lines</strong> &mdash; lines starting with four spaces
     *       or a tab (outside fences).</li>
     * </ul>
     * Unterminated fences fail loudly. Blank lines are preserved (as empty strings) so
     * table-region checks can detect blank rows where a feature row is expected.
     */
    private static List<String> readVisibleLines(Path file, String label) throws IOException {
        if (!Files.isRegularFile(file)) {
            throw new CatalogValidationException(label + " does not exist at " + file);
        }
        List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        rejectHtmlAndBlockquotes(lines, label);
        List<String> visible = new ArrayList<>();
        char fenceMarker = 0;
        int fenceLength = 0;
        for (String line : lines) {
            Matcher fence = FENCE_LINE.matcher(line);
            if (fenceMarker != 0) {
                // Inside a fence: only a closing run of the same marker, at least as
                // long, with nothing else after it, ends the block.
                if (fence.matches() && fence.group(2).charAt(0) == fenceMarker
                        && fence.group(2).length() >= fenceLength && fence.group(3).isBlank()) {
                    fenceMarker = 0;
                    fenceLength = 0;
                }
                continue;
            }
            if (fence.matches()) {
                char marker = fence.group(2).charAt(0);
                // A backtick info string may not contain backticks (CommonMark); such a
                // line is not a fence opener and stays visible as ordinary text.
                if (marker == '~' || !fence.group(3).contains("`")) {
                    fenceMarker = marker;
                    fenceLength = fence.group(2).length();
                    continue;
                }
            }
            if (line.startsWith("    ") || line.startsWith("\t")) {
                continue; // indented code line: never authoritative
            }
            visible.add(line);
        }
        if (fenceMarker != 0) {
            throw new CatalogValidationException(label + " has an unterminated fenced code block");
        }
        return visible;
    }

    /**
     * Rejects HTML tag/comment constructs, HTML entities and blockquote lines anywhere
     * in the raw file (fences included). The concept docs never need these, so wholesale
     * rejection eliminates the entire hiding/encoding class rather than chasing aliases.
     */
    private static void rejectHtmlAndBlockquotes(List<String> lines, String label) {
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            Matcher html = RAW_HTML_CONSTRUCT.matcher(line);
            if (html.find()) {
                throw new CatalogValidationException(label + " line " + (i + 1)
                        + " contains a raw HTML tag/comment construct ('" + html.group()
                        + "'); the concept format forbids all raw HTML (no <tag>, </tag>, <!-- -->,"
                        + " <!...> or <?...> anywhere, fences included)");
            }
            Matcher entity = HTML_ENTITY.matcher(line);
            if (entity.find()) {
                throw new CatalogValidationException(label + " line " + (i + 1)
                        + " contains an HTML entity ('" + entity.group()
                        + "'); the concept format forbids all named and numeric entities"
                        + " (encoded pipes, hyphens and every other alias fail identically)");
            }
            if (BLOCKQUOTE_LINE.matcher(line).matches()) {
                throw new CatalogValidationException(label + " line " + (i + 1)
                        + " is a blockquote ('" + line.strip()
                        + "'); the concept format forbids blockquote lines anywhere");
            }
        }
    }

    /** Exactly one well-formed digest line must exist outside fences. */
    private static String parseSingleDigestLine(List<String> lines) {
        List<String> digests = new ArrayList<>();
        for (String line : lines) {
            String stripped = line.strip();
            if (!stripped.contains(DIGEST_MARKER)) {
                continue;
            }
            Matcher matcher = DIGEST_LINE.matcher(stripped);
            if (!matcher.matches()) {
                throw new CatalogValidationException(
                        "INDEX.md digest line is malformed (must be exactly \"" + DIGEST_MARKER
                                + " `<64 hex chars>`\"): " + stripped);
            }
            digests.add(matcher.group(1));
        }
        if (digests.isEmpty()) {
            throw new CatalogValidationException(
                    "INDEX.md declares no authoritative content digest line outside hidden content"
                            + " (code fences, indented code)");
        }
        if (digests.size() > 1) {
            throw new CatalogValidationException(
                    "INDEX.md declares " + digests.size() + " visible authoritative digest lines;"
                            + " exactly one is required (first/last ambiguity is forbidden)");
        }
        return digests.get(0);
    }

    private static Map<String, FamilyRange> parseFamiliesTable(List<String> lines) {
        List<List<String>> rows = extractTable(lines, "INDEX.md", "families table",
                FAMILIES_HEADER, FAMILIES_DIVIDER, 8);
        Map<String, FamilyRange> familyRanges = new LinkedHashMap<>();
        for (List<String> cells : rows) {
            String prefix = cells.get(0);
            String context = "INDEX.md families row '" + prefix + "'";
            Matcher link = FILE_LINK.matcher(cells.get(1));
            if (!link.matches()) {
                throw new CatalogValidationException(context
                        + ": File cell must be a Markdown link [FILE](FILE) but is '" + cells.get(1) + "'");
            }
            String linkText = link.group(1);
            String linkTarget = link.group(2);
            if (!linkText.equals(linkTarget)) {
                throw new CatalogValidationException(context + ": link text '" + linkText
                        + "' does not equal link target '" + linkTarget + "' (link retargeting is forbidden)");
            }
            String expectedFile = prefix + ".md";
            if (!linkText.equals(expectedFile)) {
                throw new CatalogValidationException(context + ": family file link must be '"
                        + expectedFile + "' but is '" + linkText + "'");
            }
            String family = stripBackticks(cells.get(2));
            String[] range = cells.get(3).split("[\u2013-]"); // en dash or hyphen
            if (range.length != 2) {
                throw new CatalogValidationException(context + ": Sequence cell must be"
                        + " '<lo>\u2013<hi>' but is '" + cells.get(3) + "'");
            }
            FamilyRange row = new FamilyRange(prefix, linkText, family,
                    parseIntCell(context, "Sequence lo", range[0].strip()),
                    parseIntCell(context, "Sequence hi", range[1].strip()),
                    parseIntCell(context, "Count", cells.get(4)),
                    parseIntCell(context, "Core", cells.get(5)),
                    parseIntCell(context, "Stretch", cells.get(6)),
                    cells.get(7));
            if (familyRanges.put(row.prefix(), row) != null) {
                throw new CatalogValidationException(
                        "INDEX.md families table repeats prefix '" + row.prefix() + "'");
            }
        }
        return familyRanges;
    }

    private static List<ChecklistRow> parseChecklistTable(List<String> lines) {
        List<List<String>> rows = extractTable(lines, "INDEX.md", "machine-auditable checklist",
                CHECKLIST_HEADER, CHECKLIST_DIVIDER, 9);
        List<ChecklistRow> checklist = new ArrayList<>();
        for (List<String> cells : rows) {
            String context = "INDEX.md checklist row '" + cells.get(1) + "'";
            checklist.add(new ChecklistRow(
                    parseIntCell(context, "Seq", cells.get(0)),
                    cells.get(1), cells.get(2), stripBackticks(cells.get(3)), cells.get(4),
                    cells.get(5),
                    parseIntCell(context, "Prog", cells.get(6)),
                    cells.get(7), cells.get(8)));
        }
        return checklist;
    }

    /**
     * Parses the feature table of one family file (e.g. {@code PWR.md}): the exact
     * 12-column header/divider followed by exactly {@code range.count()} consecutive
     * feature rows. Blank lines inside the row region, missing rows and extra rows all
     * fail with precise errors.
     */
    public static List<FamilyRow> parseFamilyFile(Path docsDir, FamilyRange range) throws IOException {
        List<String> lines = readVisibleLines(docsDir.resolve(range.file()), range.file());
        int headerAt = findExactlyOne(lines, range.file(), "feature table header", FAMILY_TABLE_HEADER);
        requireDivider(lines, headerAt, range.file(), FAMILY_TABLE_DIVIDER);

        List<FamilyRow> rows = new ArrayList<>();
        int lineIndex = headerAt + 2;
        for (int rowNumber = 1; rowNumber <= range.count(); rowNumber++, lineIndex++) {
            String expectation = range.file() + ": expected feature row " + rowNumber + " of "
                    + range.count() + " (per the INDEX.md families table)";
            if (lineIndex >= lines.size()) {
                throw new CatalogValidationException(expectation + " but the file ends");
            }
            String line = lines.get(lineIndex);
            if (line.isBlank()) {
                throw new CatalogValidationException(expectation + " but found a blank line"
                        + " (blank rows inside the feature table are forbidden)");
            }
            if (!line.strip().startsWith("|")) {
                throw new CatalogValidationException(expectation + " but found a non-table line: "
                        + line.strip());
            }
            List<String> cells = splitTableRow(line, range.file());
            if (cells.size() != 12) {
                throw new CatalogValidationException(range.file() + " feature row " + rowNumber
                        + " must have 12 cells but has " + cells.size() + ": " + line.strip());
            }
            parseIntCell(range.file() + " feature row '" + cells.get(0) + "'", "Prog", cells.get(4));
            rows.add(new FamilyRow(cells.get(0), cells.get(1), cells.get(2), cells.get(3),
                    cells.get(4), cells.get(5), cells.get(6), cells.get(7), cells.get(8),
                    cells.get(9), cells.get(10), cells.get(11)));
        }
        for (int i = lineIndex; i < lines.size(); i++) {
            if (lines.get(i).strip().startsWith("|")) {
                throw new CatalogValidationException(range.file() + " has an unexpected extra table row"
                        + " after the declared " + range.count() + " feature rows: " + lines.get(i).strip());
            }
        }
        return rows;
    }

    /** Splits the deps cell of a checklist/family row into ids ({@code "-"} = none). */
    public static List<String> splitDepsCell(String depsCell) {
        if ("-".equals(depsCell)) {
            return List.of();
        }
        List<String> deps = new ArrayList<>();
        for (String dep : depsCell.split(",")) {
            deps.add(dep.strip());
        }
        return List.copyOf(deps);
    }

    /**
     * Extracts the single table introduced by the exact header/divider pair. Rows are
     * the consecutive following table lines; a blank line followed by more table rows
     * is reported as a forbidden blank row instead of being skipped.
     */
    private static List<List<String>> extractTable(List<String> lines, String file, String label,
                                                   String header, String divider, int cellCount) {
        int headerAt = findExactlyOne(lines, file, label + " header", header);
        requireDivider(lines, headerAt, file, divider);
        List<List<String>> rows = new ArrayList<>();
        for (int i = headerAt + 2; i < lines.size(); i++) {
            String line = lines.get(i);
            if (line.isBlank()) {
                int next = i + 1;
                while (next < lines.size() && lines.get(next).isBlank()) {
                    next++;
                }
                if (next < lines.size() && lines.get(next).strip().startsWith("|")) {
                    throw new CatalogValidationException(file + " " + label
                            + " contains a blank line between rows (a row is expected there)");
                }
                break;
            }
            if (!line.strip().startsWith("|")) {
                break;
            }
            List<String> cells = splitTableRow(line, file);
            if (cells.size() != cellCount) {
                throw new CatalogValidationException(file + " " + label + " row must have " + cellCount
                        + " cells but has " + cells.size() + ": " + line.strip());
            }
            rows.add(cells);
        }
        if (rows.isEmpty()) {
            throw new CatalogValidationException(file + " " + label + " has no data rows");
        }
        return rows;
    }

    /** The exact line must occur exactly once; substituted/duplicated headers fail. */
    private static int findExactlyOne(List<String> lines, String file, String label, String exact) {
        int found = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).strip().equals(exact)) {
                if (found != -1) {
                    throw new CatalogValidationException(file + " contains the " + label
                            + " more than once; exactly one is required");
                }
                found = i;
            }
        }
        if (found == -1) {
            throw new CatalogValidationException(file + " is missing the supported " + label
                    + " (must be exactly \"" + exact + "\"); header substitution is forbidden");
        }
        return found;
    }

    private static void requireDivider(List<String> lines, int headerAt, String file, String divider) {
        String actual = headerAt + 1 < lines.size() ? lines.get(headerAt + 1).strip() : "<end of file>";
        if (!actual.equals(divider)) {
            throw new CatalogValidationException(file + " table divider after the header must be exactly \""
                    + divider + "\" but is \"" + actual + "\"");
        }
    }

    private static List<String> splitTableRow(String line, String file) {
        String stripped = line.strip();
        if (stripped.contains("\\|")) {
            throw new CatalogValidationException(file + " table row contains an escaped pipe (\\|),"
                    + " which the supported concept table format forbids: " + stripped);
        }
        // Encoded pipes need no dedicated check here: every HTML entity (named, decimal
        // and hex) is already rejected at the raw-line level by readVisibleLines.
        if (!stripped.startsWith("|") || !stripped.endsWith("|")) {
            throw new CatalogValidationException(file + " table row must start and end with '|': " + stripped);
        }
        String body = stripped.substring(1, stripped.length() - 1);
        List<String> cells = new ArrayList<>();
        for (String cell : body.split("\\|", -1)) {
            cells.add(cell.strip());
        }
        return cells;
    }

    /** Parses an integer cell with a clean error instead of a raw NumberFormatException. */
    static int parseIntCell(String context, String cellName, String value) {
        try {
            return Integer.parseInt(value.strip());
        } catch (NumberFormatException e) {
            throw new CatalogValidationException(context + ": " + cellName
                    + " cell must be an integer but is '" + value + "'");
        }
    }

    private static String stripBackticks(String value) {
        return value.replace("`", "").strip();
    }

    /** JSON string encoding matching Python json.dumps defaults (ensure_ascii=True). */
    private static void appendJsonAsciiString(StringBuilder sb, String value) {
        sb.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                default -> {
                    if (c < 0x20 || c > 0x7e) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
