package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.fx.FxContent;
import dev.cuprum.cuprum.machine.MachineContent;
import net.fabricmc.fabric.api.datagen.v1.FabricDataOutput;
import net.fabricmc.fabric.api.datagen.v1.provider.FabricLanguageProvider;
import net.minecraft.core.HolderLookup;

import java.util.concurrent.CompletableFuture;

public final class CuprumEnUsLanguageProvider extends FabricLanguageProvider {
    public CuprumEnUsLanguageProvider(FabricDataOutput dataOutput, CompletableFuture<HolderLookup.Provider> registryLookup) {
        super(dataOutput, "en_us", registryLookup);
    }

    @Override
    public void generateTranslations(HolderLookup.Provider registryLookup, TranslationBuilder translationBuilder) {
        translationBuilder.add(CuprumBlocks.CHARGE_PROBE, "Charge Probe");
        translationBuilder.add("itemGroup.cuprum", "Cuprum");
        translationBuilder.add(MachineContent.DIAGNOSTIC_COIL_CORE, "Diagnostic Coil Core");
        translationBuilder.add(MachineContent.DIAGNOSTIC_COIL_FRAME, "Diagnostic Coil Frame");
        translationBuilder.add("container.cuprum.charge_machine", "Charge Machine");
        translationBuilder.add("cuprum.formation.formed", "Formed");
        translationBuilder.add("cuprum.formation.unformed", "Unformed");
        translationBuilder.add("cuprum.formation.fault", "Fault");
        translationBuilder.add("cuprum.charge.readout", "%s / %s Cg");
        translationBuilder.add(FxContent.FX_PROBE, "FX Probe");

        // --- W1E: handbook UI ------------------------------------------------------------
        translationBuilder.add("key.cuprum.handbook", "Open Handbook");
        translationBuilder.add("key.category.cuprum.cuprum", "Cuprum");
        translationBuilder.add("handbook.cuprum.title", "Cuprum Handbook");
        translationBuilder.add("handbook.cuprum.search", "Search");
        translationBuilder.add("handbook.cuprum.search_hint", "Search the handbook...");
        translationBuilder.add("handbook.cuprum.back", "Back");
        translationBuilder.add("handbook.cuprum.bookmarks", "Bookmarks");
        translationBuilder.add("handbook.cuprum.bookmark_add", "Add bookmark");
        translationBuilder.add("handbook.cuprum.bookmark_remove", "Remove bookmark");
        translationBuilder.add("handbook.cuprum.locked_notice",
                "This page is still locked. Keep exploring to unlock it.");
        translationBuilder.add("handbook.cuprum.page_missing",
                "This page is not available on this server.");
        translationBuilder.add("handbook.cuprum.empty", "No handbook content has been synced yet.");
        translationBuilder.add("handbook.cuprum.no_results", "No results.");
        translationBuilder.add("handbook.cuprum.recipe_unavailable", "Recipe unavailable.");
        translationBuilder.add("handbook.cuprum.recipe_narration", "Recipe: %s");
        translationBuilder.add("handbook.cuprum.multiblock_layer", "Layer %s of %s");

        // --- W1E: handbook content (category + three diagnostics pages, plan D6) ----------
        translationBuilder.add("handbook.cuprum.category.diagnostics", "Diagnostics");
        translationBuilder.add("handbook.cuprum.page.charge_probe.title", "Charge Probe");
        translationBuilder.add("handbook.cuprum.page.charge_probe.intro",
                "The Charge Probe is CP0 diagnostic infrastructure. Using it reports the mod "
                        + "version and the canonical catalog SHA-256, and reads any charge node "
                        + "at the targeted position.");
        translationBuilder.add("handbook.cuprum.page.charge_probe.image_caption",
                "The Charge Probe block.");
        translationBuilder.add("handbook.cuprum.page.charge_probe.usage",
                "The value above is the live passive baseline from the server's balance config.");
        translationBuilder.add("handbook.cuprum.page.diagnostic_coil.title", "Diagnostic Coil");
        translationBuilder.add("handbook.cuprum.page.diagnostic_coil.intro",
                "The Diagnostic Coil is a 3x3 multiblock: a core ringed by frames, one waxed "
                        + "copper block and one oxidized copper corner. A formed core registers "
                        + "as a charge node the Charge Probe can read.");
        translationBuilder.add("handbook.cuprum.page.diagnostic_coil.formation",
                "Step through the layer preview above to place each block. The core is the "
                        + "controller; rotated and mirrored placements form too.");
        translationBuilder.add("handbook.cuprum.page.diagnostic_coil.acquisition",
                "Diagnostic infrastructure: creative or diagnostic acquisition only for now - "
                        + "no crafting recipe yet.");
        translationBuilder.add("handbook.cuprum.page.fx_probe.title", "FX Probe");
        translationBuilder.add("handbook.cuprum.page.fx_probe.intro",
                "The FX Probe emits a copper ripple test effect when used, driving the client "
                        + "FX pipeline end to end.");
        translationBuilder.add("handbook.cuprum.page.fx_probe.image_caption", "The FX Probe block.");
        translationBuilder.add("handbook.cuprum.page.fx_probe.tiers",
                "Effects follow the tier ladder T1, T2, T3, OFF. The effective tier is the "
                        + "minimum of your config cap, device capability and compatibility caps.");
        translationBuilder.add("handbook.cuprum.page.fx_probe.acquisition",
                "Diagnostic infrastructure: creative or diagnostic acquisition only for now - "
                        + "no crafting recipe yet.");

        // --- W1E: config screens (Cloth AutoConfig i18n + the Cuprum hub) ------------------
        translationBuilder.add("text.autoconfig.cuprum.hub.title", "Cuprum Settings");
        translationBuilder.add("text.autoconfig.cuprum.hub.client", "Client settings (this computer)");
        translationBuilder.add("text.autoconfig.cuprum.hub.common", "Common settings (local file)");
        translationBuilder.add("text.autoconfig.cuprum.hub.overlay_note",
                "Connected: the server's common config is authoritative right now.");

        translationBuilder.add("text.autoconfig.cuprum-client.title", "Cuprum Client Settings");
        translationBuilder.add("text.autoconfig.cuprum-client.category.default",
                "Presentation & Accessibility");
        translationBuilder.add("text.autoconfig.cuprum-client.option.fxTierCap", "FX tier cap");
        translationBuilder.add("text.autoconfig.cuprum-client.option.fxTierCap.@Tooltip",
                "Caps the FX quality ladder: FULL = T1, REDUCED = T2, MINIMAL = T3.");
        translationBuilder.add("text.autoconfig.cuprum-client.option.flashScale", "Flash scale");
        translationBuilder.add("text.autoconfig.cuprum-client.option.flashScale.@Tooltip",
                "Scales all Cuprum screen flashes; 0 disables them entirely.");
        translationBuilder.add("text.autoconfig.cuprum-client.option.colorblindMode", "Colorblind mode");
        translationBuilder.add("text.autoconfig.cuprum-client.option.colorblindMode.@Tooltip",
                "Remaps Cuprum effect colors for the selected vision type.");
        translationBuilder.add("text.autoconfig.cuprum-client.option.shapeCodedIndicators",
                "Shape-coded indicators");
        translationBuilder.add("text.autoconfig.cuprum-client.option.shapeCodedIndicators.@Tooltip",
                "State indicators add a distinct glyph on top of color.");

        translationBuilder.add("text.autoconfig.cuprum-common.title", "Cuprum Common Settings");
        translationBuilder.add("text.autoconfig.cuprum-common.category.default", "Balance & Network");
        translationBuilder.add("text.autoconfig.cuprum-common.option.charge", "Charge economy");
        translationBuilder.add("text.autoconfig.cuprum-common.option.charge.passiveBaselineCgPerTick",
                "Passive baseline (Cg/t)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.passiveBaselineCgPerTick.@Tooltip",
                "Charge generated passively per tick. Server value wins while connected.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.charge.leydenJarCapacityCg",
                "Leyden jar capacity (Cg)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.leydenJarCapacityCg.@Tooltip",
                "Storage capacity of one Leyden jar. Server value wins while connected.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.charge.strikeDepositCg",
                "Lightning strike deposit (Cg)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.strikeDepositCg.@Tooltip",
                "Charge deposited by one lightning strike. Server value wins while connected.");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.wireLossPpTenthsPerSpanBare",
                "Bare wire loss (0.1 pp per span)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.wireLossPpTenthsPerSpanBare.@Tooltip",
                "Transfer loss of bare copper wire in tenths of a percentage point per span.");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.wireLossPpTenthsPerSpanHv",
                "HV wire loss (0.1 pp per span)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.wireLossPpTenthsPerSpanHv.@Tooltip",
                "Transfer loss of high-voltage wire in tenths of a percentage point per span.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net", "Network guards");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.ratePerSecDefault",
                "Default rate (msgs/s)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.net.ratePerSecDefault.@Tooltip",
                "Per-player packet budget per second for standard interactions.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.burstDefault", "Default burst");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.burstDefault.@Tooltip",
                "Short-burst allowance on top of the per-second rate.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.rateGlobalPerSec",
                "Global rate (msgs/s)");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.rateGlobalPerSec.@Tooltip",
                "Per-player cap across all Cuprum packet types combined.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.violationKickThreshold",
                "Violation kick threshold");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.net.violationKickThreshold.@Tooltip",
                "Guard violations inside the window before the connection is kicked.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.violationWindowTicks",
                "Violation window (ticks)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.net.violationWindowTicks.@Tooltip",
                "Sliding window length for the violation counter, in game ticks.");
    }
}
