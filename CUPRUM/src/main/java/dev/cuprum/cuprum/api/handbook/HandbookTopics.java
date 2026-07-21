package dev.cuprum.cuprum.api.handbook;

import java.util.List;
import net.minecraft.resources.ResourceLocation;

/**
 * FROZEN API (plan D5): the code-referenced handbook page ids. Feature code (QOL-01 "?"
 * buttons, ADV chains, tests) deep-links only through these constants so a renamed page is a
 * compile-time/gate failure, never a dead link: the {@code handbook_pages_valid} GameTest
 * asserts every constant resolves in the loaded store, and the MC-free
 * {@code HandbookDeeplinkTargetsTest} pins the same literals against the committed JSONs.
 * Append-only.
 */
public final class HandbookTopics {
    public static final ResourceLocation CHARGE_PROBE = page("diagnostics/charge_probe");
    public static final ResourceLocation DIAGNOSTIC_COIL = page("diagnostics/diagnostic_coil");
    public static final ResourceLocation FX_PROBE = page("diagnostics/fx_probe");

    private HandbookTopics() {
    }

    /** Every declared topic (gate iteration; append new constants here too). */
    public static List<ResourceLocation> all() {
        return List.of(CHARGE_PROBE, DIAGNOSTIC_COIL, FX_PROBE);
    }

    private static ResourceLocation page(String path) {
        return ResourceLocation.fromNamespaceAndPath("cuprum", path);
    }
}
