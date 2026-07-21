package dev.cuprum.cuprum.client.config;

import com.terraformersmc.modmenu.api.ConfigScreenFactory;
import com.terraformersmc.modmenu.api.ModMenuApi;

/**
 * The optional Mod Menu integration (handbook-config.md §6): {@code "modmenu"} entrypoint
 * returning the {@link CuprumConfigHubScreen} factory. Mod Menu stays {@code suggests}-only
 * in {@code fabric.mod.json} and {@code modCompileOnly}/{@code modLocalRuntime} in the
 * build (same pinned 16.0.1 coordinate, plan §5-3) — the game runs identically without it;
 * Fabric simply never instantiates this entrypoint then.
 */
public final class CuprumModMenu implements ModMenuApi {
    @Override
    public ConfigScreenFactory<?> getModConfigScreenFactory() {
        return CuprumConfigHubScreen::new;
    }
}
