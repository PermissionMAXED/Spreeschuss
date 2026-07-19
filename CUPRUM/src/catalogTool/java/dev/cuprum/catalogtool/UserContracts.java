package dev.cuprum.catalogtool;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The binding user-requested contract table. Each U id binds an exact contract key,
 * canonical display name and family, in the exact order the user requested. The
 * validator enforces all three per id, so a U entry cannot be renamed, re-familied
 * or repurposed while keeping its key ("semantic substitution" protection).
 *
 * <p>Scope note: only id/key/name/family are machine-enforced. The {@code summary}
 * and {@code vanilla_overlap} fields are prose and cannot be validated mechanically
 * without brittle NLP — reviewers are responsible for checking that their content
 * still matches the bound contract whenever a catalog diff touches them.
 *
 * <p>Changing this table is a contract change and must never happen silently.
 */
public final class UserContracts {
    /** One binding user contract: exact id, key, canonical name and family. */
    public record Contract(String id, String contractKey, String name, String family) {
    }

    /** Binding request order. */
    public static final List<Contract> ALL = List.of(
            new Contract("U01", "storm_shield_core", "Storm Shield Core", "shield"),                             // Storm Shield multiblock/core
            new Contract("U02", "storm_shield_projectile_interception", "Shield Projectile Interception", "shield"), // projectile interception + visible ripple
            new Contract("U03", "storm_shield_mob_repulsion", "Shield Mob Repulsion", "shield"),                 // hostile mob repulsion + shock damage
            new Contract("U04", "lightning_capture_rods", "Lightning-Capture Rods", "power"),                    // lightning-capture rods
            new Contract("U05", "leyden_jar_batteries", "Leyden Jar Batteries", "power"),                        // Leyden Jar batteries
            new Contract("U06", "oxidation_weapons", "Oxidation Weapons", "combat"),                             // oxidation weapons vs vanilla 1.21.9 copper gear
            new Contract("U07", "oxidation_armor", "Oxidation Armor", "combat"),                                 // oxidation armor vs vanilla copper armor
            new Contract("U08", "charged_exoskeleton", "Charged Exoskeleton", "mobility"),                       // charged movement exoskeleton (jump/dash)
            new Contract("U09", "tesla_turrets", "Tesla Turrets", "combat"),                                     // powered Tesla turrets
            new Contract("U10", "hovering_mag_rails", "Hovering Mag-Rails", "mobility"),                         // 3x hovering mag-rails
            new Contract("U11", "pneumatic_item_tubes", "Pneumatic Item Tubes", "logistics"),                    // visible-window pneumatic item tubes
            new Contract("U12", "programmable_copper_golems", "Programmable Copper Golems", "logistics"),        // programmable utility copper golems
            new Contract("U13", "copper_fans", "Copper Fans", "mobility"),                                       // copper fans
            new Contract("U14", "copper_grappling_hook", "Copper Grappling Hook", "mobility"),                   // copper grappling hook
            new Contract("U15", "ore_detector", "Ore Detector", "utility"),                                      // ore detector
            new Contract("U16", "weighted_pressure_plates", "Weighted Plates", "utility"),                       // configurable weighted plates
            new Contract("U17", "backpack_personal_shield", "Backpack Personal Shield", "shield"),               // backpack personal shield
            new Contract("U18", "xp_collector_drones", "XP Collector Drones", "logistics"),                      // XP-collecting drones
            new Contract("U19", "conductive_climbing_wire", "Conductive Climbing Wire", "power"),                // wall-climbing long-distance wire
            new Contract("U20", "oxidation_copper_spikes", "Oxidation Copper Spikes", "combat"),                 // oxidation-scaling copper spikes
            new Contract("U21", "weather_manipulator", "Weather Manipulator", "utility"),                        // powered weather manipulator
            new Contract("U22", "dynamic_handbook", "Dynamic Handbook", "meta"));                                // complete dynamic in-game handbook

    /** Ordered U id → full contract (insertion order = binding request order). */
    public static final Map<String, Contract> BY_ID = buildIndex();

    /** Ordered U id → contract key (kept for callers that only need the key). */
    public static final Map<String, String> CONTRACTS = buildKeyIndex();

    private UserContracts() {
    }

    private static Map<String, Contract> buildIndex() {
        Map<String, Contract> byId = new LinkedHashMap<>();
        for (Contract contract : ALL) {
            if (byId.put(contract.id(), contract) != null) {
                throw new IllegalStateException("duplicate contract id " + contract.id());
            }
        }
        // Collections.unmodifiableMap keeps the binding insertion order (Map.copyOf would not).
        return java.util.Collections.unmodifiableMap(byId);
    }

    private static Map<String, String> buildKeyIndex() {
        Map<String, String> keys = new LinkedHashMap<>();
        for (Contract contract : ALL) {
            keys.put(contract.id(), contract.contractKey());
        }
        return java.util.Collections.unmodifiableMap(keys);
    }
}
