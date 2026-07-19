package dev.cuprum.catalogtool;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static dev.cuprum.catalogtool.CatalogValidatorTest.repoCatalog;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Durable concept/catalog parity: the 16 family tables plus the INDEX.md checklist in
 * {@code docs/feature-concepts} are the authoritative source for all 250 additional
 * entries, sealed by one full-row SHA-256 digest, and {@link ConceptParity} must prove
 * the catalog matches them row for row. The mutation tests prove that silent drift in
 * either direction — and every known Markdown-level attack on the parser — fails loudly.
 */
class ConceptParityTest {
    private static final Path DOCS_DIR =
            Path.of(System.getProperty("cuprum.conceptDocsDir", "docs/feature-concepts"));

    /**
     * The full-row digest literal published in INDEX.md. Pinned here so that any change
     * to the concept docs' 250x12 cells requires an explicit, reviewed test diff.
     */
    private static final String EXPECTED_DIGEST =
            "c6b8a308f39c6c9e35223f13464af607de7d99881e5ca1fb12cc80fc109075b7";

    private static JsonObject entry(JsonObject catalog, String id) {
        for (var element : catalog.getAsJsonArray("entries")) {
            JsonObject entry = element.getAsJsonObject();
            if (entry.get("id").getAsString().equals(id)) {
                return entry;
            }
        }
        throw new AssertionError("no entry " + id);
    }

    /** Copies the real concept docs into a temp dir so a test can mutate them safely. */
    private static Path copyDocs(Path tempDir) throws IOException {
        Path copy = tempDir.resolve("feature-concepts");
        Files.createDirectories(copy);
        try (var stream = Files.list(DOCS_DIR)) {
            for (Path file : stream.toList()) {
                Files.copy(file, copy.resolve(file.getFileName().toString()));
            }
        }
        return copy;
    }

    /** Replaces {@code needle} with {@code replacement} in one doc file (must occur). */
    private static void mutate(Path docsDir, String file, String needle, String replacement) throws IOException {
        Path path = docsDir.resolve(file);
        String content = Files.readString(path);
        assertTrue(content.contains(needle), file + " must contain: " + needle);
        Files.writeString(path, content.replace(needle, replacement));
    }

    private static List<String> validateMutated(Path docsDir) throws Exception {
        return ConceptParity.validate(repoCatalog(), docsDir);
    }

    // ------------------------------------------------------------------
    // Positive: repo docs + repo catalog agree, digest recomputes exactly.
    // ------------------------------------------------------------------

    @Test
    void conceptDocsParseToTwoHundredFiftyRowsWithDeclaredDigest() throws Exception {
        ConceptIndex index = ConceptIndex.parse(DOCS_DIR);
        assertEquals(250, index.checklist().size());
        assertEquals(16, index.familyRanges().size());
        assertEquals(EXPECTED_DIGEST, index.declaredDigest(), "INDEX.md digest literal changed");
        assertEquals(23, index.checklist().get(0).seq());
        assertEquals(272, index.checklist().get(249).seq());

        // Recompute the documented full-row formula over all 16 family files.
        List<ConceptIndex.FamilyRow> rows = new ArrayList<>();
        for (ConceptIndex.FamilyRange range : index.familyRanges().values()) {
            rows.addAll(ConceptIndex.parseFamilyFile(DOCS_DIR, range));
        }
        assertEquals(250, rows.size());
        assertEquals(EXPECTED_DIGEST, ConceptIndex.computeFullRowDigest(rows),
                "family-table rows no longer hash to the published full-row digest (docs drifted)");
    }

    @Test
    void familyRowsRetainAllTwelveCells() throws Exception {
        ConceptIndex index = ConceptIndex.parse(DOCS_DIR);
        ConceptIndex.FamilyRange pwr = index.familyRanges().get("PWR");
        ConceptIndex.FamilyRow row = ConceptIndex.parseFamilyFile(DOCS_DIR, pwr).get(0);
        assertEquals("PWR-01", row.id());
        assertEquals(12, row.cells().size());
        assertTrue(row.visualSignature().contains("emissive load texture"), row.visualSignature());
        assertTrue(row.acceptance().contains("400 Cg/t"), row.acceptance());
        assertEquals("server_gametest:pwr01_bus_transfer_rate", row.test());
    }

    @Test
    void repoCatalogMatchesConceptDocsExactly() throws Exception {
        List<String> errors = ConceptParity.validate(repoCatalog(), DOCS_DIR);
        assertEquals(List.of(), errors, "catalog must match the concept docs 1:1");
    }

    // ------------------------------------------------------------------
    // Catalog-side drift must fail.
    // ------------------------------------------------------------------

    @Test
    void renamedAdditionalEntryFailsParity() throws Exception {
        JsonObject catalog = repoCatalog();
        entry(catalog, "PWR-01").addProperty("name", "Copper Power Duct");
        List<String> errors = ConceptParity.validate(catalog, DOCS_DIR);
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("PWR-01") && e.contains("Copper Power Duct") && e.contains("Copper Bus Bar")),
                errors.toString());
    }

    @Test
    void retieredAdditionalEntryFailsParity() throws Exception {
        JsonObject catalog = repoCatalog();
        // Quietly promoting a stretch feature to core must be caught.
        entry(catalog, "PWR-22").addProperty("tier", "core");
        List<String> errors = ConceptParity.validate(catalog, DOCS_DIR);
        assertTrue(errors.stream().anyMatch(e -> e.contains("PWR-22") && e.contains("tier")), errors.toString());
    }

    @Test
    void rewavedAdditionalEntryFailsParity() throws Exception {
        JsonObject catalog = repoCatalog();
        entry(catalog, "QOL-12").addProperty("planned_wave", "W14");
        List<String> errors = ConceptParity.validate(catalog, DOCS_DIR);
        assertTrue(errors.stream().anyMatch(e -> e.contains("QOL-12") && e.contains("planned_wave")),
                errors.toString());
    }

    @Test
    void changedDepsFailParity() throws Exception {
        JsonObject catalog = repoCatalog();
        entry(catalog, "OXI-09").getAsJsonArray("deps").remove(0);
        List<String> errors = ConceptParity.validate(catalog, DOCS_DIR);
        assertTrue(errors.stream().anyMatch(e -> e.contains("OXI-09") && e.contains("deps")), errors.toString());
    }

    @Test
    void rewordedSummaryFailsParity() throws Exception {
        JsonObject catalog = repoCatalog();
        entry(catalog, "GOL-01").addProperty("summary", "Some invented behavior.");
        List<String> errors = ConceptParity.validate(catalog, DOCS_DIR);
        assertTrue(errors.stream().anyMatch(e -> e.contains("GOL-01") && e.contains("summary")), errors.toString());
    }

    @Test
    void missingAdditionalEntryFailsParity() throws Exception {
        JsonObject catalog = repoCatalog();
        catalog.getAsJsonArray("entries").remove(271); // drop QOL-12
        List<String> errors = ConceptParity.validate(catalog, DOCS_DIR);
        assertTrue(errors.stream().anyMatch(e -> e.contains("249") && e.contains("250")), errors.toString());
    }

    // ------------------------------------------------------------------
    // Docs-side drift must fail via the full-row digest.
    // ------------------------------------------------------------------

    @Test
    void editedFamilyTableCellFailsDigest(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // Change name consistently in both the checklist and the family file, so only
        // the digest (not a cross-table mismatch) can catch it — plus catalog parity.
        mutate(docs, "INDEX.md", "Copper Bus Bar", "Copper Power Duct");
        mutate(docs, "PWR.md", "Copper Bus Bar", "Copper Power Duct");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("full-row digest mismatch")), errors.toString());
    }

    @Test
    void editedAcceptanceCellFailsDigestEvenWhenCatalogUnaffected(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // Acceptance is not copied into the catalog, but the full-row digest still seals it.
        mutate(docs, "PWR.md", "sustains exactly 400 Cg/t", "sustains exactly 999 Cg/t");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("full-row digest mismatch")), errors.toString());
    }

    // ------------------------------------------------------------------
    // Markdown attack suite (evaluator scenarios) — all must fail precisely.
    // ------------------------------------------------------------------

    @Test
    void retargetedFamilyLinkFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md", "[PWR.md](PWR.md)", "[PWR.md](TES.md)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("link retargeting is forbidden")), errors.toString());
    }

    @Test
    void substitutedFamilyTableHeaderFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "PWR.md",
                "| ID | Name | Type | Tier | Prog | Wave | Deps | Vanilla overlap |",
                "| ID | Name | Kind | Tier | Prog | Wave | Deps | Vanilla overlap |");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR.md") && e.contains("header substitution is forbidden")), errors.toString());
    }

    @Test
    void substitutedChecklistHeaderFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md",
                "| Seq | ID | Name | Family | Type | Tier | Prog | Wave | Deps |",
                "| Seq | ID | Title | Family | Type | Tier | Prog | Wave | Deps |");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("header substitution is forbidden")),
                errors.toString());
    }

    @Test
    void digestMovedIntoCodeFenceFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md",
                "Content digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`",
                "```\nContent digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`\n```");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("no authoritative content digest line outside hidden content")), errors.toString());
    }

    @Test
    void decoyDigestInsideCodeFenceIsIgnored(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // A fenced decoy digest must not shadow or duplicate the real one.
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "```\nContent digest (full-row, authoritative): `"
                        + "0".repeat(64) + "`\n```\n\n## Vocabulary (binding definitions)");
        assertEquals(List.of(), validateMutated(docs));
    }

    @Test
    void duplicateDigestLinesFail(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        String digestLine = "Content digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`";
        mutate(docs, "INDEX.md", digestLine, digestLine + "\n\n" + digestLine);
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("2 visible authoritative digest lines")
                        && e.contains("first/last ambiguity is forbidden")),
                errors.toString());
    }

    @Test
    void blankVisualAcceptanceTestCellsFail(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // Blank out the Visual/Acceptance/Test cells of PWR-08 (keeps 12 cells).
        mutate(docs, "PWR.md",
                "| Spinning crank arm animation with ratchet click loop and spark motes"
                        + " (T2: same animation, no motes; T3: 2-frame crank texture)"
                        + " | Holding use for 100 ticks deposits exactly 2,000 Cg (20 Cg/t) into an adjacent cell;"
                        + " releasing stops output within 1 tick. | server_gametest:pwr08_crank_generates |",
                "|  |  |  |");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("PWR-08") && e.contains("blank 'Visual signature'")),
                errors.toString());
        assertTrue(errors.stream().anyMatch(e -> e.contains("PWR-08") && e.contains("blank 'Acceptance'")),
                errors.toString());
        assertTrue(errors.stream().anyMatch(e -> e.contains("PWR-08") && e.contains("blank 'Test'")),
                errors.toString());
    }

    @Test
    void blankRowInsideChecklistFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md",
                "| 24 | PWR-02 |",
                "\n| 24 | PWR-02 |");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("blank line between rows")), errors.toString());
    }

    @Test
    void blankRowInsideFamilyTableFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "PWR.md", "| PWR-02 | Insulated Cable |", "\n| PWR-02 | Insulated Cable |");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("expected feature row 2") && e.contains("blank line")), errors.toString());
    }

    @Test
    void missingFamilyRowFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        String content = Files.readString(docs.resolve("PWR.md"));
        int start = content.indexOf("| PWR-24 |");
        Files.writeString(docs.resolve("PWR.md"), content.substring(0, start));
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("expected feature row 24 of 24") && e.contains("file ends")), errors.toString());
    }

    @Test
    void escapedPipeIsRejectedPrecisely(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "PWR.md", "Flat surface-mounted conduit", "Flat \\| surface-mounted conduit");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("escaped pipe")), errors.toString());
    }

    @Test
    void encodedPipeEntitiesAreRejectedPrecisely(@TempDir Path tempDir) throws Exception {
        // Every entity alias of '|' — decimal, hex (either case), &vert;, &verbar; and
        // &VerticalLine; — falls to the wholesale entity ban with a precise error.
        for (String form : List.of("&#124;", "&#0124;", "&#x7c;", "&#X7C;", "&vert;", "&VERT;",
                "&verbar;", "&VerticalLine;")) {
            Path docs = copyDocs(Files.createTempDirectory(tempDir, "form"));
            mutate(docs, "PWR.md", "Flat surface-mounted conduit",
                    "Flat " + form + " surface-mounted conduit");
            List<String> errors = validateMutated(docs);
            assertTrue(errors.stream().anyMatch(e ->
                            e.contains("HTML entity") && e.contains("'" + form + "'")),
                    form + " -> " + errors);
        }
    }

    @Test
    void encodedHyphenInFeatureIdIsRejectedBeforeIdExtraction(@TempDir Path tempDir) throws Exception {
        // "PWR&#45;22" would evade naive id-reference extraction; the wholesale entity
        // ban rejects it while reading the file, long before acceptance parsing.
        Path docs = copyDocs(tempDir);
        mutate(docs, "FX.md",
                "Brewing awkward potion + conductive paste yields the potion",
                "Brewing awkward potion + PWR&#45;22 conductive paste yields the potion");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("HTML entity") && e.contains("'&#45;'")),
                errors.toString());
    }

    // ------------------------------------------------------------------
    // CommonMark hidden-content attacks: fenced (backtick + tilde), indented and
    // HTML-commented content is never authoritative — and nested fences cannot
    // re-expose it.
    // ------------------------------------------------------------------

    @Test
    void tildeFencedDigestFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md",
                "Content digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`",
                "~~~\nContent digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`\n~~~");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("no authoritative content digest line")), errors.toString());
    }

    @Test
    void indentedCodeDigestFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // A four-space indent turns the digest line into an indented code block.
        mutate(docs, "INDEX.md",
                "Content digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`",
                "    Content digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("no authoritative content digest line")), errors.toString());
    }

    @Test
    void htmlCommentedDigestFails(@TempDir Path tempDir) throws Exception {
        // HTML comments are no longer silently stripped: any comment construct is a
        // parse error, so a commented-out digest cannot even exist ambiguously.
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md",
                "Content digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`",
                "<!-- Content digest (full-row, authoritative): `" + EXPECTED_DIGEST + "` -->");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("raw HTML tag/comment construct")), errors.toString());
    }

    @Test
    void multilineHtmlCommentedDecoyDigestIsRejectedOutright(@TempDir Path tempDir) throws Exception {
        // A decoy digest wrapped in a multiline comment is not "ignored" — the comment
        // itself is rejected, because the concept format forbids all raw HTML.
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "<!--\nContent digest (full-row, authoritative): `" + "0".repeat(64)
                        + "`\n-->\n\n## Vocabulary (binding definitions)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("raw HTML tag/comment construct")), errors.toString());
    }

    @Test
    void scriptWrappedDecoyTableAndDigestFail(@TempDir Path tempDir) throws Exception {
        // <script>-hidden content must not parse and must not pass silently either:
        // the tag construct itself is rejected with file/line detail.
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "<script type=\"text/plain\">\nContent digest (full-row, authoritative): `"
                        + "0".repeat(64) + "`\n| 273 | QOL-13 | Fake Feature | `quality_of_life`"
                        + " | item | core | 1 | W13 | - |\n</script>\n\n## Vocabulary (binding definitions)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("raw HTML tag/comment construct") && e.contains("<script")), errors.toString());
    }

    @Test
    void detailsWrappedDecoyDigestFails(@TempDir Path tempDir) throws Exception {
        // <details>/<summary> collapse content in rendered Markdown; the construct is
        // rejected outright instead of gambling on renderer behavior.
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "<details><summary>notes</summary>\nContent digest (full-row, authoritative): `"
                        + "0".repeat(64) + "`\n</details>\n\n## Vocabulary (binding definitions)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("raw HTML tag/comment construct") && e.contains("<details")), errors.toString());
    }

    @Test
    void blockquotedDecoyDigestAndRowFail(@TempDir Path tempDir) throws Exception {
        // Blockquote lines are forbidden anywhere: a quoted decoy digest or feature row
        // fails on the blockquote itself, not on downstream ambiguity.
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "> Content digest (full-row, authoritative): `" + "0".repeat(64) + "`\n"
                        + "> | 273 | QOL-13 | Fake Feature | `quality_of_life` | item | core | 1 | W13 | - |\n"
                        + "\n## Vocabulary (binding definitions)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("is a blockquote")), errors.toString());
    }

    @Test
    void indentedBlockquoteAlsoFails(@TempDir Path tempDir) throws Exception {
        // CommonMark treats up to 3 leading spaces before '>' as a blockquote too.
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "   > quoted decoy\n\n## Vocabulary (binding definitions)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("is a blockquote")), errors.toString());
    }

    @Test
    void tildeFencedDecoyDigestIsIgnored(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "~~~\nContent digest (full-row, authoritative): `" + "0".repeat(64)
                        + "`\n~~~\n\n## Vocabulary (binding definitions)");
        assertEquals(List.of(), validateMutated(docs));
    }

    @Test
    void indentedDecoyDigestIsIgnored(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "    Content digest (full-row, authoritative): `" + "0".repeat(64)
                        + "`\n\n## Vocabulary (binding definitions)");
        assertEquals(List.of(), validateMutated(docs));
    }

    @Test
    void nestedFenceRunsCannotReexposeHiddenContent(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // A 4-tilde fence hides a decoy digest and a decoy checklist row; the inner
        // backtick run and the shorter tilde run are content, not closers, so nothing
        // inside leaks out. The document must still validate cleanly.
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "~~~~\n```\nContent digest (full-row, authoritative): `" + "0".repeat(64)
                        + "`\n~~~\n| 273 | QOL-13 | Fake Feature | `quality_of_life` | item | core"
                        + " | 1 | W13 | - |\n```\n~~~~\n\n## Vocabulary (binding definitions)");
        assertEquals(List.of(), validateMutated(docs));
    }

    @Test
    void indentedFenceOpenerStillHidesContent(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // Fence markers indented 1-3 spaces are still fences (CommonMark).
        mutate(docs, "INDEX.md",
                "Content digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`",
                "  ```\nContent digest (full-row, authoritative): `" + EXPECTED_DIGEST + "`\n  ```");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("no authoritative content digest line")), errors.toString());
    }

    @Test
    void backtickFenceNotClosedByShorterRunKeepsHiding(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // A 4-backtick fence is not closed by a 3-backtick run: the decoy digest and
        // the shorter run stay hidden until the matching 4-backtick closer.
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "````\n```\nContent digest (full-row, authoritative): `" + "0".repeat(64)
                        + "`\n````\n\n## Vocabulary (binding definitions)");
        assertEquals(List.of(), validateMutated(docs));
    }

    @Test
    void unterminatedHtmlCommentFailsLoudly(@TempDir Path tempDir) throws Exception {
        // Even an unterminated comment opener is just a raw HTML construct — rejected
        // immediately, never "still open at end of file".
        Path docs = copyDocs(tempDir);
        mutate(docs, "INDEX.md", "## Vocabulary (binding definitions)",
                "<!-- never closed\n## Vocabulary (binding definitions)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e -> e.contains("raw HTML tag/comment construct")),
                errors.toString());
    }

    @Test
    void nonIntegerProgCellFailsCleanlyNotWithNumberFormatException(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "PWR.md",
                "| PWR-01 | Copper Bus Bar | block | core | 1 |",
                "| PWR-01 | Copper Bus Bar | block | core | one |");
        List<String> errors = validateMutated(docs); // must not throw NumberFormatException
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("Prog") && e.contains("must be an integer")),
                errors.toString());
    }

    // ------------------------------------------------------------------
    // Row-quality contract violations must fail.
    // ------------------------------------------------------------------

    @Test
    void bannedVagueAcceptanceTokenFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "PWR.md",
                "A jar feeding a sink through 8 bus bars sustains exactly 400 Cg/t;",
                "Bus bars transfer charge at the documented rate;");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("banned vague token 'documented'")), errors.toString());
    }

    @Test
    void acceptanceWithoutConcreteAssertionFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "PWR.md",
                "A jar feeding a sink through 8 bus bars sustains exactly 400 Cg/t; blockstate is OFF"
                        + " at 0 Cg/t, LOW at 1–199, HIGH at ≥200.",
                "Bus bars feel snappy and transfer charge nicely between machines.");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("no concrete assertion")),
                errors.toString());
    }

    @Test
    void worksAtT3AcceptanceFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // "Works at T3." must not count as concrete: T3 is a stripped label, "Works"
        // is not an assertion, and there is no unit-bound number left.
        mutate(docs, "PWR.md",
                "A jar feeding a sink through 8 bus bars sustains exactly 400 Cg/t; blockstate is OFF"
                        + " at 0 Cg/t, LOW at 1–199, HIGH at ≥200.",
                "Works at T3.");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("no concrete assertion")),
                errors.toString());
    }

    @Test
    void bareDigitAcceptanceFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // A number without an allowlisted unit or comparator is not concrete.
        mutate(docs, "PWR.md",
                "A jar feeding a sink through 8 bus bars sustains exactly 400 Cg/t; blockstate is OFF"
                        + " at 0 Cg/t, LOW at 1–199, HIGH at ≥200.",
                "Meets 3.");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("no concrete assertion")),
                errors.toString());
    }

    @Test
    void looksGoodAllCapsAcceptanceFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // A free-floating ALL_CAPS word is not an assertion: the broad ALL_CAPS success
        // path was removed, so "Looks GOOD." fails concreteness.
        mutate(docs, "PWR.md",
                "A jar feeding a sink through 8 bus bars sustains exactly 400 Cg/t; blockstate is OFF"
                        + " at 0 Cg/t, LOW at 1–199, HIGH at ≥200.",
                "Looks GOOD.");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("no concrete assertion")),
                errors.toString());
    }

    @Test
    void serverTestAssertingHudVocabularyFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // PWR-01 has a server_gametest target; its acceptance may not assert HUD output.
        mutate(docs, "PWR.md",
                "blockstate is OFF at 0 Cg/t, LOW at 1–199, HIGH at ≥200.",
                "blockstate is OFF at 0 Cg/t, LOW at 1–199, HIGH at ≥200, and the HUD shows the flow.");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("server_gametest") && e.contains("'HUD'")),
                errors.toString());
    }

    @Test
    void serverTestScreenDisplayBypassFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // Exact evaluator bypass: "Exactly 1 screen display appears" is numerically
        // concrete but asserts client-side output — a server gametest cannot verify it.
        mutate(docs, "PWR.md",
                "A jar feeding a sink through 8 bus bars sustains exactly 400 Cg/t; blockstate is OFF"
                        + " at 0 Cg/t, LOW at 1–199, HIGH at ≥200.",
                "Exactly 1 screen display appears.");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("server_gametest") && e.contains("'screen'")),
                errors.toString());
    }

    @Test
    void serverTestTextureModelAudioVocabularyFails(@TempDir Path tempDir) throws Exception {
        // The widened server-scope word list covers texture/model/audio/frame words too.
        for (String phrase : List.of("the block texture updates", "the model swaps",
                "the audio cue plays", "the frame rate holds")) {
            Path docs = copyDocs(Files.createTempDirectory(tempDir, "scope"));
            mutate(docs, "PWR.md",
                    "blockstate is OFF at 0 Cg/t, LOW at 1–199, HIGH at ≥200.",
                    "blockstate is OFF at 0 Cg/t, LOW at 1–199, HIGH at ≥200, and " + phrase + ".");
            List<String> errors = validateMutated(docs);
            assertTrue(errors.stream().anyMatch(e ->
                    e.contains("PWR-01") && e.contains("server_gametest")),
                    phrase + " -> " + errors);
        }
    }

    @Test
    void dispatchStateOnlyEscapeHatchAllowsServerVocabulary(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // The documented escape hatch: a server test may mention client-side words when
        // the cell explicitly says it only asserts dispatch/state, not the output.
        mutate(docs, "PWR.md",
                "blockstate is OFF at 0 Cg/t, LOW at 1–199, HIGH at ≥200.",
                "blockstate is OFF at 0 Cg/t, LOW at 1–199, HIGH at ≥200; the texture-change"
                        + " packet fires (only asserts dispatch, never the render).");
        List<String> errors = validateMutated(docs);
        // The digest changes (expected); no server-scope error may appear.
        assertTrue(errors.stream().noneMatch(e ->
                e.contains("PWR-01") && e.contains("server_gametest")), errors.toString());
    }

    @Test
    void unitTestAssertingPermissionVocabularyFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // ADV-01 has a unit_test target; its acceptance may not assert permissions.
        mutate(docs, "ADV.md",
                "each tier-completion node declares a non-empty reward pouch id (data assertions only).",
                "each tier-completion node declares a non-empty reward pouch id and a permission node.");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("ADV-01") && e.contains("unit_test") && e.contains("'permission'")),
                errors.toString());
    }

    @Test
    void unitTestBlockChangesBypassFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // Exact evaluator bypass: "Exactly 1 block changes" is numerically concrete but
        // asserts live world state — a plain JUnit test cannot verify it.
        mutate(docs, "ADV.md",
                "The tree JSON contains at least 60 nodes; every leaf is reachable from the root"
                        + " (graph reachability over 100% of leaves); each tier-completion node declares"
                        + " a non-empty reward pouch id (data assertions only).",
                "Exactly 1 block changes.");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("ADV-01") && e.contains("unit_test") && e.contains("'block'")),
                errors.toString());
    }

    @Test
    void acceptanceReferencingUndeclaredIdFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // DEC-08's core acceptance is standalone; smuggling the optional PWR-23 stretch
        // integration into it must fail (deps stay "-").
        mutate(docs, "DEC.md",
                "A 3×2 board stores 6 independent text pages",
                "A 3×2 board stores 6 independent PWR-23 feed pages");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("DEC-08") && e.contains("references PWR-23")
                        && e.contains("not a declared dependency")),
                errors.toString());
    }

    @Test
    void acceptanceReferencingLaterSequenceFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // Declare a forward dep on OXI-01 (seq 47) in both tables and reference it from
        // PWR-01 (seq 23): the acceptance-reference ordering rule must fire.
        mutate(docs, "INDEX.md",
                "| 23 | PWR-01 | Copper Bus Bar | `power_grid` | block | core | 1 | W5 | U05 |",
                "| 23 | PWR-01 | Copper Bus Bar | `power_grid` | block | core | 1 | W5 | U05, OXI-01 |");
        mutate(docs, "PWR.md",
                "| PWR-01 | Copper Bus Bar | block | core | 1 | W5 | U05 |",
                "| PWR-01 | Copper Bus Bar | block | core | 1 | W5 | U05, OXI-01 |");
        mutate(docs, "PWR.md",
                "A jar feeding a sink through 8 bus bars",
                "A jar feeding an OXI-01 sink through 8 bus bars");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("references OXI-01")
                        && e.contains("not earlier in the global sequence")),
                errors.toString());
    }

    @Test
    void unicodeHyphenIdReferenceIsStillExtractedAndChecked(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // A lookalike non-breaking hyphen (U+2011) must not smuggle an undeclared id
        // reference past extraction: normalization maps it to '-' first.
        mutate(docs, "FX.md",
                "Brewing awkward potion + conductive paste yields the potion",
                "Brewing awkward potion + PWR\u201122 conductive paste yields the potion");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("FX-14") && e.contains("references PWR-22")
                        && e.contains("not a declared dependency")),
                errors.toString());
    }

    @Test
    void coreAcceptanceReferencingStretchFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // Give FX-14 (core) a backward dep on stretch PWR-22 and reference it in
        // acceptance: the core-may-only-reference-core rule must fire.
        mutate(docs, "INDEX.md",
                "| 232 | FX-14 | Bottled Conductivity | `effects_enchants` | item | core | 2 | W12 | FX-05, OXI-16 |",
                "| 232 | FX-14 | Bottled Conductivity | `effects_enchants` | item | core | 2 | W12 |"
                        + " FX-05, OXI-16, PWR-22 |");
        mutate(docs, "FX.md", "| FX-05, OXI-16 |", "| FX-05, OXI-16, PWR-22 |");
        mutate(docs, "FX.md",
                "Brewing awkward potion + conductive paste yields the potion",
                "Brewing awkward potion + PWR-22 conductive paste yields the potion");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("FX-14") && e.contains("references PWR-22")
                        && e.contains("core acceptance may only reference core or user features")),
                errors.toString());
    }

    @Test
    void invalidTestIdPrefixFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "PWR.md", "server_gametest:pwr01_bus_transfer_rate", "gametest:pwr01_bus_transfer_rate");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("server_gametest:|client_gametest:|unit_test:")),
                errors.toString());
    }

    @Test
    void duplicateTestIdFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "PWR.md", "server_gametest:pwr02_cable_no_shock", "server_gametest:pwr01_bus_transfer_rate");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("used by both PWR-01 and PWR-02") && e.contains("must be unique")),
                errors.toString());
    }

    @Test
    void visualCellWithoutStructuredFallbackClausesFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // PWR-15's arc beam loses its structured T2:/T3: clauses entirely.
        mutate(docs, "PWR.md",
                "Arc beam between couplers (T1 shader ribbon) (T2: particle chain; T3: spark burst"
                        + " at endpoints only)",
                "Arc beam between couplers rendered with a custom shader ribbon");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-15") && e.contains("lacks explicit structured 'T2:' and 'T3:'")),
                errors.toString());
    }

    @Test
    void visualCellWithOnlyTwoClauseFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // A T2: clause alone is not enough; the T3: minimal fallback is also mandatory.
        mutate(docs, "PWR.md",
                "(T2: particle chain; T3: spark burst at endpoints only)",
                "(T2: particle chain)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-15") && e.contains("lacks explicit structured 'T2:' and 'T3:'")),
                errors.toString());
    }

    @Test
    void emptyVisualClauseBodiesFail(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // "T2: ; T3:" carries the markers but no fallback content — each clause body
        // must hold meaningful non-punctuation text.
        mutate(docs, "PWR.md",
                "(T2: particle chain; T3: spark burst at endpoints only)",
                "(T2: ; T3: )");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-15") && e.contains("'T2:' clause is empty or punctuation-only")),
                errors.toString());
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-15") && e.contains("'T3:' clause is empty or punctuation-only")),
                errors.toString());
    }

    @Test
    void punctuationOnlyVisualClauseFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        mutate(docs, "PWR.md",
                "(T2: particle chain; T3: spark burst at endpoints only)",
                "(T2: --- ...; T3: spark burst at endpoints only)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-15") && e.contains("'T2:' clause is empty or punctuation-only")),
                errors.toString());
    }

    @Test
    void visualClausesInWrongOrderFail(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // The structured clauses must appear in T2-then-T3 order.
        mutate(docs, "PWR.md",
                "(T2: particle chain; T3: spark burst at endpoints only)",
                "(T3: spark burst at endpoints only; T2: particle chain)");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-15") && e.contains("'T3:' before 'T2:'")),
                errors.toString());
    }

    @Test
    void checklistAndFamilyFileDisagreementFails(@TempDir Path tempDir) throws Exception {
        Path docs = copyDocs(tempDir);
        // Rename only in the family file: cross-table comparison must flag it even
        // before considering the digest.
        mutate(docs, "PWR.md", "| PWR-01 | Copper Bus Bar |", "| PWR-01 | Copper Power Duct |");
        List<String> errors = validateMutated(docs);
        assertTrue(errors.stream().anyMatch(e ->
                e.contains("PWR-01") && e.contains("disagrees between INDEX.md")), errors.toString());
    }
}
