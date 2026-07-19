package dev.cuprum.catalogtool;

import java.nio.file.Path;
import java.util.List;

/**
 * CLI entry point used by the {@code validateCatalog}, {@code generateCatalog} and
 * {@code verifyConceptParity} Gradle tasks (see build.gradle).
 *
 * <pre>
 *   validate &lt;catalog.json&gt; &lt;schema.json&gt; &lt;expected_counts.json&gt;
 *   generate &lt;catalog.json&gt; &lt;schema.json&gt; &lt;expected_counts.json&gt; &lt;packageName&gt; &lt;outputDir&gt;
 *   parity   &lt;catalog.json&gt; &lt;schema.json&gt; &lt;expected_counts.json&gt; &lt;conceptDocsDir&gt;
 * </pre>
 */
public final class CatalogTool {
    private CatalogTool() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            throw new IllegalArgumentException(
                    "usage: validate|generate|parity <catalog> <schema> <expectedCounts> [<package> <outDir> | <conceptDocsDir>]");
        }
        String mode = args[0];
        Path catalog = Path.of(args[1]);
        Path schema = Path.of(args[2]);
        Path expectedCounts = Path.of(args[3]);

        List<String> errors = CatalogValidator.validate(catalog, schema, expectedCounts);
        if (!errors.isEmpty()) {
            System.err.println("Catalog validation FAILED with " + errors.size() + " error(s):");
            errors.forEach(error -> System.err.println("  - " + error));
            System.exit(1);
        }
        System.out.println("Catalog validation OK: "
                + CatalogValidator.describeCounts(CatalogValidator.parseObject(catalog)) + " (" + catalog + ")");

        if ("generate".equals(mode)) {
            if (args.length != 6) {
                throw new IllegalArgumentException("generate requires <package> and <outputDir>");
            }
            Path written = CatalogCodegen.writeSource(catalog, args[4], Path.of(args[5]));
            System.out.println("Generated " + written);
        } else if ("parity".equals(mode)) {
            if (args.length != 5) {
                throw new IllegalArgumentException("parity requires <conceptDocsDir>");
            }
            Path docsDir = Path.of(args[4]);
            List<String> parityErrors = ConceptParity.validate(catalog, docsDir);
            if (!parityErrors.isEmpty()) {
                System.err.println("Concept/catalog parity FAILED with " + parityErrors.size() + " error(s):");
                parityErrors.forEach(error -> System.err.println("  - " + error));
                System.exit(1);
            }
            System.out.println("Concept/catalog parity OK: " + ConceptParity.describe(docsDir));
        } else if (!"validate".equals(mode)) {
            throw new IllegalArgumentException("unknown mode: " + mode);
        }
    }
}
