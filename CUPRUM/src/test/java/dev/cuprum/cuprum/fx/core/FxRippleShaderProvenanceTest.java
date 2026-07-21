package dev.cuprum.cuprum.fx.core;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * Build-time resource and clean-room provenance gate for the W1D ripple shaders.
 *
 * <p>The comparison source is deliberately absent from the repository: vanilla shaders are
 * opened only through the JUnit runtime class loader, scored in memory, and discarded.
 */
class FxRippleShaderProvenanceTest {
    private static final String CUPRUM_VERTEX = "assets/cuprum/shaders/core/fx_ripple.vsh";
    private static final String CUPRUM_FRAGMENT = "assets/cuprum/shaders/core/fx_ripple.fsh";
    private static final String VANILLA_VERTEX = "assets/minecraft/shaders/core/rendertype_lightning.vsh";
    private static final String VANILLA_FRAGMENT = "assets/minecraft/shaders/core/rendertype_lightning.fsh";
    private static final String PARTICLE_JSON = "assets/cuprum/particles/copper_mote.json";
    private static final String PARTICLE_TEXTURE = "assets/cuprum/textures/particle/copper_mote.png";

    /** Eight-token structural Dice score; identifiers/numbers are normalized before scoring. */
    private static final double MAX_STRUCTURAL_SIMILARITY = 0.42;
    private static final int NGRAM_SIZE = 8;

    private static final Pattern COMMENTS =
            Pattern.compile("/\\*.*?\\*/|//[^\\r\\n]*", Pattern.DOTALL);
    private static final Pattern TOKENS = Pattern.compile(
            "[A-Za-z_][A-Za-z0-9_]*"
                    + "|(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[eE][+-]?\\d+)?"
                    + "|==|!=|<=|>=|&&|\\|\\||\\+\\+|--"
                    + "|[{}()\\[\\];,.+\\-*/=<>?:]");
    private static final Set<String> STRUCTURAL_WORDS = Set.of(
            "const", "in", "out", "uniform", "void", "bool", "int", "float",
            "vec2", "vec3", "vec4", "mat2", "mat3", "mat4",
            "if", "else", "for", "while", "do", "switch", "case", "break",
            "continue", "return", "discard", "true", "false");

    @Test
    void packagedResourcesPinOriginalPositionColorTexContract() throws IOException {
        Path root = Path.of(System.getProperty("cuprum.mainResourcesDir"));
        String vertex = readCommitted(root, CUPRUM_VERTEX);
        String fragment = readCommitted(root, CUPRUM_FRAGMENT);
        String particle = readCommitted(root, PARTICLE_JSON);

        assertEquals(vertex, readRuntime(CUPRUM_VERTEX), "processed vertex shader drifted from source resource");
        assertEquals(fragment, readRuntime(CUPRUM_FRAGMENT), "processed fragment shader drifted from source resource");
        assertEquals(particle, readRuntime(PARTICLE_JSON), "processed particle JSON drifted from source resource");
        assertBinaryRuntimeResource(root, PARTICLE_TEXTURE);

        assertTrue(vertex.contains("in vec2 UV0;"), "vertex shader must consume POSITION_COLOR_TEX UV0");
        assertTrue(vertex.contains("cuprumBandLife = UV0;"), "UV0 must carry signed band coordinate/lifetime");
        assertTrue(fragment.contains("bandSquared * bandSquared"), "fragment shader must derive a quartic band");
        assertTrue(fragment.contains("lifeFade"), "fragment shader must apply a lifetime fade");
        assertTrue(fragment.contains("ignitionTint") && fragment.contains("coolingTint"),
                "fragment shader must apply its authored life tint");
        assertFalse((vertex + fragment).contains("rendertype_lightning"),
                "Cuprum source must not name or embed the vanilla shader");

        JsonObject object = JsonParser.parseString(particle).getAsJsonObject();
        JsonArray textures = object.getAsJsonArray("textures");
        assertNotNull(textures, "particle JSON requires textures");
        assertEquals(1, textures.size(), "copper mote has exactly one sprite");
        assertEquals("cuprum:copper_mote", textures.get(0).getAsString());

        Path provenance = root.getParent().getParent().getParent()
                .resolve("docs/shader-research/W1D_FX_RIPPLE_PROVENANCE.md");
        String ledger = Files.readString(provenance, StandardCharsets.UTF_8);
        assertTrue(ledger.contains("Authorship date: **2026-07-20**"));
        assertTrue(ledger.contains("Shipped license: **MIT**"));
        assertTrue(ledger.contains("verified —") && ledger.contains("reported — study only;")
                && ledger.contains("unverified — study only;"), "CP0C marker vocabulary must be complete");
    }

    @Test
    void normalizedStructureIsStrictlyDissimilarToRuntimeVanillaShaders() throws IOException {
        Path root = Path.of(System.getProperty("cuprum.mainResourcesDir"));
        String cuprumVertex = readCommitted(root, CUPRUM_VERTEX);
        String cuprumFragment = readCommitted(root, CUPRUM_FRAGMENT);
        String vanillaVertex = readRuntime(VANILLA_VERTEX);
        String vanillaFragment = readRuntime(VANILLA_FRAGMENT);

        assertBelowThreshold("vertex", structuralSimilarity(cuprumVertex, vanillaVertex));
        assertBelowThreshold("fragment", structuralSimilarity(cuprumFragment, vanillaFragment));
        assertBelowThreshold("combined", structuralSimilarity(
                cuprumVertex + "\n" + cuprumFragment,
                vanillaVertex + "\n" + vanillaFragment));
    }

    private static String readCommitted(Path root, String relative) throws IOException {
        Path path = root.resolve(relative);
        assertTrue(Files.isRegularFile(path), "missing committed FX resource: " + path);
        return Files.readString(path, StandardCharsets.UTF_8);
    }

    private static String readRuntime(String path) throws IOException {
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        try (InputStream stream = loader.getResourceAsStream(path)) {
            assertNotNull(stream, "missing test-runtime resource: " + path);
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static void assertBinaryRuntimeResource(Path root, String relative) throws IOException {
        Path path = root.resolve(relative);
        assertTrue(Files.isRegularFile(path), "missing committed FX resource: " + path);
        byte[] committed = Files.readAllBytes(path);
        assertTrue(committed.length > 0, "empty committed FX resource: " + path);
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        try (InputStream stream = loader.getResourceAsStream(relative)) {
            assertNotNull(stream, "missing test-runtime resource: " + relative);
            assertArrayEquals(committed, stream.readAllBytes(),
                    "processed binary FX resource drifted from source resource");
        }
    }

    private static double structuralSimilarity(String left, String right) {
        Set<String> leftNgrams = ngrams(normalize(left));
        Set<String> rightNgrams = ngrams(normalize(right));
        assertFalse(leftNgrams.isEmpty(), "left shader produced no structural n-grams");
        assertFalse(rightNgrams.isEmpty(), "right shader produced no structural n-grams");
        Set<String> intersection = new HashSet<>(leftNgrams);
        intersection.retainAll(rightNgrams);
        return 2.0 * intersection.size() / (leftNgrams.size() + rightNgrams.size());
    }

    private static List<String> normalize(String source) {
        String withoutComments = COMMENTS.matcher(source).replaceAll(" ");
        Matcher matcher = TOKENS.matcher(withoutComments);
        List<String> normalized = new ArrayList<>();
        while (matcher.find()) {
            String token = matcher.group();
            if (Character.isDigit(token.charAt(0)) || token.charAt(0) == '.') {
                normalized.add("NUMBER");
            } else if (Character.isJavaIdentifierStart(token.charAt(0))
                    && !STRUCTURAL_WORDS.contains(token)) {
                normalized.add("IDENTIFIER");
            } else {
                normalized.add(token);
            }
        }
        return normalized;
    }

    private static Set<String> ngrams(List<String> tokens) {
        Set<String> result = new HashSet<>();
        for (int i = 0; i + NGRAM_SIZE <= tokens.size(); i++) {
            result.add(String.join(" ", tokens.subList(i, i + NGRAM_SIZE)));
        }
        return result;
    }

    private static void assertBelowThreshold(String stage, double score) {
        System.out.printf("%s normalized structural similarity: %.6f (limit < %.2f)%n",
                stage, score, MAX_STRUCTURAL_SIMILARITY);
        assertTrue(score < MAX_STRUCTURAL_SIMILARITY,
                () -> stage + " normalized structural similarity " + score
                        + " must be < " + MAX_STRUCTURAL_SIMILARITY);
    }
}
