package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.fx.FxContent;
import dev.cuprum.cuprum.machine.MachineContent;
import net.fabricmc.fabric.api.datagen.v1.FabricDataOutput;
import net.fabricmc.fabric.api.datagen.v1.provider.FabricLanguageProvider;
import net.minecraft.core.HolderLookup;

import java.util.concurrent.CompletableFuture;

public final class CuprumDeDeLanguageProvider extends FabricLanguageProvider {
    public CuprumDeDeLanguageProvider(FabricDataOutput dataOutput, CompletableFuture<HolderLookup.Provider> registryLookup) {
        super(dataOutput, "de_de", registryLookup);
    }

    @Override
    public void generateTranslations(HolderLookup.Provider registryLookup, TranslationBuilder translationBuilder) {
        translationBuilder.add(CuprumBlocks.CHARGE_PROBE, "Ladungssonde");
        translationBuilder.add("itemGroup.cuprum", "Cuprum");
        translationBuilder.add(MachineContent.DIAGNOSTIC_COIL_CORE, "Diagnosespulenkern");
        translationBuilder.add(MachineContent.DIAGNOSTIC_COIL_FRAME, "Diagnosespulenrahmen");
        translationBuilder.add("container.cuprum.charge_machine", "Lademaschine");
        translationBuilder.add("cuprum.formation.formed", "Geformt");
        translationBuilder.add("cuprum.formation.unformed", "Ungeformt");
        translationBuilder.add("cuprum.formation.fault", "Störung");
        translationBuilder.add("cuprum.charge.readout", "%s / %s Cg");
        translationBuilder.add(FxContent.FX_PROBE, "FX-Sonde");

        // --- W1E: handbook UI ------------------------------------------------------------
        translationBuilder.add("key.cuprum.handbook", "Handbuch öffnen");
        translationBuilder.add("key.category.cuprum.cuprum", "Cuprum");
        translationBuilder.add("handbook.cuprum.title", "Cuprum-Handbuch");
        translationBuilder.add("handbook.cuprum.search", "Suche");
        translationBuilder.add("handbook.cuprum.search_hint", "Handbuch durchsuchen...");
        translationBuilder.add("handbook.cuprum.back", "Zurück");
        translationBuilder.add("handbook.cuprum.bookmarks", "Lesezeichen");
        translationBuilder.add("handbook.cuprum.bookmark_add", "Lesezeichen hinzufügen");
        translationBuilder.add("handbook.cuprum.bookmark_remove", "Lesezeichen entfernen");
        translationBuilder.add("handbook.cuprum.locked_notice",
                "Diese Seite ist noch gesperrt. Erkunde weiter, um sie freizuschalten.");
        translationBuilder.add("handbook.cuprum.page_missing",
                "Diese Seite ist auf diesem Server nicht verfügbar.");
        translationBuilder.add("handbook.cuprum.empty",
                "Es wurden noch keine Handbuchinhalte synchronisiert.");
        translationBuilder.add("handbook.cuprum.no_results", "Keine Ergebnisse.");
        translationBuilder.add("handbook.cuprum.recipe_unavailable", "Rezept nicht verfügbar.");
        translationBuilder.add("handbook.cuprum.recipe_narration", "Rezept: %s");
        translationBuilder.add("handbook.cuprum.multiblock_layer", "Ebene %s von %s");

        // --- W1E: handbook content (category + three diagnostics pages, plan D6) ----------
        translationBuilder.add("handbook.cuprum.category.diagnostics", "Diagnose");
        translationBuilder.add("handbook.cuprum.page.charge_probe.title", "Ladungssonde");
        translationBuilder.add("handbook.cuprum.page.charge_probe.intro",
                "Die Ladungssonde ist CP0-Diagnose-Infrastruktur. Bei Benutzung meldet sie die "
                        + "Mod-Version und den kanonischen Katalog-SHA-256 und liest jeden "
                        + "Ladungsknoten an der anvisierten Position aus.");
        translationBuilder.add("handbook.cuprum.page.charge_probe.image_caption",
                "Der Ladungssondenblock.");
        translationBuilder.add("handbook.cuprum.page.charge_probe.usage",
                "Der Wert oben ist die live ausgelesene passive Grundrate aus der "
                        + "Balance-Konfiguration des Servers.");
        translationBuilder.add("handbook.cuprum.page.diagnostic_coil.title", "Diagnosespule");
        translationBuilder.add("handbook.cuprum.page.diagnostic_coil.intro",
                "Die Diagnosespule ist ein 3x3-Multiblock: ein Kern umringt von Rahmen, einem "
                        + "gewachsten Kupferblock und einer oxidierten Kupferecke. Ein geformter "
                        + "Kern registriert sich als Ladungsknoten, den die Ladungssonde auslesen "
                        + "kann.");
        translationBuilder.add("handbook.cuprum.page.diagnostic_coil.formation",
                "Gehe die Ebenenvorschau oben durch, um jeden Block zu platzieren. Der Kern ist "
                        + "der Controller; gedrehte und gespiegelte Aufbauten formen sich ebenfalls.");
        translationBuilder.add("handbook.cuprum.page.diagnostic_coil.acquisition",
                "Diagnose-Infrastruktur: vorerst nur kreativ oder diagnostisch erhältlich - "
                        + "noch kein Craftingrezept.");
        translationBuilder.add("handbook.cuprum.page.fx_probe.title", "FX-Sonde");
        translationBuilder.add("handbook.cuprum.page.fx_probe.intro",
                "Die FX-Sonde erzeugt bei Benutzung einen Kupferwellen-Testeffekt und treibt "
                        + "damit die Client-FX-Pipeline von Ende zu Ende an.");
        translationBuilder.add("handbook.cuprum.page.fx_probe.image_caption", "Der FX-Sondenblock.");
        translationBuilder.add("handbook.cuprum.page.fx_probe.tiers",
                "Effekte folgen der Stufenleiter T1, T2, T3, AUS. Die effektive Stufe ist das "
                        + "Minimum aus Konfigurationslimit, Gerätefähigkeit und Kompatibilitätslimits.");
        translationBuilder.add("handbook.cuprum.page.fx_probe.acquisition",
                "Diagnose-Infrastruktur: vorerst nur kreativ oder diagnostisch erhältlich - "
                        + "noch kein Craftingrezept.");

        // --- W1E: config screens (Cloth AutoConfig i18n + the Cuprum hub) ------------------
        translationBuilder.add("text.autoconfig.cuprum.hub.title", "Cuprum-Einstellungen");
        translationBuilder.add("text.autoconfig.cuprum.hub.client",
                "Client-Einstellungen (dieser Computer)");
        translationBuilder.add("text.autoconfig.cuprum.hub.common",
                "Allgemeine Einstellungen (lokale Datei)");
        translationBuilder.add("text.autoconfig.cuprum.hub.overlay_note",
                "Verbunden: Aktuell ist die Server-Konfiguration maßgeblich.");

        translationBuilder.add("text.autoconfig.cuprum-client.title", "Cuprum-Client-Einstellungen");
        translationBuilder.add("text.autoconfig.cuprum-client.category.default",
                "Darstellung & Barrierefreiheit");
        translationBuilder.add("text.autoconfig.cuprum-client.option.fxTierCap", "FX-Stufenlimit");
        translationBuilder.add("text.autoconfig.cuprum-client.option.fxTierCap.@Tooltip",
                "Begrenzt die FX-Qualitätsleiter: FULL = T1, REDUCED = T2, MINIMAL = T3.");
        translationBuilder.add("text.autoconfig.cuprum-client.option.flashScale", "Blitzintensität");
        translationBuilder.add("text.autoconfig.cuprum-client.option.flashScale.@Tooltip",
                "Skaliert alle Cuprum-Bildschirmblitze; 0 deaktiviert sie vollständig.");
        translationBuilder.add("text.autoconfig.cuprum-client.option.colorblindMode",
                "Farbfehlsichtigkeitsmodus");
        translationBuilder.add("text.autoconfig.cuprum-client.option.colorblindMode.@Tooltip",
                "Passt Cuprum-Effektfarben an die gewählte Sehschwäche an.");
        translationBuilder.add("text.autoconfig.cuprum-client.option.shapeCodedIndicators",
                "Formcodierte Anzeigen");
        translationBuilder.add("text.autoconfig.cuprum-client.option.shapeCodedIndicators.@Tooltip",
                "Zustandsanzeigen erhalten zusätzlich zur Farbe ein eindeutiges Symbol.");

        translationBuilder.add("text.autoconfig.cuprum-common.title",
                "Cuprum: Allgemeine Einstellungen");
        translationBuilder.add("text.autoconfig.cuprum-common.category.default", "Balance & Netzwerk");
        translationBuilder.add("text.autoconfig.cuprum-common.option.charge", "Ladungsökonomie");
        translationBuilder.add("text.autoconfig.cuprum-common.option.charge.passiveBaselineCgPerTick",
                "Passive Grundrate (Cg/t)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.passiveBaselineCgPerTick.@Tooltip",
                "Passiv erzeugte Ladung pro Tick. Im Mehrspielermodus gilt der Serverwert.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.charge.leydenJarCapacityCg",
                "Leidener-Flasche Kapazität (Cg)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.leydenJarCapacityCg.@Tooltip",
                "Speicherkapazität einer Leidener Flasche. Im Mehrspielermodus gilt der Serverwert.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.charge.strikeDepositCg",
                "Blitzeinschlag-Ladung (Cg)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.strikeDepositCg.@Tooltip",
                "Durch einen Blitzeinschlag eingelagerte Ladung. Im Mehrspielermodus gilt der "
                        + "Serverwert.");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.wireLossPpTenthsPerSpanBare",
                "Verlust Blankdraht (0,1 Pp pro Spanne)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.wireLossPpTenthsPerSpanBare.@Tooltip",
                "Übertragungsverlust blanker Kupferdrähte in Zehntel-Prozentpunkten pro Spanne.");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.wireLossPpTenthsPerSpanHv",
                "Verlust HV-Draht (0,1 Pp pro Spanne)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.charge.wireLossPpTenthsPerSpanHv.@Tooltip",
                "Übertragungsverlust von Hochspannungsdrähten in Zehntel-Prozentpunkten pro Spanne.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net", "Netzwerk-Schutz");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.ratePerSecDefault",
                "Standardrate (Nachr./s)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.net.ratePerSecDefault.@Tooltip",
                "Paketbudget pro Spieler und Sekunde für Standardinteraktionen.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.burstDefault",
                "Standard-Burst");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.burstDefault.@Tooltip",
                "Kurzzeitiger Zuschlag zusätzlich zur Sekundenrate.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.rateGlobalPerSec",
                "Globale Rate (Nachr./s)");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.rateGlobalPerSec.@Tooltip",
                "Obergrenze pro Spieler über alle Cuprum-Pakettypen hinweg.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.violationKickThreshold",
                "Kick-Schwelle für Verstöße");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.net.violationKickThreshold.@Tooltip",
                "Schutzverstöße innerhalb des Zeitfensters, bevor die Verbindung getrennt wird.");
        translationBuilder.add("text.autoconfig.cuprum-common.option.net.violationWindowTicks",
                "Verstoß-Zeitfenster (Ticks)");
        translationBuilder.add(
                "text.autoconfig.cuprum-common.option.net.violationWindowTicks.@Tooltip",
                "Länge des gleitenden Zeitfensters für den Verstoßzähler in Spielticks.");
    }
}
