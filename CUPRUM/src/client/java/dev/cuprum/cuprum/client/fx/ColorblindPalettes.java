package dev.cuprum.cuprum.client.fx;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.client.config.CuprumClientConfig;
import dev.cuprum.cuprum.fx.core.ColorblindCore;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;

/**
 * Data-driven colorblind palette remaps (client-fx.md §8, QOL-05 groundwork), backed by
 * {@code assets/cuprum/fx/colorblind.json}: a row-major 3x3 RGB matrix per mode plus the
 * shape-glyph id table that feeds the later {@code unit_test:qol05_indicator_audit}. The remap
 * is applied once at snapshot creation ({@code FxRippleSnapshot.of}); the matrix arithmetic is
 * the MC-free {@link ColorblindCore} (plan D9).
 *
 * <p>Failure posture (§2): a missing or malformed file <b>disables the remap</b> (identity
 * pass-through, one WARN) — never a tier change, never a crash.
 */
public final class ColorblindPalettes {
    private static final ResourceLocation FILE =
            ResourceLocation.fromNamespaceAndPath("cuprum", "fx/colorblind.json");

    private static volatile Map<CuprumClientConfig.ColorblindMode, float[]> matrices = Map.of();
    private static volatile boolean loaded;

    private ColorblindPalettes() {
    }

    /** Called from {@code FxReloadListener} (render thread) on every resource reload. */
    public static void reload(ResourceManager resourceManager) {
        Optional<Resource> resource = resourceManager.getResource(FILE);
        if (resource.isEmpty()) {
            matrices = Map.of();
            loaded = false;
            Cuprum.LOGGER.warn("[fx] {} missing; colorblind remap disabled (never a tier change)", FILE);
            return;
        }
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(resource.get().open(), StandardCharsets.UTF_8))) {
            JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
            JsonObject palettes = root.getAsJsonObject("palettes");
            if (palettes == null) {
                throw new IllegalArgumentException("missing \"palettes\" object");
            }
            Map<CuprumClientConfig.ColorblindMode, float[]> parsed =
                    new EnumMap<>(CuprumClientConfig.ColorblindMode.class);
            for (CuprumClientConfig.ColorblindMode mode : CuprumClientConfig.ColorblindMode.values()) {
                if (mode == CuprumClientConfig.ColorblindMode.OFF) {
                    continue;
                }
                String key = mode.name().toLowerCase(Locale.ROOT);
                JsonElement element = palettes.get(key);
                if (element == null) {
                    throw new IllegalArgumentException("missing palette \"" + key + "\"");
                }
                parsed.put(mode, parseMatrix(key, element.getAsJsonArray()));
            }
            matrices = Map.copyOf(parsed);
            loaded = true;
            Cuprum.LOGGER.info("[fx] colorblind palettes loaded ({} matrices)", parsed.size());
        } catch (IOException | RuntimeException e) {
            matrices = Map.of();
            loaded = false;
            Cuprum.LOGGER.warn("[fx] failed to parse {}; colorblind remap disabled: {}", FILE, e.toString());
        }
    }

    /** Applies the mode's matrix to {@code argb}; identity when OFF, unloaded or absent. */
    public static int remap(int argb, CuprumClientConfig.ColorblindMode mode) {
        if (mode == CuprumClientConfig.ColorblindMode.OFF) {
            return argb;
        }
        float[] matrix = matrices.get(mode);
        return matrix != null ? ColorblindCore.remap(argb, matrix) : argb;
    }

    /** True when the palette file parsed on the last reload (diagnostics/gametests). */
    public static boolean isLoaded() {
        return loaded;
    }

    private static float[] parseMatrix(String key, JsonArray array) {
        if (array.size() != 9) {
            throw new IllegalArgumentException("palette \"" + key + "\" must have 9 elements, has " + array.size());
        }
        float[] matrix = new float[9];
        for (int i = 0; i < 9; i++) {
            matrix[i] = array.get(i).getAsFloat();
            if (!Float.isFinite(matrix[i])) {
                throw new IllegalArgumentException("palette \"" + key + "\" element " + i + " is not finite");
            }
        }
        return matrix;
    }
}
