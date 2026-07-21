package dev.cuprum.cuprum;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Pattern;
import java.util.spi.ToolProvider;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * W1 API freeze gate (plan D5): the public/protected surface of the frozen packages is
 * digested with JDK {@code javap} (via {@link ToolProvider} — no new dependency) and compared
 * against the committed {@code api/cuprum-api.lock}. Any removed/changed/added member fails
 * this test until the lock is explicitly regenerated with
 * {@code ./gradlew test -Dcuprum.apilock.update=true} — a reviewed two-file diff (source +
 * lock), mirroring the catalog digest discipline.
 *
 * <p>Frozen surface (plan D5 list): main {@code charge}, {@code charge.core},
 * {@code multiblock}, {@code machine}, {@code net} + {@code net.server} (the guard API),
 * {@code ownership}, {@code state}, {@code config}, {@code api.handbook}; client
 * {@code client.api.handbook} and the {@code client.fx} public entry points (top-level
 * package only — {@code fx.render}/{@code fx.particle} internals extend via enqueue/append
 * and are not frozen).
 *
 * <p>Normalization: {@code javap -protected} per class file; "Compiled from" banners, braces
 * and {@code static {};} initializers dropped; anonymous/local classes ({@code $<digit>})
 * skipped; non-public/protected classes skipped; every remaining line is prefixed with its
 * binary class name and the whole listing is sorted — member order in the class file can
 * never affect the digest. The lock stores the full sorted listing plus its SHA-256, so a
 * surface change reviews as a readable line diff.
 *
 * <p>If {@code ToolProvider.findFirst("javap")} is ever empty (JRE-only environment — not
 * expected: the pinned Gradle toolchain is a full JDK 21), this test fails loudly; the
 * documented contingency is a reflection-based freeze probe in the gametest source set
 * (plan D5), to be added only if that ever triggers.
 */
final class ApiFreezeTest {
    private static final Pattern ANON_OR_LOCAL = Pattern.compile("\\$\\d");
    private static final String SHA_PREFIX = "sha256:";

    /** Frozen package directories, relative to each source set's class dir (plan D5). */
    private static final Map<String, List<String>> FROZEN_PACKAGES = Map.of(
            "cuprum.mainClassesDir", List.of(
                    "dev/cuprum/cuprum/charge",
                    "dev/cuprum/cuprum/charge/core",
                    "dev/cuprum/cuprum/multiblock",
                    "dev/cuprum/cuprum/machine",
                    "dev/cuprum/cuprum/net",
                    "dev/cuprum/cuprum/net/server",
                    "dev/cuprum/cuprum/ownership",
                    "dev/cuprum/cuprum/state",
                    "dev/cuprum/cuprum/config",
                    "dev/cuprum/cuprum/api/handbook"),
            "cuprum.clientClassesDir", List.of(
                    "dev/cuprum/cuprum/client/api/handbook",
                    "dev/cuprum/cuprum/client/fx"));

    @Test
    void frozenApiSurfaceMatchesCommittedLock() throws Exception {
        Path lockFile = Path.of(requireProperty("cuprum.apiLockFile"));
        List<String> listing = currentListing();
        String digest = sha256(String.join("\n", listing) + "\n");

        if (Boolean.getBoolean("cuprum.apilock.update")) {
            writeLock(lockFile, digest, listing);
            System.out.println("[apifreeze] regenerated " + lockFile + " (sha256:" + digest
                    + ", " + listing.size() + " lines) — review and commit the two-file diff");
        }

        assertTrue(Files.isRegularFile(lockFile),
                "api/cuprum-api.lock is missing — bootstrap it once with -Dcuprum.apilock.update=true");
        Lock lock = readLock(lockFile);
        String lockBodyDigest = sha256(String.join("\n", lock.lines()) + "\n");
        assertTrue(lockBodyDigest.equals(lock.digest()),
                "api/cuprum-api.lock is internally inconsistent (header sha256 does not match its own body)"
                        + " — the lock was hand-edited; regenerate via -Dcuprum.apilock.update=true");

        if (!digest.equals(lock.digest())) {
            fail(diffMessage(lock.lines(), listing, digest, lock.digest()));
        }
    }

    private static List<String> currentListing() throws IOException {
        ToolProvider javap = ToolProvider.findFirst("javap").orElseThrow(() -> new AssertionError(
                "javap ToolProvider unavailable — run tests on a full JDK (see plan D5 contingency)"));
        TreeSet<String> lines = new TreeSet<>();
        for (Map.Entry<String, List<String>> sourceSet : FROZEN_PACKAGES.entrySet()) {
            Path classesDir = Path.of(requireProperty(sourceSet.getKey()));
            assertTrue(Files.isDirectory(classesDir),
                    sourceSet.getKey() + " does not point at a compiled class directory: " + classesDir);
            for (String packageDir : sourceSet.getValue()) {
                Path dir = classesDir.resolve(packageDir);
                assertTrue(Files.isDirectory(dir),
                        "frozen package directory missing (was a package renamed?): " + dir);
                for (Path classFile : listClassFiles(dir)) {
                    lines.addAll(javapLines(javap, classFile));
                }
            }
        }
        assertTrue(lines.size() > 100, "implausibly small frozen surface (" + lines.size()
                + " lines) — javap parsing or class-dir wiring is broken");
        return List.copyOf(lines);
    }

    /** Non-recursive: subpackages are frozen only when explicitly listed (plan D5). */
    private static List<Path> listClassFiles(Path dir) throws IOException {
        try (Stream<Path> entries = Files.list(dir)) {
            return entries
                    .filter(p -> p.getFileName().toString().endsWith(".class"))
                    .filter(p -> !ANON_OR_LOCAL.matcher(p.getFileName().toString()).find())
                    .filter(p -> !p.getFileName().toString().equals("package-info.class"))
                    .sorted()
                    .toList();
        }
    }

    private static List<String> javapLines(ToolProvider javap, Path classFile) {
        StringWriter out = new StringWriter();
        StringWriter err = new StringWriter();
        int exit = javap.run(new PrintWriter(out), new PrintWriter(err),
                "-protected", classFile.toString());
        if (exit != 0) {
            throw new AssertionError("javap failed for " + classFile + ":\n" + err);
        }
        List<String> lines = new ArrayList<>();
        String className = null;
        boolean classIsExported = false;
        for (String raw : out.toString().split("\\R")) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("Compiled from") || line.equals("}")
                    || line.equals("static {};")) {
                continue;
            }
            if (className == null && line.endsWith("{")) {
                String declaration = line.substring(0, line.length() - 1).strip();
                classIsExported = declaration.startsWith("public") || declaration.startsWith("protected");
                if (!classIsExported) {
                    return List.of();
                }
                className = binaryClassName(declaration);
                lines.add(className + " :: " + declaration);
                continue;
            }
            if (className != null && classIsExported) {
                lines.add(className + " :: " + line);
            }
        }
        if (className == null && !out.toString().isBlank()) {
            throw new AssertionError("could not parse javap declaration for " + classFile + ":\n" + out);
        }
        return lines;
    }

    /** Extracts the binary name from a javap class declaration line. */
    private static String binaryClassName(String declaration) {
        // Cut inheritance/permits clauses, then take the last dotted token of the header.
        String header = declaration;
        for (String cut : List.of(" extends ", " implements ", " permits ")) {
            int idx = header.indexOf(cut);
            if (idx >= 0) {
                header = header.substring(0, idx);
            }
        }
        int generics = header.indexOf('<');
        if (generics >= 0) {
            header = header.substring(0, generics);
        }
        String[] tokens = header.strip().split("\\s+");
        return tokens[tokens.length - 1];
    }

    private record Lock(String digest, List<String> lines) {
    }

    private static Lock readLock(Path lockFile) throws IOException {
        String digest = null;
        List<String> lines = new ArrayList<>();
        for (String line : Files.readAllLines(lockFile, StandardCharsets.UTF_8)) {
            if (line.startsWith("#") || line.isBlank()) {
                continue;
            }
            if (line.startsWith(SHA_PREFIX)) {
                digest = line.substring(SHA_PREFIX.length()).strip();
                continue;
            }
            lines.add(line);
        }
        if (digest == null) {
            throw new AssertionError("api/cuprum-api.lock has no sha256: header line");
        }
        return new Lock(digest, List.copyOf(lines));
    }

    private static void writeLock(Path lockFile, String digest, List<String> listing) throws IOException {
        StringBuilder out = new StringBuilder();
        out.append("# Cuprum frozen W1 API surface — normalized `javap -protected` listing (plan D5).\n");
        out.append("# Any change to this file is a reviewed two-file diff. Regenerate ONLY via:\n");
        out.append("#   ./gradlew test --tests dev.cuprum.cuprum.ApiFreezeTest -Dcuprum.apilock.update=true\n");
        out.append(SHA_PREFIX).append(digest).append('\n');
        for (String line : listing) {
            out.append(line).append('\n');
        }
        Files.createDirectories(lockFile.getParent());
        Files.writeString(lockFile, out.toString(), StandardCharsets.UTF_8);
    }

    private static String diffMessage(List<String> lockLines, List<String> current,
            String currentDigest, String lockDigest) {
        LinkedHashSet<String> removed = new LinkedHashSet<>(lockLines);
        current.forEach(removed::remove);
        LinkedHashSet<String> added = new LinkedHashSet<>(current);
        lockLines.forEach(added::remove);
        StringBuilder message = new StringBuilder();
        message.append("frozen API surface changed (lock sha256:").append(lockDigest)
                .append(" vs current sha256:").append(currentDigest).append(").\n")
                .append("If this change is intended and reviewed, regenerate the lock via ")
                .append("-Dcuprum.apilock.update=true and commit the two-file diff.\n");
        appendLines(message, "Removed/changed members", removed);
        appendLines(message, "Added/changed members", added);
        return message.toString();
    }

    private static void appendLines(StringBuilder message, String label, LinkedHashSet<String> lines) {
        message.append(label).append(" (").append(lines.size()).append("):\n");
        lines.stream().limit(25).forEach(line -> message.append("  ").append(line).append('\n'));
        if (lines.size() > 25) {
            message.append("  ... ").append(lines.size() - 25).append(" more\n");
        }
    }

    private static String sha256(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(String.format(Locale.ROOT, "%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new AssertionError("SHA-256 unavailable", e);
        }
    }

    private static String requireProperty(String key) {
        String value = System.getProperty(key);
        assertTrue(value != null && !value.isBlank(),
                "system property " + key + " must be set by build.gradle's test block");
        return value;
    }
}
